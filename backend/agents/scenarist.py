"""Turn the director's beats and the archivist's context into screenplay text."""

import json
from dataclasses import dataclass
from typing import Any, TypedDict

from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama
from langsmith import tracing_context

from backend.api.screenplay import blocks_text, can_generate_heading, compose_generated_continuation
from backend.screenplay_schemas import canonical_speaker_name, generated_scene_schema

from ._model import create_local_chat_model
from .director import ScenePlan


SCENE_WRITE_TIMEOUT = 300


class SceneRevision(TypedDict):
    previous_draft: str
    feedback: str
    required_changes: list[dict[str, str]]


@dataclass(frozen=True)
class SceneDraft:
    text: str
    blocks: list[dict[str, str]]
    heading: dict[str, str] | None


WRITE_SCENE = ChatPromptTemplate.from_messages([
    ('system',
     'Jesteś Scenarzystą. Zrealizuj po polsku user_prompt i wszystkie beats w kolejności: '
     'jedna scena, bez nowych wątków i przepisywania planu. Zachowaj fakty Archiwisty, profile i wiedzę postaci. '
     'Głosy (słownictwo, rytm, zwroty) według voice_profile lub opisu mowy; nie mieszaj ich. '
     'action: widoczne działania, trzecia osoba, czas teraźniejszy. '
     'speech: słowa wypowiadane na głos, bez początkowej kropki, punktora, numeracji ani myślnika dialogowego. '
     'Dialog opcjonalny, konieczny przy rozmowie w planie. '
     'parenthetical: krótka potrzebna wskazówka lub null; respektuj preferencje autora. '
     '{speaker_instruction}'
     'Kontynuuj context.scene bez powtórzeń, w tym samym miejscu i czasie. '
     'Bloki bez nagłówków, przejść, numeracji i komentarzy. '
     '{revision_instruction}'
     'Uwzględnij variant_approach, ton dialogów i styl akcji z context. '
     '{heading_instruction}{format_instruction}'),
    ('human', '{payload}'),
])


class ScenaristAgent:
    def __init__(self, model: ChatOllama | None = None):
        if model is None:
            model = create_local_chat_model(timeout=SCENE_WRITE_TIMEOUT, max_tokens=2048)
        self._model = model

    def write_scene(
        self, *, user_prompt: str, context: dict[str, Any], beats: list[str],
        revision: SceneRevision | None = None,
    ) -> str:
        """Return the formatted text of the generated fragment."""
        return self.write_scene_draft(
            user_prompt=user_prompt, context=context, beats=beats, revision=revision,
        ).text

    def write_scene_draft(
        self, *, user_prompt: str, context: dict[str, Any], beats: list[str],
        revision: SceneRevision | None = None, format_feedback: str = '',
    ) -> SceneDraft:
        """Generate a structured fragment from the archive and the director's ordered beats.

        Optional context keys scene and writing_style_preferences describe the saved draft and style.
        A generated heading is included when scene is supplied and has neither text nor a heading.
        """
        if not user_prompt.strip():
            raise ValueError('Podaj polecenie autora do napisania sceny.')
        plan = ScenePlan(beats=beats)
        scene = context.get('scene', {})
        generate_heading = 'scene' in context and can_generate_heading(scene)
        names = context.get('selected_character_names')
        if names is None:
            names = [character.get('name') for character in context.get('characters', [])]
        speaker_names = tuple(dict.fromkeys(
            canonical_speaker_name(name) for name in names if isinstance(name, str) and name.strip()
        ))
        schema = generated_scene_schema(speaker_names=speaker_names, with_heading=generate_heading)
        chain = WRITE_SCENE | self._model.with_structured_output(schema, method='json_schema')
        payload: dict[str, Any] = {'user_prompt': user_prompt, 'context': context, 'beats': plan.beats}
        if revision is not None:
            payload['revision'] = revision
        speaker_instruction = (
            'Etykiety speaker wyłącznie: '
            f'{json.dumps(speaker_names, ensure_ascii=False)}. '
            'Role i pokrewieństwo tylko w akcji lub spoken_text. '
            if speaker_names else ''
        )
        heading_instruction = (
            'Scena jest pusta. Dodaj heading z polami location_type (WN. lub PL.), location_heading '
            '(sama nazwa miejsca) i time_of_day (np. DZIEŃ lub NOC), zgodnymi z pierwszym punktem planu.'
            if generate_heading else 'Zwróć same bloki sceny, bez nagłówka.'
        )
        with tracing_context(enabled=False):
            generated = chain.invoke({
                'payload': json.dumps(payload, ensure_ascii=False),
                'speaker_instruction': speaker_instruction,
                'heading_instruction': heading_instruction,
                'revision_instruction': (
                    'Dla revision popraw cały previous_draft według required_changes i feedback; '
                    'zachowaj dobre fragmenty i plan, nie dopisuj kontynuacji. '
                    if revision is not None else ''
                ),
                'format_instruction': f'\nPOPRAW FORMAT: {format_feedback}' if format_feedback else '',
            })

        parentheticals = context.get('writing_style_preferences', {}).get('parentheticals', 'sparingly')
        blocks, heading = compose_generated_continuation(generated, scene, parentheticals=parentheticals)
        text = blocks_text(blocks)
        if heading:
            text = f'{heading["location_heading"]} - {heading["time_of_day"]}\n\n{text}'
        return SceneDraft(text=text, blocks=blocks, heading=heading)
