"""Turn the director's beats and the archivist's context into screenplay text."""

import json
from dataclasses import dataclass
from typing import Any, TypedDict

from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama
from langsmith import tracing_context

from backend.api.screenplay import blocks_text, can_generate_heading, compose_generated_continuation
from backend.screenplay_schemas import GeneratedScene, GeneratedSceneWithHeading

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
     'Jesteś Scenarzystą. Napisz po polsku fragment jednej sceny filmowej według polecenia autora '
     'i planu Reżysera. Zrealizuj każdy punkt w podanej kolejności. Pokaż wynikające z niego '
     'zdarzenie w akcji lub dialogu, bez przepisywania punktów i bez dopisywania kolejnego wątku. '
     'Korzystaj z profili postaci i faktów Archiwisty. Zachowaj stan wiedzy każdej postaci. '
     'Dla każdej wypowiedzi dopasuj słownictwo, rytm zdań i sposób zwracania się do innych do '
     'voice_profile lub opisu mowy danej postaci. Nie mieszaj głosów bohaterów. '
     'Jeśli plan przewiduje rozmowę, napisz faktycznie wypowiadane kwestie. Jeśli akcja wystarcza, '
     'scena może być niema. Zwróć obiekt JSON z listą blocks. Każdy blok akcji ma type równy action '
     'oraz text w czasie teraźniejszym. Blok wypowiedzi ma type równy speech, nazwę postaci w speaker, '
     'jej kwestię w spoken_text i wskazówkę aktorską w parenthetical. Jeśli wskazówka jest zbędna '
     'lub preferencje autora jej nie dopuszczają, wpisz w parenthetical null. '
     'Pozostań w miejscu i czasie bieżącej sceny. Przy kontynuacji zacznij po ostatnim zapisanym '
     'zdarzeniu. W blocks nie umieszczaj nagłówków, przejść, numerów punktów ani komentarzy. '
     'Jeśli otrzymasz revision, zwróć kompletną poprawioną wersję previous_draft. '
     'Zastosuj required_changes, zachowaj poprawne fragmenty i plan. '
     'Nie dopisuj dalszego ciągu do poprzedniego wariantu i nie przepisuj tekstu zapisanego w context.scene. '
     'Uwzględnij wariant podejścia, preferowany ton dialogu i styl opisu akcji z context. '
     '{heading_instruction}{format_instruction}'),
    ('human', '{payload}'),
])


class ScenaristAgent:
    def __init__(self, model: ChatOllama | None = None):
        if model is None:
            model = create_local_chat_model(timeout=SCENE_WRITE_TIMEOUT, max_tokens=2048)
        self._write_body = WRITE_SCENE | model.with_structured_output(GeneratedScene, method='json_schema')
        self._write_with_heading = WRITE_SCENE | model.with_structured_output(
            GeneratedSceneWithHeading, method='json_schema',
        )

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
        payload: dict[str, Any] = {'user_prompt': user_prompt, 'context': context, 'beats': plan.beats}
        if revision is not None:
            payload['revision'] = revision
        chain = self._write_with_heading if generate_heading else self._write_body
        heading_instruction = (
            'Scena jest pusta. Dodaj heading z polami location_type (WN. lub PL.), location_heading '
            '(sama nazwa miejsca) i time_of_day (np. DZIEŃ lub NOC), zgodnymi z pierwszym punktem planu.'
            if generate_heading else 'Zwróć same bloki sceny, bez nagłówka.'
        )
        with tracing_context(enabled=False):
            generated = chain.invoke({
                'payload': json.dumps(payload, ensure_ascii=False),
                'heading_instruction': heading_instruction,
                'format_instruction': f'\nPOPRAW FORMAT: {format_feedback}' if format_feedback else '',
            })

        parentheticals = context.get('writing_style_preferences', {}).get('parentheticals', 'sparingly')
        blocks, heading = compose_generated_continuation(generated, scene, parentheticals=parentheticals)
        text = blocks_text(blocks)
        if heading:
            text = f'{heading["location_heading"]} - {heading["time_of_day"]}\n\n{text}'
        return SceneDraft(text=text, blocks=blocks, heading=heading)
