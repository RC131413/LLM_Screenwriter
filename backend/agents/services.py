"""Run the scene workflow against a Django snapshot and persist its final variant."""

from time import perf_counter

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from backend.api.models import GenerationRun, Scene, SceneGenerationRequest, SceneVariant, User
from backend.api.screenplay import UNCLEAR_PROMPT, blocks_text, obviously_unintelligible
from backend.api.services import get_owned, lock_project, owned, profile_for, prompt_snapshot, save_validated
from backend.ollama import OLLAMA_MODEL, OllamaCancelled

from .graph import SceneGraphState, scene_graph


PREVIOUS_SCENE_LIMIT = 3
PREVIOUS_SCENE_EXCERPT_LENGTH = 1200


def _previous_scenes(scene: Scene) -> list[dict[str, str | int]]:
    act = scene.act
    earlier = (
        Q(act__sort_order__lt=act.sort_order)
        | Q(act__sort_order=act.sort_order, act__act_number__lt=act.act_number)
        | Q(act_id=act.pk, sort_order__lt=scene.sort_order)
        | Q(act_id=act.pk, sort_order=scene.sort_order, scene_number__lt=scene.scene_number)
    )
    recent = list(
        Scene.objects.filter(earlier, project_id=scene.project_id)
        .exclude(content_text='')
        .order_by('-act__sort_order', '-act__act_number', '-sort_order', '-scene_number')
        .values('scene_number', 'title', 'location_heading', 'time_of_day', 'content_text')[:PREVIOUS_SCENE_LIMIT]
    )
    return [
        {**previous, 'content_text': previous['content_text'][-PREVIOUS_SCENE_EXCERPT_LENGTH:]}
        for previous in reversed(recent)
    ]


@transaction.atomic
def _start_run(*, user: User, scene_id: int, user_prompt: str) -> GenerationRun:
    scene = get_owned(Scene, user, scene_id)
    lock_project(user, scene.project_id)
    scene = get_object_or_404(owned(Scene, user).select_related('project', 'act'), pk=scene_id)
    if not user_prompt.strip():
        raise ValidationError({'user_prompt': 'Wpisz instrukcję dla modelu.'})
    if obviously_unintelligible(user_prompt):
        raise ValidationError({'user_prompt': UNCLEAR_PROMPT})
    context = prompt_snapshot(scene, profile_for(user))
    context['previous_scenes'] = _previous_scenes(scene)
    request = save_validated(SceneGenerationRequest(
        scene=scene, user_prompt=user_prompt, context_snapshot=context, model_name=OLLAMA_MODEL,
    ))
    return save_validated(GenerationRun(
        request=request, status='running', started_at=timezone.now(), run_metadata={'engine': 'langgraph'},
    ))


@transaction.atomic
def _save_result(run: GenerationRun, *, user: User, result: SceneGraphState, started: float) -> SceneVariant:
    project_id = run.request.context_snapshot['project']['id']
    lock_project(user, project_id)
    run = GenerationRun.objects.select_for_update().get(pk=run.pk)
    if run.status != 'running':
        raise OllamaCancelled()

    review = result['critic_review']
    revision = {'review_status': result['review_status'], 'revision_count': result['revision_count']}
    blocks = result['scene_blocks']
    heading = result['scene_heading']
    variant = save_validated(SceneVariant(
        run=run, scene_id=run.request.scene_id, variant_number=1, title='Wariant Bielika',
        generated_full_text=blocks_text(blocks),
        critic_score=review.score, critic_feedback=result['critic_feedback'],
        critic_metadata={
            'format': 'screenplay_blocks_v1', 'operation': 'append', 'blocks': blocks,
            **({'heading': heading} if heading else {}),
            **revision, 'needs_revision': review.needs_revision,
            'findings': [finding.model_dump(mode='json') for finding in review.findings],
        },
    ))
    save_validated(run, {
        'status': 'completed', 'finished_at': timezone.now(),
        'total_duration_ms': int((perf_counter() - started) * 1000),
        'run_metadata': run.run_metadata | revision,
    })
    return variant


def generate_scene_variant(*, user: User, scene_id: int, user_prompt: str) -> SceneVariant:
    """Generate and save one candidate for a scene owned by the caller."""
    started = perf_counter()
    run = _start_run(user=user, scene_id=scene_id, user_prompt=user_prompt)
    try:
        result = scene_graph.invoke({
            'user_prompt': run.request.user_prompt, 'context': run.request.context_snapshot,
        })
        return _save_result(run, user=user, result=result, started=started)
    except Exception as error:
        finished = timezone.now()
        GenerationRun.objects.filter(pk=run.pk, status='running').update(
            status='cancelled' if isinstance(error, OllamaCancelled) else 'failed',
            finished_at=finished, updated_at=finished,
            total_duration_ms=int((perf_counter() - started) * 1000), error_message=str(error),
        )
        raise
