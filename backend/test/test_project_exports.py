from io import BytesIO
from xml.etree import ElementTree as ET

from django.test import Client, SimpleTestCase
from pypdf import PdfReader
from reportlab.pdfbase import pdfmetrics

from backend.api.exporting import Paragraph, Screenplay, export_fdx, export_fountain, project_screenplay
from backend.api.models import Scene
from backend.api.screenplay_pdf import FONT, export_pdf
from ._api_base import ApiTestCase


def pdf_reader(script):
    return PdfReader(BytesIO(export_pdf(script)))


def page_text(page):
    entries = []
    def visit(text, cm, tm, font, size):
        if text.strip():
            entries.append((text.strip(), tm[4], tm[5], size, str(font['/BaseFont'])))
    page.extract_text(visitor_text=visit)
    return entries


class ProjectExportApiTests(ApiTestCase):
    def test_formats_have_download_headers_and_expose_unicode_filename_with_cors(self):
        self.project.title = 'Zażółć gęślą jaźń'
        self.project.save()
        self.scene.location_heading = 'wn. chata'
        self.scene.time_of_day = 'świt'
        self.scene.content_text = 'Obsolete flattened content'
        self.scene.editor_metadata = {'blocks': [
            {'id': 'a', 'type': 'action', 'text': 'Zażółć gęślą jaźń.'},
            {'id': 'b', 'type': 'character', 'text': 'Maćko'},
            {'id': 'c', 'type': 'parenthetical', 'text': 'cicho'},
            {'id': 'd', 'type': 'dialogue', 'text': 'Żyję!'},
        ]}
        self.scene.save()
        for format, mime in [('pdf', 'application/pdf'), ('fdx', 'application/xml'), ('fountain', 'text/plain')]:
            with self.subTest(format=format):
                response = self.client.get(f'/api/projects/{self.project.pk}/export?format={format}',
                                           HTTP_ORIGIN='http://127.0.0.1:5173')
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response['Content-Type'].startswith(mime))
                self.assertIn('attachment;', response['Content-Disposition'])
                self.assertIn("filename*=utf-8''", response['Content-Disposition'])
                self.assertIn('Content-Disposition', response['Access-Control-Expose-Headers'])
                self.assertEqual(response['Cache-Control'], 'no-store')
                data = b''.join(response.streaming_content)
                text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(data)).pages) if format == 'pdf' else data.decode()
                self.assertIn('WN. CHATA - ŚWIT', text)
                self.assertIn('Zażółć gęślą jaźń.', text)
                self.assertNotIn('Obsolete flattened content', text)

    def test_authentication_ownership_and_unknown_format(self):
        for format in ('pdf', 'fdx', 'fountain'):
            path = f'/projects/{self.project.pk}/export?format={format}'
            self.assert_status(self.send('get', path, client=Client()), 401)
            self.assert_status(self.send('get', f'/projects/{self.foreign_project.pk}/export?format={format}'), 404)
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/export?format=exe'), 422)

    def test_scene_order_follows_reordered_acts_and_scene_sort_order(self):
        self.act.sort_order = 20
        self.act.save()
        self.scene.sort_order = 9
        self.scene.content_text = 'Last scene.'
        self.scene.save()
        self.next_scene.content_text = 'Middle scene.'
        self.next_scene.save()
        Scene.objects.create(project=self.project, act=self.next_act, scene_number=3, content_text='First scene.')
        text = export_fountain(project_screenplay(self.project)).decode()
        self.assertLess(text.index('First scene.'), text.index('Middle scene.'))
        self.assertLess(text.index('Middle scene.'), text.index('Last scene.'))

    def test_legacy_plain_text_and_malformed_blocks_are_not_lost(self):
        self.scene.location_heading = 'WN. CHATA - ŚWIT'
        self.scene.time_of_day = 'świt'
        self.scene.content_text = 'Pierwszy akapit.\n\nDrugi akapit.'
        for metadata in ({}, {'blocks': [{'type': ['not a string'], 'text': 'Bad'}]}):
            self.scene.editor_metadata = metadata
            self.scene.save()
            script = project_screenplay(self.project)
            self.assertEqual(script.paragraphs[0].text, 'WN. CHATA - ŚWIT')
            self.assertEqual([p.text for p in script.paragraphs[1:]], ['Pierwszy akapit.', 'Drugi akapit.'])


class ExportFormatTests(SimpleTestCase):
    def setUp(self):
        self.script = Screenplay('Próba <&> "sceny"', 'Żaneta', (
            Paragraph('heading', 'WN. CHATA - ŚWIT'),
            Paragraph('action', 'Żółw idzie. <tag> & dosłowny tekst.'),
            Paragraph('character', 'MAĆKO'), Paragraph('parenthetical', '(do Anny)'),
            Paragraph('dialogue', 'Czekaj!'), Paragraph('transition', 'CIĘCIE DO:'),
        ))

    def test_fountain_keeps_speech_together_and_forces_polish_element_types(self):
        text = export_fountain(self.script).decode('utf-8')
        self.assertIn('\n.WN. CHATA - ŚWIT\n\n!Żółw', text)
        self.assertIn('\n@MAĆKO\n(do Anny)\nCzekaj!\n\n> CIĘCIE DO:', text)
        escaped = export_fountain(Screenplay('T', 'A', (Paragraph('action', 'A * B _ C [[note]] /* test */'),))).decode()
        self.assertIn(r'A \* B \_ C \[\[note\]\] \/\* test \*\/', escaped)

    def test_fdx_is_utf8_xml_with_all_six_types_and_literal_text(self):
        root = ET.fromstring(export_fdx(self.script))
        self.assertEqual(root.tag, 'FinalDraft')
        self.assertEqual([p.attrib['Type'] for p in root.findall('./Content/Paragraph')],
                         ['Scene Heading', 'Action', 'Character', 'Parenthetical', 'Dialogue', 'Transition'])
        self.assertEqual(root.find('./Content/Paragraph[2]/Text').text, self.script.paragraphs[1].text)
        self.assertEqual(root.find('./TitlePage/Content/Paragraph/Text').text, self.script.title.upper())
        self.assertEqual(root.find('./PageLayout/PageSize').attrib, {'Width': '8.50', 'Height': '11.00'})
        self.assertEqual(root.find("./ElementSettings[@Type='Dialogue']/ParagraphSpec").attrib['LeftIndent'], '2.50')

    def test_pdf_embeds_unicode_courier_12_and_exact_indents(self):
        pdf = pdf_reader(self.script)
        self.assertEqual(len(pdf.pages), 2)
        self.assertEqual(list(pdf.pages[1].mediabox), [0, 0, 612, 792])
        text = page_text(pdf.pages[1])
        expected = [('WN. CHATA - ŚWIT', 108), ('Żółw idzie.', 108), ('MAĆKO', 266.4),
                    ('(do Anny)', 223.2), ('Czekaj!', 180)]
        for prefix, left in expected:
            item = next(row for row in text if row[0].startswith(prefix))
            self.assertAlmostEqual(item[1], left, places=2)
        transition = next(row for row in text if row[0] == 'CIĘCIE DO:')
        self.assertAlmostEqual(transition[1] + pdfmetrics.stringWidth(transition[0], FONT, 12), 540, places=2)
        for value, x, y, size, font in text:
            self.assertEqual(size, 12)
            self.assertIn('CourierPrime', font)
            self.assertGreaterEqual(x, 108)
            self.assertLessEqual(x + pdfmetrics.stringWidth(value, FONT, 12), 540.01)
            self.assertGreater(y, 72)
            self.assertLess(y, 720)
        self.assertNotIn('1.', [row[0] for row in text])
        font = next(font.get_object() for font in pdf.pages[1]['/Resources']['/Font'].values()
                    if 'CourierPrime' in str(font.get_object().get('/BaseFont', '')))
        self.assertIn('/FontFile2', font['/FontDescriptor'])

    def test_long_dialogue_continues_on_next_pages_without_losing_or_repeating_text(self):
        words = [f'słowo{n:04d}' for n in range(650)]
        script = Screenplay('Dialog', 'Autor', (Paragraph('character', 'ANNA'), Paragraph('dialogue', ' '.join(words))))
        pdf = pdf_reader(script)
        self.assertGreater(len(pdf.pages), 3)
        joined = ' '.join(page.extract_text() for page in pdf.pages[1:])
        for word in words:
            self.assertEqual(joined.count(word), 1, word)
        self.assertIn('(MORE)', pdf.pages[1].extract_text())
        self.assertIn("ANNA (CONT'D)", pdf.pages[2].extract_text())
        self.assertIn('2.', pdf.pages[2].extract_text())
        for page in pdf.pages[1:]:
            for text, x, y, size, _ in page_text(page):
                self.assertEqual(size, 12)
                if text.endswith('.') and text[:-1].isdigit():
                    continue
                self.assertGreaterEqual(y, 72)
                self.assertLessEqual(y, 720)

    def test_heading_cue_and_parenthetical_are_not_orphaned_at_page_bottom(self):
        script = Screenplay('Granice stron', 'Autor', (
            Paragraph('action', '\n'.join('Wiersz akcji.' for _ in range(49))),
            Paragraph('heading', 'WN. POKÓJ - NOC'), Paragraph('character', 'ANNA'),
            Paragraph('parenthetical', '(do brata)'), Paragraph('dialogue', 'Nie odchodź jeszcze.'),
        ))
        pdf = pdf_reader(script)
        self.assertNotIn('WN. POKÓJ - NOC', pdf.pages[1].extract_text())
        self.assertIn('WN. POKÓJ - NOC', pdf.pages[2].extract_text())
        self.assertIn('Nie odchodź jeszcze.', pdf.pages[2].extract_text())

    def test_oversized_unbroken_text_wraps_without_changing_font_or_escaping_as_html(self):
        value = 'x' * 1000
        pdf = pdf_reader(Screenplay('Długi tekst', 'Autor', (Paragraph('action', value),)))
        text = ''.join(row[0] for page in pdf.pages[1:] for row in page_text(page))
        self.assertEqual(text, value)
        self.assertTrue(all(row[3] == 12 for row in page_text(pdf.pages[1])))

    def test_parenthetical_at_a_dialogue_page_break_moves_with_its_line(self):
        script = Screenplay('Granica dialogu', 'Autor', (
            Paragraph('character', 'ANNA'),
            Paragraph('dialogue', '\n'.join('Zostań jeszcze chwilę.' for _ in range(50))),
            Paragraph('parenthetical', '(po chwili)'),
            Paragraph('dialogue', 'Teraz już wiem.\nMusisz iść.\nDo widzenia.'),
        ))
        pdf = pdf_reader(script)
        self.assertNotIn('(po chwili)', pdf.pages[1].extract_text())
        self.assertIn('(MORE)', pdf.pages[1].extract_text())
        self.assertIn('(po chwili)', pdf.pages[2].extract_text())
        self.assertIn('Teraz już wiem.', pdf.pages[2].extract_text())
