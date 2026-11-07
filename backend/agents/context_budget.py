"""Choose a bounded Ollama context locally, without another model request."""

from dataclasses import dataclass, replace
from functools import lru_cache
import json
from pathlib import Path
from time import perf_counter

from tokenizers import Tokenizer

from backend.llm_config import OLLAMA_CONFIG
from backend.ollama import OllamaError


CONTEXT_WINDOWS = OLLAMA_CONFIG.context_windows
CONTEXT_MARGIN = OLLAMA_CONFIG.context_margin
# Conservative allowance for the fixed model's chat template, measured separately
# from message contents. Its local Ollama template currently adds about 81 tokens
# for a system/user pair; the allowance here is 160, plus CONTEXT_MARGIN.
MESSAGE_OVERHEAD = 64
GENERATION_OVERHEAD = 32


@lru_cache(maxsize=1)
def _tokenizer() -> Tokenizer:
    tokenizer = Tokenizer.from_file(str(Path(__file__).with_name('data') / 'bielik-tokenizer.json'))
    tokenizer.no_truncation()
    tokenizer.no_padding()
    return tokenizer


def count_input_tokens(messages: list[dict[str, str]]) -> int:
    return GENERATION_OVERHEAD + sum(
        len(_tokenizer().encode(message['content'], add_special_tokens=False).ids) + MESSAGE_OVERHEAD
        for message in messages
    )


@dataclass(frozen=True)
class PreparedContext:
    messages: list[dict[str, str]]
    num_ctx: int
    input_tokens: int
    max_tokens: int
    adjustments: tuple[str, ...]
    preparation_ms: float

    def metadata(self) -> dict:
        return {
            'num_ctx': self.num_ctx, 'input_tokens': self.input_tokens,
            'max_tokens': self.max_tokens, 'margin': CONTEXT_MARGIN,
            'adjustments': list(self.adjustments), 'preparation_ms': self.preparation_ms,
        }


def _window(input_tokens: int, max_tokens: int) -> int | None:
    required = input_tokens + max_tokens + CONTEXT_MARGIN
    return next((window for window in CONTEXT_WINDOWS if required <= window), None)


class ContextWindowPolicy:
    """Share a non-decreasing window across one run, avoiding model reload churn."""

    def __init__(self, *, max_tokens: int):
        minimum_input = GENERATION_OVERHEAD + 2 * MESSAGE_OVERHEAD
        self.window = _window(minimum_input, max_tokens)
        if self.window is None:
            raise OllamaError(
                f'Limit odpowiedzi {max_tokens} tokenów nie zostawia miejsca na wejście '
                f'w kontekście {CONTEXT_WINDOWS[-1]}. Zmniejsz maksymalną długość '
                'odpowiedzi w preferencjach AI.', status_code=422,
            )

    def apply(self, prepared: PreparedContext) -> PreparedContext:
        if prepared.num_ctx < self.window:
            return replace(prepared, num_ctx=self.window,
                           adjustments=prepared.adjustments + ('reuse_run_window',))
        self.window = prepared.num_ctx
        return prepared


def _compact_payload(content: str, adjustments: set[str]) -> str:
    try:
        payload = json.loads(content)
    except (ValueError, TypeError):
        return content
    if not isinstance(payload, dict):
        return content

    # Work on the decoded copy only. The source snapshot and database are untouched.
    context = payload.get('context')
    if isinstance(context, dict):
        for field in ('project', 'act', 'scene'):
            item = context.get(field)
            if isinstance(item, dict) and 'id' in item:
                del item['id']
                adjustments.add('technical_ids')
        characters = context.get('characters', [])
        if isinstance(characters, list):
            for character in characters:
                if isinstance(character, dict) and 'id' in character:
                    del character['id']
                    adjustments.add('technical_ids')
        scene = context.get('scene')
        editor = scene.get('editor_metadata') if isinstance(scene, dict) else None
        if isinstance(editor, dict):
            blocks = editor.get('blocks', [])
            if isinstance(blocks, list):
                for block in blocks:
                    if isinstance(block, dict) and 'id' in block:
                        del block['id']
                        adjustments.add('editor_block_ids')
            if 'applied_variant_ids' in editor:
                del editor['applied_variant_ids']
                adjustments.add('applied_variant_ids')
        previous = context.get('previous_scenes', [])
        if isinstance(previous, list):
            for scene in previous:
                if (isinstance(scene, dict) and isinstance(scene.get('summary'), str)
                        and scene['summary'].strip() and 'content_text' in scene):
                    del scene['content_text']
                    adjustments.add('existing_scene_summaries')

    compact = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    if compact != content:
        adjustments.add('compact_json')
    return compact


def prepare_context(messages: list[dict[str, str]], *, max_tokens: int) -> PreparedContext:
    started = perf_counter()
    if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or max_tokens < 1:
        raise ValueError('Limit odpowiedzi musi być dodatnią liczbą tokenów.')
    prepared = [dict(message) for message in messages]
    input_tokens = count_input_tokens(prepared)
    window = _window(input_tokens, max_tokens)
    adjustments: set[str] = set()
    if window is None:
        prepared = [
            {**message, 'content': _compact_payload(message['content'], adjustments)}
            if message['role'] == 'user' else message
            for message in prepared
        ]
        input_tokens = count_input_tokens(prepared)
        window = _window(input_tokens, max_tokens)
    if window is None:
        raise OllamaError(
            f'Za dużo danych dla kontekstu Bielika: wejście około {input_tokens} tokenów, '
            f'limit odpowiedzi {max_tokens}, zapas {CONTEXT_MARGIN}; dostępne maksymalnie '
            f'{CONTEXT_WINDOWS[-1]}. Skróć polecenie lub kontekst albo zmniejsz maksymalną '
            'długość odpowiedzi w preferencjach AI. Ważne dane nie zostały automatycznie ucięte.',
            status_code=422,
        )
    return PreparedContext(
        messages=prepared, num_ctx=window, input_tokens=input_tokens, max_tokens=max_tokens,
        adjustments=tuple(sorted(adjustments)), preparation_ms=round((perf_counter() - started) * 1000, 3),
    )
