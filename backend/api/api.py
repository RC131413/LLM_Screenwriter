"""Session-authenticated AgentDraft API. Engine-produced records are read-only."""

from datetime import timedelta
from typing import Literal

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import NinjaAPI, PatchDict
from ninja.errors import HttpError
from ninja.pagination import paginate
from ninja.security import django_auth
from ninja.throttling import AnonRateThrottle
from ninja.utils import check_csrf

from backend import ollama

from . import scheams as s
from .models import (
    Act, AgentExecution, Character, GenerationRun, Project, Scene,
    SceneCharacter, SceneGenerationRequest, SceneVariant, User,
)
from .services import (
    get_owned, lock_project, owned, profile_for, prompt_snapshot,
    save_validated, validate_avatar,
)


api = NinjaAPI(title='AgentDraft API', version='1.0.0', auth=django_auth)


@api.exception_handler(ValidationError)
def validation_error(request, error):
    fields = error.message_dict if hasattr(error, 'message_dict') else {'__all__': error.messages}
    return api.create_response(request, {'detail': 'Validation failed.', 'fields': fields}, status=422)


@api.exception_handler(IntegrityError)
def integrity_error(request, error):
    return api.create_response(request, {'detail': 'Conflicting data. Refresh and try again.'}, status=409)


@api.get('/auth/csrf', auth=None, response=s.CsrfOut, tags=['Authentication'])
def csrf_token(request, response: HttpResponse):
    response['Cache-Control'] = 'no-store'
    return {'csrf_token': get_token(request)}


@api.get('/llm/ping', auth=None,
         response={200: s.LlmPingOut, 404: s.MessageOut, 502: s.MessageOut, 503: s.MessageOut, 504: s.MessageOut},
         tags=['LLM'])
def llm_ping(request, response: HttpResponse):
    """Temporary development-only probe; each call performs a real generation."""
    response['Cache-Control'] = 'no-store'
    if not settings.DEBUG:
        return 404, {'detail': 'Not found.'}
    try:
        answer = ollama.generate('Odpowiedz jednym krótkim zdaniem po polsku: czy połączenie z modelem Bielik działa?')
    except ollama.OllamaError as error:
        return error.status_code, {'detail': str(error)}
    return {'model': ollama.OLLAMA_MODEL, 'response': answer}


@api.post('/auth/register', auth=None, response={201: s.UserOut},
          throttle=AnonRateThrottle('10/m'), tags=['Authentication'])
@transaction.atomic
def register(request, payload: s.RegisterIn):
    if check_csrf(request):
        raise HttpError(403, 'CSRF check failed.')
    if payload.password != payload.password_confirm:
        raise ValidationError({'password_confirm': 'Passwords do not match.'})
    email = str(payload.email).lower()
    if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=payload.username)).exists():
        raise HttpError(409, 'Username or email is already in use.')
    user = User(username=payload.username, email=email)
    validate_password(payload.password, user=user)
    user.set_password(payload.password)
    save_validated(user)
    profile_for(user)
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    return 201, user


@api.post('/auth/login', auth=None, response=s.UserOut,
          throttle=AnonRateThrottle('10/m'), tags=['Authentication'])
def sign_in(request, payload: s.LoginIn):
    if check_csrf(request):
        raise HttpError(403, 'CSRF check failed.')
    candidates = list(User.objects.filter(
        Q(username=payload.identifier) | Q(email__iexact=payload.identifier),
    ).values_list('username', flat=True)[:2])
    # Ambiguous username/email identifiers must not log into the wrong account.
    username = candidates[0] if len(candidates) == 1 else ''
    user = authenticate(request, username=username, password=payload.password)
    if user is None:
        raise HttpError(401, 'Invalid credentials.')
    profile_for(user)
    login(request, user)
    return user


@api.post('/auth/logout', response=s.MessageOut, tags=['Authentication'])
def sign_out(request):
    logout(request)
    return {'detail': 'Logged out.'}


@api.get('/users/me', response=s.UserOut, tags=['Account'])
def current_user(request):
    profile_for(request.auth)
    return request.auth


@api.patch('/users/me', response=s.UserOut, tags=['Account'])
@transaction.atomic
def update_account(request, payload: PatchDict[s.AccountIn]):
    user = User.objects.select_for_update().get(pk=request.auth.pk)
    username = payload.get('username')
    if username and User.objects.filter(username__iexact=username).exclude(pk=user.pk).exists():
        raise HttpError(409, 'Username is already in use.')
    save_validated(user, payload)
    profile_for(user)
    return user


@api.post('/users/me/password', response=s.MessageOut, tags=['Account'])
@transaction.atomic
def change_password(request, payload: s.PasswordIn):
    user = User.objects.select_for_update().get(pk=request.auth.pk)
    if not user.check_password(payload.old_password):
        raise ValidationError({'old_password': 'Incorrect current password.'})
    if payload.new_password != payload.new_password_confirm:
        raise ValidationError({'new_password_confirm': 'Passwords do not match.'})
    validate_password(payload.new_password, user=user)
    user.set_password(payload.new_password)
    save_validated(user)
    update_session_auth_hash(request, user)
    return {'detail': 'Password changed.'}


@api.get('/users/me/profile', response=s.ProfileOut, tags=['Account'])
def get_profile(request):
    return profile_for(request.auth)


@api.patch('/users/me/profile', response=s.ProfileOut, tags=['Account'])
@transaction.atomic
def update_profile(request, payload: PatchDict[s.ProfileIn]):
    User.objects.select_for_update().get(pk=request.auth.pk)
    if 'avatar_url' in payload:
        validate_avatar(payload['avatar_url'])
    return save_validated(profile_for(request.auth), payload)


@api.get('/users/me/preferences', response=s.PreferencesIn, tags=['Preferences'])
def get_preferences(request):
    profile = profile_for(request.auth)
    defaults = s.PreferencesIn().model_dump()
    # Existing ERD rows may contain empty JSON objects.
    return {
        'writing_style_preferences': {
            **defaults['writing_style_preferences'], **profile.writing_style_preferences,
        },
        'llm_preferences': {
            **defaults['llm_preferences'], **profile.llm_preferences,
            'model_name': 'Bielik 11B (Lokalny)',
        },
    }


@api.put('/users/me/preferences', response=s.PreferencesIn, tags=['Preferences'])
@transaction.atomic
def update_preferences(request, payload: s.PreferencesIn):
    User.objects.select_for_update().get(pk=request.auth.pk)
    save_validated(profile_for(request.auth), payload.model_dump())
    return payload


@api.get('/users/me/statistics', response=s.StatisticsOut, tags=['Statistics'])
def statistics(request):
    runs = owned(GenerationRun, request.auth)
    prompts = owned(SceneGenerationRequest, request.auth)
    activity = prompts.filter(created_at__gte=timezone.now() - timedelta(days=30)).annotate(
        date=TruncDate('created_at'),
    ).values('date').annotate(count=Count('pk')).order_by('date')
    return {
        'projects': owned(Project, request.auth).count(),
        'acts': owned(Act, request.auth).count(),
        'scenes': owned(Scene, request.auth).count(),
        'characters': owned(Character, request.auth).count(),
        'generation_requests': prompts.count(), 'generation_runs': runs.count(),
        'completed_runs': runs.filter(status='completed').count(),
        'variants': owned(SceneVariant, request.auth).count(),
        'total_generation_duration_ms': runs.aggregate(total=Sum('total_duration_ms'))['total'] or 0,
        'prompt_activity': list(activity),
    }


@api.get('/projects', response=list[s.ProjectOut], tags=['Projects'])
@paginate
def list_projects(request, collection: Literal['all', 'recent', 'favorites', 'archive', 'trash'] = 'all',
                  search: str = ''):
    projects = owned(Project, request.auth)
    not_deleted = Q(metadata__deleted_at__isnull=True) | Q(metadata__deleted_at=None)
    not_archived = Q(metadata__archived_at__isnull=True) | Q(metadata__archived_at=None)
    if collection == 'trash':
        projects = projects.exclude(not_deleted)
    elif collection == 'archive':
        projects = projects.filter(not_deleted).exclude(not_archived)
    else:
        projects = projects.filter(not_deleted, not_archived)
        if collection == 'favorites':
            projects = projects.filter(metadata__is_favorite=True)
        elif collection == 'recent':
            projects = projects.exclude(
                Q(metadata__last_opened_at__isnull=True) | Q(metadata__last_opened_at=None),
            ).order_by('-metadata__last_opened_at', '-pk')
    return projects.filter(title__icontains=search)


@api.post('/projects', response={201: s.ProjectOut}, tags=['Projects'])
@transaction.atomic
def create_project(request, payload: s.ProjectIn):
    return 201, save_validated(Project(user=request.auth, **payload.model_dump()))


@api.get('/projects/{project_id}', response=s.ProjectOut, tags=['Projects'])
def get_project(request, project_id: s.PositiveId):
    return get_owned(Project, request.auth, project_id)


@api.patch('/projects/{project_id}', response=s.ProjectOut, tags=['Projects'])
@transaction.atomic
def update_project(request, project_id: s.PositiveId, payload: PatchDict[s.ProjectIn]):
    return save_validated(lock_project(request.auth, project_id), payload)


@api.delete('/projects/{project_id}', response={204: None}, tags=['Projects'])
@transaction.atomic
def delete_project(request, project_id: s.PositiveId):
    """Permanently delete related data. Use /actions/trash for soft deletion."""
    lock_project(request.auth, project_id).delete()
    return 204, None


@api.post('/projects/{project_id}/actions/{action}', response=s.ProjectOut, tags=['Projects'])
@transaction.atomic
def project_action(request, project_id: s.PositiveId,
                   action: Literal['favorite', 'unfavorite', 'archive', 'unarchive', 'trash', 'restore', 'open']):
    project = lock_project(request.auth, project_id)
    metadata = dict(project.metadata)
    now = timezone.now().isoformat()
    changes = {
        'favorite': {'is_favorite': True}, 'unfavorite': {'is_favorite': False},
        'archive': {'archived_at': now}, 'unarchive': {'archived_at': None},
        'trash': {'deleted_at': now}, 'restore': {'deleted_at': None},
        'open': {'last_opened_at': now},
    }
    metadata.update(changes[action])
    return save_validated(project, {'metadata': metadata})


@api.get('/projects/{project_id}/workspace', response=s.WorkspaceOut, tags=['Projects'])
def workspace(request, project_id: s.PositiveId):
    project = get_owned(Project, request.auth, project_id)
    return {
        'project': project, 'acts': project.acts.all(), 'characters': project.characters.all(),
        'scenes': project.scenes.prefetch_related('cast_members'),
    }


@api.get('/projects/{project_id}/acts', response=list[s.ActOut], tags=['Acts'])
@paginate
def list_acts(request, project_id: s.PositiveId):
    return get_owned(Project, request.auth, project_id).acts.all()


@api.post('/projects/{project_id}/acts', response={201: s.ActOut}, tags=['Acts'])
@transaction.atomic
def create_act(request, project_id: s.PositiveId, payload: s.ActIn):
    project = lock_project(request.auth, project_id)
    return 201, save_validated(Act(project=project, **payload.model_dump()))


@api.get('/acts/{act_id}', response=s.ActOut, tags=['Acts'])
def get_act(request, act_id: s.PositiveId):
    return get_owned(Act, request.auth, act_id)


@api.patch('/acts/{act_id}', response=s.ActOut, tags=['Acts'])
@transaction.atomic
def update_act(request, act_id: s.PositiveId, payload: PatchDict[s.ActIn]):
    act = get_owned(Act, request.auth, act_id)
    lock_project(request.auth, act.project_id)
    act = get_owned(Act, request.auth, act_id)
    return save_validated(act, payload)


@api.delete('/acts/{act_id}', response={204: None}, tags=['Acts'])
@transaction.atomic
def delete_act(request, act_id: s.PositiveId):
    """Delete an empty act. Move or delete its scenes first."""
    act = get_owned(Act, request.auth, act_id)
    lock_project(request.auth, act.project_id)
    if act.scenes.exists():
        raise HttpError(409, 'Move or delete the act scenes before deleting this act.')
    act.delete()
    return 204, None


@api.get('/projects/{project_id}/characters', response=list[s.CharacterOut], tags=['Characters'])
@paginate
def list_characters(request, project_id: s.PositiveId):
    return get_owned(Project, request.auth, project_id).characters.all()


@api.post('/projects/{project_id}/characters', response={201: s.CharacterOut}, tags=['Characters'])
@transaction.atomic
def create_character(request, project_id: s.PositiveId, payload: s.CharacterIn):
    project = lock_project(request.auth, project_id)
    return 201, save_validated(Character(project=project, **payload.model_dump()))


@api.get('/characters/{character_id}', response=s.CharacterOut, tags=['Characters'])
def get_character(request, character_id: s.PositiveId):
    return get_owned(Character, request.auth, character_id)


@api.patch('/characters/{character_id}', response=s.CharacterOut, tags=['Characters'])
@transaction.atomic
def update_character(request, character_id: s.PositiveId, payload: PatchDict[s.CharacterIn]):
    character = get_owned(Character, request.auth, character_id)
    lock_project(request.auth, character.project_id)
    character = get_owned(Character, request.auth, character_id)
    return save_validated(character, payload)


@api.delete('/characters/{character_id}', response={204: None}, tags=['Characters'])
@transaction.atomic
def delete_character(request, character_id: s.PositiveId):
    character = get_owned(Character, request.auth, character_id)
    lock_project(request.auth, character.project_id)
    character.delete()
    return 204, None


@api.get('/projects/{project_id}/scenes', response=list[s.SceneOut], tags=['Scenes'])
@paginate
def list_scenes(request, project_id: s.PositiveId, act_id: s.PositiveId | None = None):
    project = get_owned(Project, request.auth, project_id)
    scenes = project.scenes.prefetch_related('cast_members')
    if act_id is not None:
        get_object_or_404(project.acts, pk=act_id)
        scenes = scenes.filter(act_id=act_id)
    return scenes


@api.post('/projects/{project_id}/scenes', response={201: s.SceneOut}, tags=['Scenes'])
@transaction.atomic
def create_scene(request, project_id: s.PositiveId, payload: s.SceneIn):
    project = lock_project(request.auth, project_id)
    data = payload.model_dump()
    act = get_object_or_404(project.acts, pk=data.pop('act_id'))
    return 201, save_validated(Scene(project=project, act=act, **data))


@api.get('/scenes/{scene_id}', response=s.SceneOut, tags=['Scenes'])
def get_scene(request, scene_id: s.PositiveId):
    return get_owned(Scene, request.auth, scene_id)


@api.patch('/scenes/{scene_id}', response=s.SceneOut, tags=['Scenes'])
@transaction.atomic
def update_scene(request, scene_id: s.PositiveId, payload: PatchDict[s.SceneIn]):
    """Changing act_id moves the scene within its project; context GETs never move it."""
    scene = get_owned(Scene, request.auth, scene_id)
    project = lock_project(request.auth, scene.project_id)
    scene = get_owned(Scene, request.auth, scene_id)
    if 'act_id' in payload:
        if payload['act_id'] is None:
            raise ValidationError({'act_id': 'This field cannot be null.'})
        get_object_or_404(project.acts, pk=payload['act_id'])
    return save_validated(scene, payload)


@api.delete('/scenes/{scene_id}', response={204: None}, tags=['Scenes'])
@transaction.atomic
def delete_scene(request, scene_id: s.PositiveId):
    scene = get_owned(Scene, request.auth, scene_id)
    lock_project(request.auth, scene.project_id)
    scene.delete()
    return 204, None


@api.get('/scenes/{scene_id}/cast', response=list[s.CastOut], tags=['Cast'])
@paginate
def list_cast(request, scene_id: s.PositiveId):
    return get_owned(Scene, request.auth, scene_id).cast_members.order_by('pk')


@api.post('/scenes/{scene_id}/cast', response={201: s.CastOut}, tags=['Cast'])
@transaction.atomic
def add_cast_member(request, scene_id: s.PositiveId, payload: s.CastIn):
    scene = get_owned(Scene, request.auth, scene_id)
    project = lock_project(request.auth, scene.project_id)
    character = get_object_or_404(project.characters, pk=payload.character_id)
    member = SceneCharacter(scene=scene, character=character,
                            presence_type=payload.presence_type, notes=payload.notes)
    return 201, save_validated(member)


@api.get('/cast/{cast_id}', response=s.CastOut, tags=['Cast'])
def get_cast_member(request, cast_id: s.PositiveId):
    return get_owned(SceneCharacter, request.auth, cast_id)


@api.patch('/cast/{cast_id}', response=s.CastOut, tags=['Cast'])
@transaction.atomic
def update_cast_member(request, cast_id: s.PositiveId, payload: PatchDict[s.CastUpdateIn]):
    member = get_owned(SceneCharacter, request.auth, cast_id)
    lock_project(request.auth, member.scene.project_id)
    member = get_owned(SceneCharacter, request.auth, cast_id)
    return save_validated(member, payload)


@api.delete('/cast/{cast_id}', response={204: None}, tags=['Cast'])
@transaction.atomic
def delete_cast_member(request, cast_id: s.PositiveId):
    member = get_owned(SceneCharacter, request.auth, cast_id)
    lock_project(request.auth, member.scene.project_id)
    member.delete()
    return 204, None


@api.get('/scenes/{scene_id}/prompts', response=list[s.PromptOut], tags=['Prompt history'])
@paginate
def list_prompts(request, scene_id: s.PositiveId):
    return get_owned(Scene, request.auth, scene_id).generation_requests.all()


@api.post('/scenes/{scene_id}/prompts', response={201: s.PromptOut}, tags=['Prompt history'])
@transaction.atomic
def create_prompt(request, scene_id: s.PositiveId, payload: s.PromptIn):
    """Save an immutable prompt and context. Does not start an LLM or create a fake run."""
    scene = get_owned(Scene, request.auth, scene_id)
    lock_project(request.auth, scene.project_id)
    scene = get_object_or_404(owned(Scene, request.auth).select_related('project', 'act'), pk=scene_id)
    profile = profile_for(request.auth)
    parameters = payload.generation_parameters
    if parameters is None:
        preferences = get_preferences(request)
        parameters = s.GenerationParametersIn(**{
            key: preferences['llm_preferences'][key] for key in ('temperature', 'max_tokens')
        })
    prompt = SceneGenerationRequest(
        scene=scene, user_prompt=payload.user_prompt,
        context_snapshot=prompt_snapshot(scene, profile),
        model_name='Bielik 11B', generation_parameters=parameters.model_dump(),
    )
    return 201, save_validated(prompt)


@api.get('/prompts/{prompt_id}', response=s.PromptOut, tags=['Prompt history'])
def get_prompt(request, prompt_id: s.PositiveId):
    return get_owned(SceneGenerationRequest, request.auth, prompt_id)


@api.get('/prompts/{prompt_id}/run', response=s.RunDetailOut, tags=['Generation runs'])
def prompt_run(request, prompt_id: s.PositiveId):
    prompt = get_owned(SceneGenerationRequest, request.auth, prompt_id)
    return get_object_or_404(GenerationRun.objects.prefetch_related('agent_executions', 'variants'), request=prompt)


@api.get('/scenes/{scene_id}/runs', response=list[s.RunOut], tags=['Generation runs'])
@paginate
def list_runs(request, scene_id: s.PositiveId):
    scene = get_owned(Scene, request.auth, scene_id)
    return owned(GenerationRun, request.auth).filter(request__scene=scene)


@api.get('/runs/{run_id}', response=s.RunDetailOut, tags=['Generation runs'])
def get_run(request, run_id: s.PositiveId):
    return get_object_or_404(
        owned(GenerationRun, request.auth).prefetch_related('agent_executions', 'variants'), pk=run_id,
    )


@api.get('/runs/{run_id}/agents', response=list[s.ExecutionOut], tags=['Agent executions'])
@paginate
def list_executions(request, run_id: s.PositiveId):
    return get_owned(GenerationRun, request.auth, run_id).agent_executions.all()


@api.get('/agent-executions/{execution_id}', response=s.ExecutionOut, tags=['Agent executions'])
def get_execution(request, execution_id: s.PositiveId):
    return get_owned(AgentExecution, request.auth, execution_id)


@api.get('/runs/{run_id}/variants', response=list[s.VariantOut], tags=['Variants'])
@paginate
def run_variants(request, run_id: s.PositiveId):
    return get_owned(GenerationRun, request.auth, run_id).variants.all()


@api.get('/scenes/{scene_id}/variants', response=list[s.VariantOut], tags=['Variants'])
@paginate
def scene_variants(request, scene_id: s.PositiveId):
    return get_owned(Scene, request.auth, scene_id).variants.order_by('-created_at', '-pk')


@api.get('/variants/{variant_id}', response=s.VariantOut, tags=['Variants'])
def get_variant(request, variant_id: s.PositiveId):
    return get_owned(SceneVariant, request.auth, variant_id)


@api.post('/variants/{variant_id}/select', response=s.VariantOut, tags=['Variants'])
@transaction.atomic
def select_variant(request, variant_id: s.PositiveId, payload: s.SelectVariantIn):
    variant = get_owned(SceneVariant, request.auth, variant_id)
    lock_project(request.auth, variant.scene.project_id)
    variant = get_owned(SceneVariant, request.auth, variant_id)
    if variant.run.request.scene_id != variant.scene_id:
        raise HttpError(409, 'Variant belongs to a different generation scene.')
    SceneVariant.objects.filter(scene_id=variant.scene_id).update(is_selected=False)
    save_validated(variant, {'is_selected': True})
    if payload.apply_to_scene:
        scene = Scene.objects.get(pk=variant.scene_id)
        metadata = dict(scene.editor_metadata)
        blocks = variant.critic_metadata.get('blocks')
        if isinstance(blocks, list):
            metadata['blocks'] = blocks
        else:
            metadata.pop('blocks', None)
        save_validated(scene, {'content_text': variant.generated_full_text, 'editor_metadata': metadata})
    return variant
