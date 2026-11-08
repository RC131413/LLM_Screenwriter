"""Account statistics from persisted data, plus a small project activity history."""

from datetime import timedelta, timezone as datetime_timezone
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from ninja.errors import HttpError

from .models import Act, Character, GenerationRun, Project, Scene, SceneGenerationRequest, SceneVariant
from .services import owned


PROJECT_ACTIONS = {'create', 'edit', 'open', 'favorite', 'unfavorite', 'archive', 'unarchive', 'trash', 'restore'}
RECENT_LIMIT = 5


def _timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = parse_datetime(value)
    except ValueError:
        return None
    if result is None:
        return None
    if timezone.is_naive(result):
        result = timezone.make_aware(result, datetime_timezone.utc)
    return result.astimezone(datetime_timezone.utc)


def _project_events(project):
    metadata = project.metadata if isinstance(project.metadata, dict) else {}
    stored = metadata.get('recent_activity')
    events = []
    for item in stored[-RECENT_LIMIT:] if isinstance(stored, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str):
            continue
        action = item.get('action')
        at = _timestamp(item.get('occurred_at'))
        if isinstance(action, str) and action in PROJECT_ACTIONS and at is not None:
            events.append({'id': item['id'], 'action': action, 'occurred_at': at})
    if not events:
        # Older versions stored only the most recent opening, not a history.
        at = _timestamp(metadata.get('last_opened_at'))
        if at:
            events.append({'id': f'legacy-open-{project.pk}', 'action': 'open', 'occurred_at': at})
    return events


def activity_metadata(project, action, *, metadata=None, at=None):
    """Caller holds the project lock; preserve other metadata and the last five events."""
    result = dict(project.metadata if metadata is None else metadata)
    events = _project_events(project)
    events.append({'id': str(uuid4()), 'action': action, 'occurred_at': at or timezone.now()})
    result['recent_activity'] = [{**event, 'occurred_at': event['occurred_at'].isoformat()}
                                 for event in events[-RECENT_LIMIT:]]
    return result


def account_statistics(user, time_zone):
    try:
        zone = ZoneInfo(time_zone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HttpError(422, 'Nieprawidłowa strefa czasowa.') from None
    projects = list(owned(Project, user).only('id', 'title', 'metadata'))
    runs = owned(GenerationRun, user)
    prompts = owned(SceneGenerationRequest, user)
    activity = prompts.filter(created_at__gte=timezone.now() - timedelta(days=30)).annotate(
        date=TruncDate('created_at', tzinfo=zone),
    ).values('date').annotate(count=Count('pk')).order_by('date')
    # Aggregate runs directly: joining variants/executions would multiply counts.
    counts = {row['request__scene__project_id']: row for row in runs.values('request__scene__project_id').annotate(
        completed_runs=Count('pk', filter=Q(status='completed')),
        failed_runs=Count('pk', filter=Q(status='failed')),
    ).order_by()}
    recent = []
    for project in projects:
        recent.extend({**event, 'project_id': project.pk, 'project_title': project.title}
                      for event in _project_events(project))
    # Previous generation outcomes already exist in the DB, including older runs.
    generations = list(runs.filter(status__in=['completed', 'failed', 'cancelled']).annotate(
        activity_at=Coalesce('finished_at', 'updated_at'),
    ).select_related('request__scene__project').order_by('-activity_at', '-pk')[:RECENT_LIMIT])
    for run in reversed(generations):
        project = run.request.scene.project
        recent.append({'id': f'generation-{run.pk}', 'project_id': project.pk, 'project_title': project.title,
                       'action': f'generation_{run.status}', 'occurred_at': run.activity_at})
    # Stable ordering when events happen at exactly the same timestamp.
    recent = sorted(enumerate(recent), key=lambda pair: (pair[1]['occurred_at'], pair[0]), reverse=True)
    return {
        'projects': len(projects), 'acts': owned(Act, user).count(), 'scenes': owned(Scene, user).count(),
        'characters': owned(Character, user).count(), 'generation_requests': prompts.count(),
        'generation_runs': runs.count(), 'completed_runs': runs.filter(status='completed').count(),
        'variants': owned(SceneVariant, user).count(),
        'total_generation_duration_ms': runs.aggregate(total=Sum('total_duration_ms'))['total'] or 0,
        'prompt_activity': list(activity),
        'project_generations': [
            {'project_id': project.pk, 'completed_runs': counts.get(project.pk, {}).get('completed_runs', 0),
             'failed_runs': counts.get(project.pk, {}).get('failed_runs', 0)} for project in projects
        ],
        'recent_activity': [event for _, event in recent[:RECENT_LIMIT]],
    }
