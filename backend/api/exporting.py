"""Read-only screenplay exports, using the editor's typed blocks as the source.

Formatting references: https://fountain.io/syntax/ and
https://www.finaldraft.com/blog/what-are-the-margins-for-a-screenplay
FDX uses absolute left/right tab positions in inches (not CSS margin widths).
"""

from dataclasses import dataclass
import re
import unicodedata
from xml.etree import ElementTree as ET


ELEMENTS = {
    'heading': 'Scene Heading', 'action': 'Action', 'character': 'Character',
    'dialogue': 'Dialogue', 'parenthetical': 'Parenthetical', 'transition': 'Transition',
}
# Absolute coordinates in points, measured from the left edge of US Letter.
INDENTS = {
    'heading': (108, 540), 'action': (108, 540), 'character': (266.4, 540),
    'dialogue': (180, 432), 'parenthetical': (223.2, 403.2), 'transition': (360, 540),
}


@dataclass(frozen=True)
class Paragraph:
    kind: str
    text: str


@dataclass(frozen=True)
class Screenplay:
    title: str
    author: str
    paragraphs: tuple[Paragraph, ...]


def clean_text(value):
    """Keep author text literal; exclude characters invalid in XML 1.0/PDF text."""
    value = unicodedata.normalize('NFC', value.replace('\r\n', '\n').replace('\r', '\n'))
    return ''.join(char for char in value if char in '\n\t' or
                   0x20 <= ord(char) <= 0xD7FF or 0xE000 <= ord(char) <= 0xFFFD or
                   0x10000 <= ord(char) <= 0x10FFFF).replace('\t', '    ').strip()


def normalized_paragraph(kind, text):
    text = clean_text(text)
    if kind in {'heading', 'character', 'transition'}:
        text = ' '.join(text.split()).upper()
    elif kind == 'parenthetical' and text:
        text = '(' + text.removeprefix('(').removesuffix(')').strip() + ')'
    return Paragraph(kind, text)


def project_screenplay(project):
    paragraphs = []
    scenes = project.scenes.select_related('act').order_by(
        'act__sort_order', 'act__act_number', 'act__pk', 'sort_order', 'scene_number', 'pk',
    )
    for scene in scenes:
        location, time = scene.location_heading.strip(), scene.time_of_day.strip()
        if time:
            location = re.sub(r'\s*[-–—]\s*' + re.escape(time) + r'\s*$', '', location, flags=re.I)
        heading = ' - '.join(value for value in (location, time) if value)
        if heading:
            paragraphs.append(normalized_paragraph('heading', heading))
        metadata = scene.editor_metadata if isinstance(scene.editor_metadata, dict) else {}
        blocks = metadata.get('blocks')
        valid = isinstance(blocks, list) and all(
            isinstance(block, dict) and isinstance(block.get('id'), str) and isinstance(block.get('type'), str)
            and block['type'] in ELEMENTS and block['type'] != 'heading'
            and isinstance(block.get('text'), str) for block in blocks
        )
        valid = valid and len({block['id'] for block in blocks}) == len(blocks)
        if valid:
            paragraphs.extend(normalized_paragraph(block['type'], block['text']) for block in blocks)
        else:
            # Old/plain-text scenes have no reliable element types: never guess a speaker.
            paragraphs.extend(normalized_paragraph('action', text) for text in scene.content_text.split('\n\n'))
    profile = getattr(project.user, 'profile', None)
    author = profile.display_name if profile and profile.display_name else project.user.username
    return Screenplay(clean_text(project.title), clean_text(author), tuple(p for p in paragraphs if p.text))


def fountain_text(value):
    # Author input is plain text, not Fountain markup (including notes/boneyards).
    return re.sub(r'([\\*_\[\]/])', r'\\\1', value)


def export_fountain(script):
    lines = ['Title:', *('    ' + fountain_text(line) for line in script.title.splitlines()),
             'Credit: Scenariusz', 'Author:',
             *('    ' + fountain_text(line) for line in script.author.splitlines()), '', '']
    previous = None
    for paragraph in script.paragraphs:
        kind, value = paragraph.kind, fountain_text(paragraph.text)
        speech = kind in {'dialogue', 'parenthetical'} and previous in {'character', 'parenthetical', 'dialogue'}
        if not speech and lines[-1] != '':
            lines.append('')
        if kind == 'heading':
            value = '.' + value
        elif kind == 'character':
            value = '@' + value
        elif kind == 'transition':
            value = '> ' + value
        elif kind == 'action':
            value = '!'+value
        # Two spaces represent an intentional blank line inside a speech.
        lines.extend(line if line else '  ' for line in value.split('\n'))
        previous = kind
    return ('\n'.join(lines).rstrip() + '\n').encode('utf-8')


def export_fdx(script):
    root = ET.Element('FinalDraft', DocumentType='Script', Template='No', Version='1')
    content = ET.SubElement(root, 'Content')
    for paragraph in script.paragraphs:
        node = ET.SubElement(content, 'Paragraph', Type=ELEMENTS[paragraph.kind])
        ET.SubElement(node, 'Text').text = paragraph.text
    layout = ET.SubElement(root, 'PageLayout', TopMargin='72', BottomMargin='72',
                           HeaderMargin='36', FooterMargin='36', DocumentLeading='Normal')
    ET.SubElement(layout, 'PageSize', Width='8.50', Height='11.00')
    for kind, element in ELEMENTS.items():
        left, right = INDENTS[kind]
        settings = ET.SubElement(root, 'ElementSettings', Type=element)
        ET.SubElement(settings, 'FontSpec', Font='Courier New', Size='12', Style='')
        ET.SubElement(settings, 'ParagraphSpec', Alignment='Right' if kind == 'transition' else 'Left',
                      FirstIndent='0.00', Leading='Regular', LeftIndent=f'{left / 72:.2f}',
                      RightIndent=f'{right / 72:.2f}', Spacing='1',
                      SpaceBefore='0' if kind in {'dialogue', 'parenthetical'} else '12', StartsNewPage='No')
        ET.SubElement(settings, 'Behavior', PaginateAs=element)
    header = ET.SubElement(root, 'HeaderAndFooter', HeaderFirstPage='No', HeaderVisible='Yes',
                           FooterFirstPage='No', FooterVisible='No', StartingPage='1')
    number = ET.SubElement(ET.SubElement(header, 'Header'), 'Paragraph', Alignment='Right',
                           LeftIndent='1.50', RightIndent='7.50')
    ET.SubElement(number, 'DynamicLabel', Type='Page #')
    ET.SubElement(number, 'Text', Font='Courier New', Size='12').text = '.'
    # A separate title page; no account email/contact details are published.
    title = ET.SubElement(ET.SubElement(root, 'TitlePage'), 'Content')
    for text, before in ((script.title.upper(), '216'), ('Scenariusz', '24'), (script.author, '12')):
        para = ET.SubElement(title, 'Paragraph', Type='General', Alignment='Center',
                             LeftIndent='1.50', RightIndent='7.50', SpaceBefore=before)
        ET.SubElement(para, 'Text', Font='Courier New', Size='12').text = text
    ET.indent(root, space='  ')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)
