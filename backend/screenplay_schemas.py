"""Shared Pydantic contracts for generated scenes and editor blocks."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator


class GeneratedBlock(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    type: Literal['action', 'character', 'dialogue', 'parenthetical', 'transition']
    text: str = Field(min_length=1)


class GeneratedAction(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    type: Literal['action']
    text: str = Field(min_length=1, description='Widoczna akcja i opis otoczenia w trzeciej osobie. Bez dialogów ani etykiet miejsca i pory dnia.')


class GeneratedSpeech(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    type: Literal['speech']
    speaker: str = Field(min_length=1, max_length=150, description='Wyłącznie nazwa postaci wypowiadającej słowa.')
    parenthetical: str | None = Field(max_length=120, description='Krótka, konkretna wskazówka aktorska (zwykle 1–4 słowa), gdy pomaga zagrać kwestię: intencja, pauza lub zmiana sposobu mówienia. Null, gdy zbędna. Bez mechanicznych powtórzeń i opisów czynności.')
    spoken_text: str = Field(min_length=1, description='Wyłącznie słowa wypowiedziane na głos przez postać. Opis światła, otoczenia, ruchów i narracja należą do action.')


class GeneratedScene(BaseModel):
    model_config = ConfigDict(extra='forbid')
    blocks: list[Annotated[GeneratedAction | GeneratedSpeech, Field(discriminator='type')]] = Field(min_length=1)


class GeneratedHeading(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    location_heading: str = Field(min_length=1, max_length=255)
    time_of_day: str = Field(min_length=1, max_length=50)


class ModelHeading(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    location_type: Literal['WN.', 'PL.'] = Field(description='WN. dla wnętrza budynku, PL. dla pleneru.')
    location_heading: str = Field(min_length=1, max_length=240, description='Sama nazwa miejsca, np. CHATA. Bez prefiksu, etykiety Miejsce i bez pory dnia.')
    time_of_day: Literal['DZIEŃ', 'NOC', 'RANO', 'ŚWIT', 'WIECZÓR', 'POŁUDNIE', 'PRZEDPOŁUDNIE', 'POPOŁUDNIE', 'ZMIERZCH', 'ZMROK', 'KONTYNUACJA']


class GeneratedSceneWithHeading(BaseModel):
    model_config = ConfigDict(extra='forbid')
    heading: ModelHeading
    blocks: list[Annotated[GeneratedAction | GeneratedSpeech, Field(discriminator='type')]] = Field(min_length=1)


def canonical_speaker_name(value):
    """Normalize only whitespace/case, never infer a person's identity from a role."""
    return ' '.join(value.split()).upper() if isinstance(value, str) else value


@lru_cache(maxsize=64)
def generated_scene_schema(*, speaker_names: tuple[str, ...] = (), with_heading: bool = False):
    """Constrain dialogue labels to the selected cast, keeping the public scene shape."""
    base = GeneratedSceneWithHeading if with_heading else GeneratedScene
    if not speaker_names:
        return base

    speech = create_model(
        'CastGeneratedSpeech', __base__=GeneratedSpeech,
        __validators__={'normalize_speaker': field_validator('speaker', mode='before')(canonical_speaker_name)},
        speaker=(Literal[speaker_names], Field(description='Dokładna etykieta postaci z przypisanej obsady.')),
    )
    block = Annotated[GeneratedAction | speech, Field(discriminator='type')]
    return create_model(
        'CastGeneratedSceneWithHeading' if with_heading else 'CastGeneratedScene',
        __base__=base, blocks=(list[block], Field(min_length=1)),
    )


class EditorBlock(GeneratedBlock):
    id: str = Field(min_length=1)
