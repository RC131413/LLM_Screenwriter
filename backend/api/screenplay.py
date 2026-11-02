"""Validate model output and translate it to the editor's existing block format."""

from uuid import uuid4

from django.core.exceptions import ValidationError
from pydantic import TypeAdapter, ValidationError as PydanticValidationError

from backend.ollama import OllamaError
from .scheams import EditorBlock, GeneratedScene


def generated_scene_blocks(answer):
    try:
        scene = GeneratedScene.model_validate_json(answer)
    except PydanticValidationError as error:
        raise OllamaError('Model zwrócił nieprawidłowy format sceny. Spróbuj ponownie.') from error

    blocks = []
    speaker_active = False
    awaiting_dialogue = False
    for block in scene.blocks:
        kind, text = block.type, block.text
        if kind in {'action', 'character', 'transition'}:
            if awaiting_dialogue:
                raise OllamaError('Model zwrócił postać bez przypisanego dialogu. Spróbuj ponownie.')
            speaker_active = kind == 'character'
            awaiting_dialogue = speaker_active
        elif not speaker_active:
            raise OllamaError('Model zwrócił dialog lub didaskalia bez wskazania postaci. Spróbuj ponownie.')
        if kind == 'dialogue':
            awaiting_dialogue = False
        elif kind in {'character', 'transition'}:
            text = text.upper()
        elif kind == 'parenthetical':
            direction = text.strip('()').strip()
            if not direction:
                raise OllamaError('Model zwrócił puste didaskalia. Spróbuj ponownie.')
            text = f'({direction})'
        blocks.append({'id': str(uuid4()), 'type': kind, 'text': text})
    if awaiting_dialogue:
        raise OllamaError('Model zakończył scenę nazwą postaci bez dialogu. Spróbuj ponownie.')
    return blocks


def variant_editor_blocks(value):
    """Validate persisted blocks before replacing the scene; None denotes a legacy text variant."""
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
