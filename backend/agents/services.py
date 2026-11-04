"""Run the scene workflow against a Django snapshot and persist its final variant."""

from contextlib import closing
from time import perf_counter

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from langchain_core.exceptions import OutputParserException
from langsmith import tracing_context

from backend.api.models import AgentExecution, GenerationRun, Scene, SceneGenerationRequest, SceneVariant, User
from backend.api.screenplay import UNCLEAR_PROMPT, blocks_text, obviously_unintelligible
from backend.api.services import (
    SCENE_VARIANT_APPROACHES, generation_is_cancelled, get_owned, lock_project, owned,
    profile_for, prompt_snapshot, save_validated,
)
from backend.ollama import OLLAMA_BASE_URL, OLLAMA_MODEL, OllamaCancelled, OllamaError

from ._model import CancellableChatOllama
from .graph import SceneGraphState, build_scene_graph, scene_graph
from .scenarist import SCENE_WRITE_TIMEOUT


PREVIOUS_SCENE_LIMIT = 3
PREVIOUS_SCENE_EXCERPT_LENGTH = 1200
AGENT_NAMES = {'archivist': 'Archiwista', 'director': 'Reżyser', 'scenarist': 'Scenarzysta', 'critic': 'Krytyk'}
NEXT_NODE = {'archivist': 'director', 'director': 'scenarist', 'scenarist': 'critic'}


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


def scene_context(scene, profile):
    return prompt_snapshot(scene, profile) | {'previous_scenes': _previous_scenes(scene)}


@transaction.atomic
def _start_run(*, user: User, scene_id: int, user_prompt: str) -> GenerationRun:
    scene = get_owned(Scene, user, scene_id)
    lock_project(user, scene.project_id)
    scene = get_object_or_404(owned(Scene, user).select_related('project', 'act'), pk=scene_id)
    if not user_prompt.strip():
        raise ValidationError({'user_prompt': 'Wpisz instrukcję dla modelu.'})
    if obviously_unintelligible(user_prompt):
        raise ValidationError({'user_prompt': UNCLEAR_PROMPT})
    context = scene_context(scene, profile_for(user))
    request = save_validated(SceneGenerationRequest(
        scene=scene, user_prompt=user_prompt, context_snapshot=context, model_name=OLLAMA_MODEL,
    ))
    return save_validated(GenerationRun(
        request=request, status='running', started_at=timezone.now(), run_metadata={'engine': 'langgraph'},
    ))


def _save_variant(run, result, number, title):
    review = result['critic_review']
    blocks = result['scene_blocks']
    heading = result['scene_heading']
    return save_validated(SceneVariant(
        run=run, scene_id=run.request.scene_id, variant_number=number, title=title,
        generated_full_text=blocks_text(blocks),
        critic_score=review.score, critic_feedback=result['critic_feedback'],
        critic_metadata={
            'format': 'screenplay_blocks_v1', 'operation': 'append', 'blocks': blocks,
            **({'heading': heading} if heading else {}),
            'review_status': result['review_status'], 'revision_count': result['revision_count'],
            'needs_revision': review.needs_revision,
            'findings': [finding.model_dump(mode='json') for finding in review.findings],
        },
    ))


@transaction.atomic
def _save_results(run, *, user, results, started, numbered=False):
    project_id = run.request.context_snapshot['project']['id']
    lock_project(user, project_id)
    run = get_object_or_404(GenerationRun.objects.select_for_update(), pk=run.pk)
    if run.status != 'running':
        raise OllamaCancelled()

    variants = [
        _save_variant(run, result, number, f'Wariant {number}' if numbered else 'Wariant Bielika')
        for number, result in enumerate(results, start=1)
    ]
    revision = {
        'review_status': 'revision_limit_reached' if any(
            result['review_status'] == 'revision_limit_reached' for result in results
        ) else 'accepted',
        'revision_count': sum(result['revision_count'] for result in results),
    }
    save_validated(run, {
        'status': 'completed', 'finished_at': timezone.now(),
        'total_duration_ms': int((perf_counter() - started) * 1000),
        'run_metadata': run.run_metadata | revision,
    })
    return variants


def _record_failure(run, error, started):
    finished = timezone.now()
    GenerationRun.objects.filter(pk=run.pk, status='running').update(
        status='cancelled' if isinstance(error, OllamaCancelled) else 'failed',
        finished_at=finished, updated_at=finished,
        total_duration_ms=int((perf_counter() - started) * 1000), error_message=str(error),
    )


def _ensure_running(run):
    status = GenerationRun.objects.filter(pk=run.pk).values_list('status', flat=True).first()
    if status is None:
        raise Http404('Nie znaleziono sceny lub generowania.')
    if status != 'running':
        raise OllamaCancelled()


def _start_agent(run, node, number):
    return AgentExecution.objects.create(
        run=run, agent_name=AGENT_NAMES[node], node_name=node, status='running',
        started_at=timezone.now(), input_payload={'variant_number': number},
    )


def _finish_agent(execution, status, error_message=''):
    finished = timezone.now()
    AgentExecution.objects.filter(pk=execution.pk, status='running').update(
        status=status, finished_at=finished, error_message=error_message,
        duration_ms=int((finished - execution.started_at).total_seconds() * 1000),
    )


def _run_workflow(graph, run, *, context, number) -> SceneGraphState:
    state = {'user_prompt': run.request.user_prompt, 'context': context}
    _ensure_running(run)
    execution = _start_agent(run, 'archivist', number)
    try:
        with tracing_context(enabled=False), closing(graph.stream(state, stream_mode='updates')) as updates:
            for update in updates:
                _ensure_running(run)
                for node, values in update.items():
                    state.update(values)
                    _finish_agent(execution, 'completed')
                    next_node = NEXT_NODE.get(node)
                    if node == 'critic' and state['review_status'] == 'revision_requested':
                        next_node = 'scenarist'
                    if next_node:
                        execution = _start_agent(run, next_node, number)
    except Exception as error:
        try:
            _ensure_running(run)
        except OllamaCancelled as cancelled:
            _finish_agent(execution, 'cancelled', str(cancelled))
            raise cancelled from error
        if isinstance(error, (OutputParserException, ValueError)):
            failure = OllamaError(f'Nieprawidłowy format odpowiedzi na etapie „{execution.agent_name}”. Spróbuj ponownie.')
            _finish_agent(execution, 'failed', str(failure))
            raise failure from error
        _finish_agent(execution, 'cancelled' if isinstance(error, OllamaCancelled) else 'failed', str(error))
        raise
    return state


def generate_variants_for_run(run: GenerationRun, *, user: User, variant_count: int | None) -> list[SceneVariant]:
    """Execute a prepared API run and commit all variants together."""
    started = perf_counter()
    try:
        def is_cancelled():
            return generation_is_cancelled(run.pk)

        model_settings = {'model': OLLAMA_MODEL, 'base_url': OLLAMA_BASE_URL, 'is_cancelled': is_cancelled}
        model = CancellableChatOllama(**model_settings, temperature=0, num_predict=1024)
        parameters = run.request.generation_parameters
        writer = CancellableChatOllama(
            **model_settings, temperature=parameters['temperature'], num_predict=parameters['max_tokens'],
            request_timeout=SCENE_WRITE_TIMEOUT,
        )
        graph = build_scene_graph(model=model, writing_model=writer)
        results = [
            _run_workflow(
                graph, run, number=number,
                context=run.request.context_snapshot | {'variant_approach': SCENE_VARIANT_APPROACHES[number - 1]},
            )
            for number in range(1, (variant_count or 1) + 1)
        ]
        return _save_results(run, user=user, results=results, started=started, numbered=variant_count is not None)
    except Exception as error:
        _record_failure(run, error, started)
        raise


def generate_scene_variant(*, user: User, scene_id: int, user_prompt: str) -> SceneVariant:
    """Generate and save one candidate for a scene owned by the caller."""
    started = perf_counter()
    run = _start_run(user=user, scene_id=scene_id, user_prompt=user_prompt)
    try:
        result = scene_graph.invoke({
            'user_prompt': run.request.user_prompt, 'context': run.request.context_snapshot,
        })
        return _save_results(run, user=user, results=[result], started=started)[0]
    except Exception as error:
        _record_failure(run, error, started)
        raise
