"""Authentication, profile and preference contracts."""

from typing import Any, Literal

from ninja import Schema
from pydantic import EmailStr, Field

from backend.api.base_schemas import InputSchema, MessageOut as MessageOut, TimestampedOut


ModelName = Literal['Bielik 11B (Lokalny)']


class CsrfOut(Schema):
    csrf_token: str


class RegisterIn(InputSchema):
    username: str = Field(min_length=1, max_length=150)
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8, max_length=128)


class LoginIn(InputSchema):
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class AccountIn(InputSchema):
    username: str = Field(min_length=1, max_length=150)


class PasswordIn(InputSchema):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    new_password_confirm: str = Field(min_length=8, max_length=128)


class WritingStyleIn(InputSchema):
    stage_directions_style: Literal['concise_technical', 'literary_descriptive'] = 'concise_technical'
    dialogue_tone: str = Field(default='Neutralny, realistyczny', min_length=1, max_length=500)
    parentheticals: Literal['ignore', 'sparingly', 'standard'] = 'sparingly'


class LlmPreferencesIn(InputSchema):
    model_name: ModelName = 'Bielik 11B (Lokalny)'
    temperature: float = Field(default=0.7, ge=0, le=1, multiple_of=0.1)
    # A technical budget for complete structured output, not a scene-length control.
    max_tokens: Literal[2048] = 2048


class PreferencesIn(InputSchema):
    writing_style_preferences: WritingStyleIn = Field(default_factory=WritingStyleIn)
    llm_preferences: LlmPreferencesIn = Field(default_factory=LlmPreferencesIn)


class ProfileIn(InputSchema):
    display_name: str = Field(default='', max_length=150)
    avatar_url: str = Field(default='', max_length=2048)
    preferred_language: Literal['pl'] = 'pl'


class ProfileOut(TimestampedOut):
    user_id: int
    display_name: str
    avatar_url: str
    preferred_language: str
    writing_style_preferences: dict[str, Any]
    llm_preferences: dict[str, Any]


class UserOut(TimestampedOut):
    username: str
    email: str
    profile: ProfileOut
