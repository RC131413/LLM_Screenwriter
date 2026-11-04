"""Plan a single screenplay scene from the context supplied by the caller."""

import json
import re
from typing import Annotated, Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama
from langsmith import tracing_context
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from ._model import create_local_chat_model


Beat = Annotated[str, StringConstraints(
    strip_whitespace=True, min_length=1, max_length=220, pattern=r'^[^\r\n:"„“”«»]+$',
)]
NON_BEAT_PREFIX = re.compile(r'^(?:[-–—]|\d+[.)]\s|(?:WN|PL|INT|EXT)\.\s)', re.IGNORECASE)


class ScenePlan(BaseModel):
    model_config = ConfigDict(extra='forbid')

    beats: list[Beat] = Field(
        min_length=1, max_length=8,
        description='Krótkie, uporządkowane punkty planu po polsku, po jednym zdarzeniu w każdym.',
    )

    @field_validator('beats')
    @classmethod
    def reject_screenplay_markers(cls, beats: list[str]) -> list[str]:
        if any(NON_BEAT_PREFIX.match(beat) for beat in beats):
            raise ValueError('Punkt planu nie powinien zawierać numeracji, nagłówka ani zapisu dialogowego.')
        return beats


PLAN_SCENE = ChatPromptTemplate.from_messages([
    ('system',
     'Jesteś Reżyserem planującym jedną scenę filmową dla Scenarzysty. '
     'W polu beats zwróć wyłącznie uporządkowane punkty po polsku. Zwykle wystarczą 3–6 krótkich punktów, '
     'a przy bardzo prostej scenie mniej. Każdy punkt to jedno zdanie planu opisujące '
     'jedno wydarzenie, odkrycie albo decyzję. Ułóż je w kolejności wydarzeń, tak aby kolejny '
     'punkt wynikał z poprzedniego. Pisz w formie roboczych notatek. '
     'Polecenie autora określa kierunek fabuły. Uwzględnij też podany cel sceny, profile postaci '
     'i fakty Archiwisty. Zachowaj to, co postacie już wiedzą. Przy kontynuacji zacznij po ostatnim '
     'ustalonym wydarzeniu i zachowaj ustalone miejsce oraz czas. Nie powtarzaj wcześniejszej akcji '
     'i nie traktuj planów z opisu aktu jako zdarzeń, które już zaszły. '
     'Każdy punkt powinien zmienić sytuację. Samą emocję zastąp działaniem, które z niej wynika. '
     'Zakończ konkretnym rezultatem albo decyzją wskazującą następny krok postaci, bez rozpisywania następnej sceny. '
     'Pomiń dialogi, cytaty, didaskalia, nagłówki, przejścia i gotową prozę scenariuszową. '
     'Jeśli rozmowa jest istotna, opisz w mowie zależnej, co ktoś próbuje ustalić albo ujawnić. '
     'Nie dodawaj etykiet, dwukropków ani numeracji do punktów. Przykład punktu '
     '„Bohater prosi sąsiadkę o alibi, ale ona odmawia”.'),
    ('human', '{payload}'),
])


class DirectorAgent:
    def __init__(self, model: ChatOllama | None = None):
        if model is None:
            model = create_local_chat_model()
        self._plan_scene = PLAN_SCENE | model.with_structured_output(ScenePlan, method='json_schema')

    def plan_scene(self, *, user_prompt: str, context: dict[str, Any]) -> list[str]:
        """Return ordered beats from the author instruction and a JSON-ready context."""
        if not user_prompt.strip():
            raise ValueError('Podaj polecenie autora do zaplanowania sceny.')
        payload = json.dumps({'user_prompt': user_prompt, 'context': context}, ensure_ascii=False)
        with tracing_context(enabled=False):
            plan = self._plan_scene.invoke({'payload': payload})
        return plan.beats
