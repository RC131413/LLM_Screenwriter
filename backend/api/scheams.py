"""Public API contracts. The filename follows the project's requested spelling."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from ninja import Schema
from pydantic import ConfigDict, EmailStr, Field


PositiveId = Annotated[int, Field(gt=0)]
JsonObject = dict[str, Any]
ModelName = Literal['Bielik 11B (Lokalny)']


class InputSchema(Schema):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class MessageOut(Schema):
    detail: str


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
    parentheticals: Literal['sparingly', 'ignore'] = 'sparingly'


class LlmPreferencesIn(InputSchema):
    model_name: ModelName = 'Bielik 11B (Lokalny)'
    temperature: float = Field(default=0.7, ge=0, le=1, multiple_of=0.1)
    max_tokens: int = Field(default=2048, ge=1, le=32768)


class PreferencesIn(InputSchema):
    writing_style_preferences: WritingStyleIn = Field(default_factory=WritingStyleIn)
    llm_preferences: LlmPreferencesIn = Field(default_factory=LlmPreferencesIn)


class ProfileIn(InputSchema):
    display_name: str = Field(default='', max_length=150)
    avatar_url: str = Field(default='', max_length=2048)
    preferred_language: Literal['pl'] = 'pl'


class TimestampedOut(Schema):
    id: int
    created_at: datetime
    updated_at: datetime


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


class ProjectIn(InputSchema):
    title: str = Field(min_length=1, max_length=255)
    logline: str = ''
    synopsis: str = ''
    genre: str = Field(default='', max_length=100)
    target_audience: str = Field(default='', max_length=255)
    screenplay_format: str = Field(default='fountain', min_length=1, max_length=32)
    status: str = Field(default='draft', min_length=1, max_length=32)
    metadata: JsonObject = Field(default_factory=dict)


class ProjectOut(TimestampedOut):
    user_id: int
    title: str
    logline: str
    synopsis: str
    genre: str
    target_audience: str
    screenplay_format: str
    status: str
    metadata: dict[str, Any]


class ActIn(InputSchema):
    title: str = Field(default='', max_length=255)
    act_number: int = Field(ge=1)
    sort_order: int = Field(default=0, ge=0)
    summary: str = ''
    metadata: JsonObject = Field(default_factory=dict)


class ActOut(TimestampedOut):
    project_id: int
    title: str
    act_number: int
    sort_order: int
    summary: str
    metadata: dict[str, Any]


class CharacterIn(InputSchema):
    name: str = Field(min_length=1, max_length=150)
    role: str = Field(default='', max_length=255)
    age: int | None = Field(default=None, ge=0)
    psychological_profile: str = ''
    appearance: str = ''
    backstory: str = ''
    goals: str = ''
    fears: str = ''
    voice_profile: JsonObject = Field(default_factory=dict)
    memory_metadata: JsonObject = Field(default_factory=dict)


class CharacterOut(TimestampedOut):
    project_id: int
    name: str
    role: str
    age: int | None
    psychological_profile: str
    appearance: str
    backstory: str
    goals: str
    fears: str
    voice_profile: dict[str, Any]
    memory_metadata: dict[str, Any]


class SceneIn(InputSchema):
    act_id: PositiveId
    scene_number: int = Field(ge=1)
    sort_order: int = Field(default=0, ge=0)
    title: str = Field(default='', max_length=255)
    location_heading: str = Field(default='', max_length=255)
    time_of_day: str = Field(default='', max_length=50)
    content_text: str = ''
    ai_metadata: JsonObject = Field(default_factory=dict)
    editor_metadata: JsonObject = Field(default_factory=dict)


class CastIn(InputSchema):
    character_id: PositiveId
    presence_type: str = Field(default='on_screen', min_length=1, max_length=50)
    notes: str = ''


class CastUpdateIn(InputSchema):
    presence_type: str = Field(default='on_screen', min_length=1, max_length=50)
    notes: str = ''


class CastOut(Schema):
    id: int
    scene_id: int
    character_id: int
    presence_type: str
    notes: str
    created_at: datetime


class SceneOut(TimestampedOut):
    project_id: int
    act_id: int
    scene_number: int
    sort_order: int
    title: str
    location_heading: str
    time_of_day: str
    content_text: str
    ai_metadata: dict[str, Any]
    editor_metadata: dict[str, Any]
    cast_members: list[CastOut]


class WorkspaceOut(Schema):
    project: ProjectOut
    acts: list[ActOut]
    characters: list[CharacterOut]
    scenes: list[SceneOut]


class GenerationParametersIn(InputSchema):
    temperature: float = Field(default=0.7, ge=0, le=1, multiple_of=0.1)
    max_tokens: int = Field(default=2048, ge=1, le=32768)


class PromptIn(InputSchema):
    user_prompt: str = Field(min_length=1, max_length=32000)
    generation_parameters: GenerationParametersIn | None = None


class PromptOut(Schema):
    id: int
    scene_id: int
    user_prompt: str
    system_prompt: str
    context_snapshot: dict[str, Any]
    model_name: str
    generation_parameters: dict[str, Any]
    created_at: datetime


class RunOut(TimestampedOut):
    request_id: int
    status: str
    langgraph_thread_id: str
    started_at: datetime | None
    finished_at: datetime | None
    total_duration_ms: int | None
    error_message: str
    run_metadata: dict[str, Any]


class ExecutionOut(Schema):
    id: int
    run_id: int
    agent_name: str
    node_name: str
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    input_payload: dict[str, Any]
    output_payload: dict[str, Any]
    logs: dict[str, Any]
    error_message: str
    created_at: datetime


class VariantOut(Schema):
    id: int
    run_id: int
    scene_id: int
    variant_number: int
    title: str
    generated_full_text: str
    critic_score: Decimal | None
    critic_feedback: str
    critic_metadata: dict[str, Any]
    is_selected: bool
    created_at: datetime


class SelectVariantIn(InputSchema):
    apply_to_scene: bool = False


class RunDetailOut(RunOut):
    agent_executions: list[ExecutionOut]
    variants: list[VariantOut]


class ActivityOut(Schema):
    date: date
    count: int


class StatisticsOut(Schema):
    projects: int
    acts: int
    scenes: int
    characters: int
    generation_requests: int
    generation_runs: int
    completed_runs: int
    variants: int
    total_generation_duration_ms: int
    prompt_activity: list[ActivityOut]
