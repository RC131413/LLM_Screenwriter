"""Public API contracts. The filename follows the project's requested spelling."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from ninja import Schema
from pydantic import Field

from .base_schemas import InputSchema, MessageOut, TimestampedOut

from backend.screenplay_schemas import (
    EditorBlock as EditorBlock,
    GeneratedAction as GeneratedAction,
    GeneratedBlock as GeneratedBlock,
    GeneratedHeading as GeneratedHeading,
    GeneratedScene as GeneratedScene,
    GeneratedSceneWithHeading as GeneratedSceneWithHeading,
    GeneratedSpeech as GeneratedSpeech,
    ModelHeading as ModelHeading,
)


PositiveId = Annotated[int, Field(gt=0, le=9007199254740991)]
JsonObject = dict[str, Any]


class ProjectIn(InputSchema):
    title: str = Field(min_length=1, max_length=255)
    logline: str = Field(default='', max_length=5000)
    synopsis: str = Field(default='', max_length=50000)
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
    summary: str = Field(default='', max_length=20000)
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
    age: int | None = Field(default=None, ge=0, le=150)
    psychological_profile: str = Field(default='', max_length=20000)
    appearance: str = Field(default='', max_length=20000)
    backstory: str = Field(default='', max_length=20000)
    goals: str = Field(default='', max_length=20000)
    fears: str = Field(default='', max_length=20000)
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
    content_text: str = Field(default='', max_length=262144)
    ai_metadata: JsonObject = Field(default_factory=dict)
    editor_metadata: JsonObject = Field(default_factory=dict)


class CastIn(InputSchema):
    character_id: PositiveId
    presence_type: str = Field(default='on_screen', min_length=1, max_length=50)
    notes: str = Field(default='', max_length=10000)


class CastUpdateIn(InputSchema):
    presence_type: str = Field(default='on_screen', min_length=1, max_length=50)
    notes: str = Field(default='', max_length=10000)


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
    max_tokens: int = Field(default=2048, ge=1, le=8192)


class PromptIn(InputSchema):
    user_prompt: str = Field(min_length=1, max_length=32000)
    generation_parameters: GenerationParametersIn | None = None


class GenerateSceneIn(PromptIn):
    generation_id: UUID | None = None
    variant_count: Annotated[int, Field(strict=True, ge=1, le=3)] | None = None


class CancelGenerationIn(PromptIn):
    generation_id: UUID


class ExecutionProgressOut(Schema):
    id: int
    agent_name: str
    node_name: str
    status: str
    variant_number: Literal[1, 2, 3]
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    error_message: str
    review_status: str | None


class GenerationProgressOut(Schema):
    run_id: int
    status: str
    variant_count: Literal[1, 2, 3]
    percent: int
    completed_steps: int
    total_steps: int
    started_at: datetime | None
    finished_at: datetime | None
    total_duration_ms: int | None
    error_message: str
    agent_executions: list[ExecutionProgressOut]


class ActiveGenerationOut(Schema):
    scene_id: int
    generation_id: UUID
    user_prompt: str
    variant_count: Literal[1, 2, 3]
    current_agent: str | None = None
    variant_number: int | None = None
    progress: GenerationProgressOut


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


class SelectedVariantOut(VariantOut):
    applied_scene: SceneOut | None = None


class SelectVariantIn(InputSchema):
    apply_to_scene: bool = False


class RunDetailOut(RunOut):
    agent_executions: list[ExecutionOut]
    variants: list[VariantOut]
    progress: GenerationProgressOut

    @staticmethod
    def resolve_progress(run):
        from .progress import generation_progress
        return generation_progress(run)


class ActivityOut(Schema):
    date: date
    count: int


class ProjectGenerationStatisticsOut(Schema):
    project_id: int
    completed_runs: int
    failed_runs: int


class RecentActivityOut(Schema):
    id: str
    project_id: int
    project_title: str
    action: Literal['create', 'edit', 'open', 'favorite', 'unfavorite', 'archive', 'unarchive', 'trash', 'restore',
                    'generation_completed', 'generation_failed', 'generation_cancelled']
    occurred_at: datetime


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
    project_generations: list[ProjectGenerationStatisticsOut]
    recent_activity: list[RecentActivityOut]
