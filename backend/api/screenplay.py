"""Validate model output and translate it to the editor's existing block format."""

from uuid import uuid4
import re

from django.core.exceptions import ValidationError
from pydantic import TypeAdapter, ValidationError as PydanticValidationError

from backend.ollama import OllamaError
from .scheams import EditorBlock, GeneratedHeading, GeneratedScene, GeneratedSceneWithHeading


class SceneStructureError(OllamaError):
    """The model returned a fragment that cannot be saved as one structured scene."""


SCENE_BOUNDARY = re.compile(
    r'^[ \t]*(?:(?:WN|PL|INT|EXT)\.[ \t]+|(?:CIĘCIE DO|PRZENIKANIE DO|CUT TO|DISSOLVE TO|FADE IN)[ \t]*:'
    r'|(?:ŚCIEMNIENIE|ROZJAŚNIENIE|FADE OUT)\.?[ \t]*$)',
    re.IGNORECASE | re.MULTILINE,
)
SCENE_BOUNDARY_ERROR = 'Model próbował rozpocząć kolejną scenę w tym samym wariancie.'


def _parse_generation(answer, allow_heading=False):
    try:
        schema = GeneratedSceneWithHeading if allow_heading else GeneratedScene
        return schema.model_validate_json(answer)
    except PydanticValidationError as error:
        if any(issue.get('ctx', {}).get('tag') == 'transition' for issue in error.errors()):
            raise SceneStructureError(SCENE_BOUNDARY_ERROR) from error
        raise OllamaError('Model zwrócił nieprawidłowy format sceny. Spróbuj ponownie.') from error


def generated_scene_blocks(answer):
    return _generated_blocks(_parse_generation(answer))


def _generated_blocks(scene):
    blocks = []

    def add(kind, text):
        blocks.append({'id': str(uuid4()), 'type': kind, 'text': text})

    for block in scene.blocks:
        if block.type == 'speech':
            add('character', block.speaker.upper())
            if block.parenthetical is not None:
                direction = block.parenthetical.strip('()').strip()
                if not direction:
                    raise OllamaError('Model zwrócił puste didaskalia. Spróbuj ponownie.')
                add('parenthetical', f'({direction})')
            add('dialogue', block.spoken_text)
        else:
            add('action', block.text)
    return blocks


def model_heading(heading):
    """Compose the standard heading from an explicit interior/exterior choice."""
    place = re.sub(r'^(?:miejsce|lokalizacja|nagłówek(?: sceny)?)\s*:\s*', '', heading.location_heading, flags=re.I)
    place = re.sub(r'^(?:(?:WN|PL|INT|EXT)\.?\s+)+', '', place, flags=re.I)
    place = re.sub(r'\s*[-–—]\s*' + re.escape(heading.time_of_day) + r'\.?\s*$', '', place, flags=re.I)
    place = ' '.join(place.split()).strip(' .')
    if not place:
        raise OllamaError('Model zwrócił pustą nazwę miejsca. Spróbuj ponownie.')
    return {'location_heading': f'{heading.location_type} {place.upper()}', 'time_of_day': heading.time_of_day}


def remove_heading_blocks(blocks, heading):
    """Drop redundant leading heading-only action paragraphs, never narrative paragraphs."""
    if not heading:
        return blocks
    def normalized(text):
        return re.sub(r'\s+', ' ', text).strip(' .').casefold()
    expected = {
        normalized(heading['location_heading']),
        normalized(f'{heading["location_heading"]} - {heading["time_of_day"]}'),
        normalized(f'{heading["location_heading"]} – {heading["time_of_day"]}'),
        normalized(f'{heading["location_heading"]} — {heading["time_of_day"]}'),
    }
    index = 0
    while index < len(blocks) and blocks[index]['type'] == 'action':
        text = blocks[index]['text']
        if normalized(text) not in expected and not re.fullmatch(
            r'(?:miejsce|lokalizacja|pora dnia|nagłówek(?: sceny)?)\s*:\s*[^\n]+', text, flags=re.I,
        ):
            break
        index += 1
    return blocks[index:]


def variant_editor_blocks(value):
    """Validate persisted blocks before appending; None denotes a legacy text variant."""
    if value is None:
        return None
    try:
        blocks = TypeAdapter(list[EditorBlock]).validate_python(value)
        if not blocks or len({block.id for block in blocks}) != len(blocks):
            raise ValueError('Empty blocks or duplicate IDs')
    except (PydanticValidationError, ValueError) as error:
        raise ValidationError({'blocks': 'Wariant ma nieprawidłowe bloki i nie może zostać zastosowany.'}) from error
    return [block.model_dump() for block in blocks]


def blocks_text(blocks):
    return '\n\n'.join(block['text'] for block in blocks)


def _direction_details(text):
    direction = text.strip().strip('()').strip()
    key = re.sub(r'[\W_]+', ' ', direction.casefold()).strip()
    # Remove redundant self-addressing without losing an explicit vocal direction.
    direction = {
        'do siebie': '', 'mówiąc do siebie': '', 'mówi do siebie': '',
        'szeptem do siebie': 'szeptem', 'głośno do siebie': 'głośno',
        'cicho do siebie': 'cicho', 'półgłosem do siebie': 'półgłosem',
    }.get(key, direction)
    return direction, re.sub(r'[\W_]+', ' ', direction.casefold()).strip()


def refine_parentheticals(blocks, existing_blocks, policy):
    """Refine new AI directions only, preserving speech, actions and authored history."""
    if policy == 'ignore':
        return [block for block in blocks if block['type'] != 'parenthetical']
    last_direction = {}
    speaker = None
    for block in existing_blocks:
        if block['type'] == 'character':
            speaker = ' '.join(block['text'].casefold().split())
        elif block['type'] in {'action', 'transition'}:
            speaker = None
        elif block['type'] == 'parenthetical' and speaker:
            _, key = _direction_details(block['text'])
            if key:
                last_direction[speaker] = key
    result = []
    recovered_speakers = set()
    for block in blocks:
        if block['type'] == 'character':
            speaker = ' '.join(block['text'].casefold().split())
        elif block['type'] in {'action', 'transition'}:
            speaker = None
        if block['type'] == 'parenthetical':
            raw = block['text'].strip().strip('()').strip()
            named_direction = speaker and raw.casefold().startswith(speaker + ' ')
            if named_direction:
                # A prose sentence about the speaker is not an acting cue.
                # Recover at most one short delivery hint per speaker.
                match = re.fullmatch(
                    re.escape(speaker) + r'\s+(?:mówi|odpowiada|pyta|dodaje)\s+([^.!?]+)[.!?]?',
                    raw, flags=re.IGNORECASE,
                )
                if not match or speaker in recovered_speakers:
                    continue
                raw = match[1]
            direction, key = _direction_details(raw)
            if not key or len(key.split()) > 5 or (speaker and last_direction.get(speaker) == key):
                continue
            if speaker:
                last_direction[speaker] = key
            if named_direction:
                recovered_speakers.add(speaker)
            block = {**block, 'text': f'({direction})'}
        result.append(block)
    return result


def scene_has_text(scene):
    blocks = scene.get('editor_metadata', {}).get('blocks')
    return bool(scene.get('content_text', '').strip()) or any(
        isinstance(block, dict) and isinstance(block.get('text'), str) and block['text'].strip()
        for block in (blocks if isinstance(blocks, list) else [])
    )


def can_generate_heading(scene):
    return not scene_has_text(scene) and not scene.get('location_heading', '').strip() and not scene.get('time_of_day', '').strip()


def scene_output_schema(scene):
    return (GeneratedSceneWithHeading if can_generate_heading(scene) else GeneratedScene).model_json_schema()


def remove_repeated_prefix(existing_text, blocks):
    """Remove only an exact suffix/prefix overlap at word boundaries, including partial paragraphs."""
    words = []
    positions = []
    for index, block in enumerate(blocks):
        for word in re.finditer(r'\S+', block['text']):
            words.append(word.group().casefold())
            positions.append((index, word.end()))
    if not words or not existing_text.strip():
        return blocks
    # KMP finds the longest matching suffix in linear time, without fuzzy deletion.
    sequence = words + [None] + [word.casefold() for word in existing_text.split()][-len(words):]
    prefix = [0] * len(sequence)
    for index in range(1, len(sequence)):
        matched = prefix[index - 1]
        while matched and sequence[index] != sequence[matched]:
            matched = prefix[matched - 1]
        if sequence[index] == sequence[matched]:
            matched += 1
        prefix[index] = matched
    overlap = prefix[-1]
    # A lone repeated name/word is too ambiguous to remove automatically.
    if overlap < 2:
        return blocks
    index, end = positions[overlap - 1]
    remainder = blocks[index]['text'][end:].lstrip()
    return ([{**blocks[index], 'text': remainder}] if remainder else []) + blocks[index + 1:]


def generated_continuation(answer, scene, *, parentheticals='sparingly'):
    parsed = _parse_generation(answer, can_generate_heading(scene))
    heading = model_heading(parsed.heading) if isinstance(parsed, GeneratedSceneWithHeading) else None
    blocks = _generated_blocks(parsed)
    blocks = remove_heading_blocks(blocks, heading or {
        'location_heading': scene.get('location_heading', ''), 'time_of_day': scene.get('time_of_day', ''),
    })
    if not blocks:
        raise OllamaError('Model zwrócił sam nagłówek bez treści sceny. Spróbuj ponownie.')
    if any(block['type'] == 'action' and SCENE_BOUNDARY.search(block['text']) for block in blocks):
        raise SceneStructureError(SCENE_BOUNDARY_ERROR)
    if any(block['type'] == 'action' and len(block['text']) > 600 for block in blocks):
        raise SceneStructureError('Model zwrócił zbyt długi blok akcji. Skróć polecenie do jednego fragmentu sceny.')
    previous_blocks = existing_scene_blocks(scene)
    original = scene.get('content_text', '')
    if not original.strip():
        original = blocks_text(previous_blocks)
    blocks = remove_repeated_prefix(original, blocks)
    # The model sometimes copies only action, skipping dialogue between paragraphs.
    first_non_action = next((i for i, block in enumerate(blocks) if block['type'] != 'action'), len(blocks))
    previous_action = blocks_text([block for block in previous_blocks if block['type'] == 'action'])
    if previous_action.strip() != original.strip():
        blocks = remove_repeated_prefix(previous_action, blocks[:first_non_action]) + blocks[first_non_action:]
    if not blocks:
        raise OllamaError('Model powtórzył wyłącznie istniejącą treść. Spróbuj ponownie wygenerować dalszy ciąg.')
    blocks = refine_parentheticals(blocks, previous_blocks, parentheticals)
    return blocks, heading


def existing_scene_blocks(scene):
    """Preserve manually authored blocks verbatim, including IDs, whitespace and blank paragraphs."""
    value = scene.get('editor_metadata', {}).get('blocks')
    types = {'action', 'character', 'dialogue', 'parenthetical', 'transition'}
    if isinstance(value, list) and all(
        isinstance(block, dict) and isinstance(block.get('id'), str) and block['id'] and
        isinstance(block.get('type'), str) and block['type'] in types and isinstance(block.get('text'), str) for block in value
    ) and len({block['id'] for block in value}) == len(value):
        if any(block['text'].strip() for block in value):
            return [dict(block) for block in value]
        if not scene.get('content_text', '').strip():
            return []
    text = scene.get('content_text', '')
    return [{'id': str(uuid4()), 'type': 'action', 'text': text}] if text.strip() else []


def append_variant(scene, variant):
    metadata = dict(scene.editor_metadata)
    applied = metadata.get('applied_variant_ids', [])
    applied = [value for value in applied if isinstance(value, int)] if isinstance(applied, list) else []
    if variant.pk in applied:
        return None
    current = {
        'content_text': scene.content_text, 'editor_metadata': metadata,
        'location_heading': scene.location_heading, 'time_of_day': scene.time_of_day,
    }
    old_blocks = existing_scene_blocks(current)
    addition = variant_editor_blocks(variant.critic_metadata.get('blocks'))
    if addition is None:
        addition = [{'id': str(uuid4()), 'type': 'action', 'text': variant.generated_full_text}]
    source = variant.run.request.context_snapshot.get('scene')
    apply_heading = isinstance(source, dict) and can_generate_heading(current) and can_generate_heading(source)
    if isinstance(source, dict):
        addition = remove_repeated_prefix(source.get('content_text', ''), addition)
    base_text = scene.content_text if scene.content_text.strip() else blocks_text(old_blocks)
    addition = remove_repeated_prefix(base_text, addition)
    if old_blocks and addition and old_blocks[-1]['type'] == addition[0]['type'] == 'character' and old_blocks[-1]['text'].strip().casefold() == addition[0]['text'].strip().casefold():
        addition = addition[1:]
    used_ids = {block['id'] for block in old_blocks}
    for block in addition:
        if block['id'] in used_ids:
            block['id'] = str(uuid4())
        used_ids.add(block['id'])
    metadata['blocks'] = old_blocks + addition
    metadata['applied_variant_ids'] = [*applied, variant.pk]
    extra_text = blocks_text(addition)
    changes = {
        'content_text': base_text + ('\n\n' if base_text.strip() and extra_text else '') + extra_text,
        'editor_metadata': metadata,
    }
    heading = variant.critic_metadata.get('heading')
    if heading is not None and apply_heading:
        try:
            changes.update(GeneratedHeading.model_validate(heading).model_dump())
        except PydanticValidationError as error:
            raise ValidationError({'heading': 'Wariant ma nieprawidłowy nagłówek.'}) from error
    return changes
