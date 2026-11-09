import json
from uuid import UUID

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase

from backend.api.screenplay import blocks_text, generated_scene_blocks, variant_editor_blocks
from backend.ollama import OllamaError


class ScreenplayFormatTests(SimpleTestCase):
    def test_generated_dialogue_omits_stray_periods_and_bullets_on_each_line(self):
        for prefix in ('. ', '• ', '◦ ', '▪ ', '· '):
            with self.subTest(prefix=prefix):
                blocks = generated_scene_blocks(json.dumps({'blocks': [{
                    'type': 'speech', 'speaker': 'MACIEK', 'parenthetical': None,
                    'spoken_text': f'{prefix}Dlaczego?\n\n{prefix}Czas odkryć prawdę.',
                }]}))
                self.assertEqual(blocks[-1]['text'], 'Dlaczego?\n\nCzas odkryć prawdę.')

    def test_real_dialogue_punctuation_and_action_text_are_preserved(self):
        lines = ['... Nie wiem...', '… Nie jestem pewien.', '. . . Czekaj.',
                 '— Nie teraz.', 'To kosztuje 3.50 zł, np. za bilet.',
                 '„.” to kropka.', 'Nie wiem. Naprawdę.']
        for text in lines:
            with self.subTest(text=text):
                blocks = generated_scene_blocks(json.dumps({'blocks': [
                    {'type': 'action', 'text': '. Napis widoczny na ścianie.'},
                    {'type': 'speech', 'speaker': 'MACIEK', 'parenthetical': None, 'spoken_text': text},
                ]}))
                self.assertEqual(blocks[0]['text'], '. Napis widoczny na ścianie.')
                self.assertEqual(blocks[-1]['text'], text)

    def test_generates_editor_ids_and_normalizes_each_supported_block_type(self):
        blocks = generated_scene_blocks(json.dumps({'blocks': [
            {'type': 'action', 'text': '  Anna otwiera kopertę.  '},
            {'type': 'speech', 'speaker': 'Anna', 'parenthetical': 'szeptem', 'spoken_text': 'Znalazłam list.'},
        ]}))
        self.assertEqual([block['type'] for block in blocks], ['action', 'character', 'parenthetical', 'dialogue'])
        self.assertEqual([block['text'] for block in blocks], [
            'Anna otwiera kopertę.', 'ANNA', '(szeptem)', 'Znalazłam list.',
        ])
        self.assertEqual(len({UUID(block['id']) for block in blocks}), 4)
        self.assertEqual(blocks_text(blocks), '\n\n'.join(block['text'] for block in blocks))
        self.assertEqual(variant_editor_blocks(blocks), blocks)

    def test_rejects_invalid_json_empty_blocks_unknown_types_and_extra_variants(self):
        answers = [
            'not json', '{"blocks":[', '{}', '[]', '{"blocks":[]}',
            json.dumps({'blocks': [{'type': 'heading', 'text': 'WN. DOM'}]}),
            json.dumps({'blocks': [{'type': 'transition', 'text': 'CIĘCIE DO: WN. CHATA - ŚWIT'}]}),
            json.dumps({'blocks': [{'type': 'action', 'text': '  '}]}),
            json.dumps({'blocks': [{'type': 'action', 'text': 'Text', 'id': 'model-id'}]}),
            json.dumps({'variants': [{'blocks': [{'type': 'action', 'text': 'Text'}]}]}),
        ]
        for answer in answers:
            with self.subTest(answer=answer), self.assertRaises(OllamaError):
                generated_scene_blocks(answer)

    def test_rejects_separate_dialogue_cues_and_incomplete_speech_groups(self):
        for items in (
            [{'type': 'dialogue', 'text': 'Hello'}],
            [{'type': 'parenthetical', 'text': '(cicho)'}],
            [{'type': 'character', 'text': 'ANNA'}],
            [{'type': 'character', 'text': 'ANNA'}, {'type': 'action', 'text': 'Wychodzi.'}],
            [{'type': 'speech', 'speaker': 'ANNA', 'parenthetical': '()', 'spoken_text': 'Hello'}],
            [{'type': 'speech', 'speaker': '', 'parenthetical': None, 'spoken_text': 'Hello'}],
            [{'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None, 'spoken_text': ' '}],
            [{'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None}],
            [{'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None, 'spoken_text': 'Hello', 'after_dialogue': '(cicho)'}],
        ):
            with self.subTest(items=items), self.assertRaises(OllamaError):
                generated_scene_blocks(json.dumps({'blocks': items}))

    def test_supports_action_only_scenes_and_multiple_dialogue_paragraphs(self):
        self.assertEqual(generated_scene_blocks('{"blocks":[{"type":"action","text":"Cisza."}]}')[0]['text'], 'Cisza.')
        blocks = generated_scene_blocks(json.dumps({'blocks': [
            {'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None, 'spoken_text': 'Czekaj.'},
            {'type': 'speech', 'speaker': 'ANNA', 'parenthetical': '(ciszej)', 'spoken_text': 'Ktoś tu jest.'},
        ]}))
        self.assertEqual([block['type'] for block in blocks], ['character', 'dialogue', 'character', 'parenthetical', 'dialogue'])

    def test_environment_and_physical_action_remain_action_around_a_speech(self):
        narrative = 'Promienie słońca wpadające przez okno oświetlają jego twarz.'
        blocks = generated_scene_blocks(json.dumps({'blocks': [
            {'type': 'action', 'text': narrative},
            {'type': 'speech', 'speaker': 'MAĆKO', 'parenthetical': 'z nadzieją', 'spoken_text': 'Dobry Boże, czy to się dzieje naprawdę?'},
            {'type': 'action', 'text': 'Maćko wstaje z łóżka i podchodzi do okna.'},
        ]}))
        self.assertEqual([block['type'] for block in blocks], ['action', 'character', 'parenthetical', 'dialogue', 'action'])
        self.assertEqual(blocks[0]['text'], narrative)

    def test_invalid_persisted_blocks_are_rejected_before_applying(self):
        for value in ([], {}, [{'id': 'x', 'type': 'unknown', 'text': 'X'}],
                      [{'id': 'x', 'type': 'action', 'text': 'X'}] * 2):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                variant_editor_blocks(value)
        self.assertIsNone(variant_editor_blocks(None))
