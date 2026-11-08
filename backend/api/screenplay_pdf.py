"""Fixed US Letter screenplay layout; all measurements are PDF points (72/in).

12pt Courier, 12pt line pitch, 1.5in left / 1in right, top and bottom.
Pagination never scales the font to fit. Typed text is drawn literally, not HTML.
"""

from functools import lru_cache
from io import BytesIO
from pathlib import Path
import re
from textwrap import TextWrapper

from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

from .exporting import INDENTS


FONT = 'AgentDraftCourier'
SIZE = LEADING = 12
WIDTH, HEIGHT = letter
TOP, BOTTOM = HEIGHT - 72, 72
# The first baseline includes the font ascent, so the visible glyphs stay below TOP.


@lru_cache(maxsize=1)
def register_font():
    font = Path(__file__).resolve().parents[1] / 'assets/fonts/courier-prime/CourierPrime-Regular.ttf'
    pdfmetrics.registerFont(TTFont(FONT, str(font)))
    return pdfmetrics.getAscent(FONT, SIZE)


def wrap_text(value, kind):
    left, right = INDENTS[kind]
    # Use the embedded font's measured advance (approximately 7.2pt at 12pt).
    register_font()
    columns = int((right - left) / pdfmetrics.stringWidth('M', FONT, SIZE))
    wrapper = TextWrapper(width=columns, break_long_words=True, break_on_hyphens=False,
                          replace_whitespace=False, drop_whitespace=True)
    return [line for row in value.split('\n') for line in (wrapper.wrap(row) or [''])]


class ScreenplayPDF:
    def __init__(self, script):
        self.ascent = register_font()
        self.output = BytesIO()
        self.canvas = Canvas(self.output, pagesize=letter, pageCompression=1)
        self.canvas.setTitle(script.title)
        self.canvas.setAuthor(script.author)
        self.canvas.setCreator('AgentDraft')
        self.script = script
        self.page = 0  # Screenplay page number, excluding the title page.
        self.y = TOP - self.ascent

    def new_page(self):
        self.canvas.showPage()
        self.page += 1
        self.y = TOP - self.ascent
        self.canvas.setFont(FONT, SIZE)
        if self.page > 1:
            self.canvas.drawRightString(540, HEIGHT - 36, f'{self.page}.')

    def available(self):
        # Include descenders above the bottom margin too.
        descent = abs(pdfmetrics.getDescent(FONT, SIZE))
        return max(0, int((self.y - BOTTOM - descent) // LEADING) + 1)

    def draw(self, text, kind):
        left, right = INDENTS[kind]
        if kind == 'transition':
            self.canvas.drawRightString(right, self.y, text)
        else:
            self.canvas.drawString(left, self.y, text)
        self.y -= LEADING

    def gap(self):
        if self.y < TOP - self.ascent:
            self.y -= LEADING

    def title_page(self):
        self.canvas.setFont(FONT, SIZE)
        lines = wrap_text(self.script.title.upper(), 'action')
        # Long project names may wrap, without overflowing or changing the font.
        y = HEIGHT * .65
        for line in lines:
            if y < 144:
                self.canvas.showPage()
                self.canvas.setFont(FONT, SIZE)
                y = TOP - self.ascent
            self.canvas.drawCentredString(WIDTH / 2, y, line)
            y -= LEADING
        for value in ('', 'Scenariusz', '', *wrap_text(self.script.author, 'action')):
            if y < 72 + LEADING:
                self.canvas.showPage()
                self.canvas.setFont(FONT, SIZE)
                y = TOP - self.ascent
            self.canvas.drawCentredString(WIDTH / 2, y, value)
            y -= LEADING
        self.new_page()

    def paragraph(self, paragraph, following):
        lines = wrap_text(paragraph.text, paragraph.kind)
        self.gap()
        # Keep a scene heading with at least two lines of the next paragraph.
        required = min(len(lines), 2)
        if paragraph.kind == 'heading' and following:
            required = len(lines) + 1
            for next_paragraph in following:
                next_lines = wrap_text(next_paragraph.text, next_paragraph.kind)
                required += len(next_lines) if next_paragraph.kind in {'character', 'parenthetical'} else min(2, len(next_lines))
                if next_paragraph.kind not in {'character', 'parenthetical'} or required >= 48:
                    break
            required = min(required, 48)
        if self.available() < required:
            self.new_page()
        while lines:
            count = min(len(lines), self.available())
            if len(lines) > count and len(lines) - count == 1 and count > 2:
                count -= 1  # No one-line widows at the top of the next page.
            if count == 0:
                self.new_page()
                continue
            for line in lines[:count]:
                self.draw(line, paragraph.kind)
            lines = lines[count:]
            if lines:
                self.new_page()

    def speech(self, cue, speech):
        cue_lines = wrap_text(cue, 'character')
        # Flatten a speech, retaining the exact element type on every wrapped line.
        lines = [(paragraph.kind, line) for paragraph in speech
                 for line in wrap_text(paragraph.text, paragraph.kind)]
        self.gap()
        continued = False
        while lines:
            character = cue_lines if not continued else wrap_text(
                re.sub(r"\s*\(CONT['’]D\)$", '', cue) + " (CONT'D)", 'character',
            )
            first_dialogue = next((i for i, (kind, _) in enumerate(lines) if kind == 'dialogue'), 0)
            minimum = len(character) + min(len(lines), first_dialogue + 2)
            # A pathological multi-page parenthetical must still make progress.
            minimum = min(minimum, 48)
            if self.available() < minimum:
                self.new_page()
            for line in character:
                self.draw(line, 'character')
            room = self.available()
            if len(lines) <= room:
                for kind, line in lines:
                    self.draw(line, kind)
                return
            count = room - 1  # Reserve a line for (MORE).
            # A parenthetical belongs to the following line, not the previous page.
            while count > 1 and lines[count - 1][0] == 'parenthetical':
                count -= 1
            for kind, line in lines[:count]:
                self.draw(line, kind)
            self.draw('(MORE)', 'character')
            lines = lines[count:]
            continued = True
            self.new_page()

    def render(self):
        self.title_page()
        paragraphs = self.script.paragraphs
        index = 0
        while index < len(paragraphs):
            paragraph = paragraphs[index]
            next_index = index + 1
            if paragraph.kind == 'character':
                while next_index < len(paragraphs) and paragraphs[next_index].kind in {'dialogue', 'parenthetical'}:
                    next_index += 1
                if next_index > index + 1:
                    self.speech(paragraph.text, paragraphs[index + 1:next_index])
                else:
                    self.paragraph(paragraph, None)
            else:
                following = paragraphs[next_index:]
                self.paragraph(paragraph, following)
            index = next_index
        self.canvas.save()
        return self.output.getvalue()


def export_pdf(script):
    return ScreenplayPDF(script).render()
