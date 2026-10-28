"""Ownership checks and shared write operations for the HTTP API."""

import json
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.db.models import JSONField
from django.shortcuts import get_object_or_404

from .models import (
    Act, AgentExecution, Character, GenerationRun, Project, Scene,
    SceneCharacter, SceneGenerationRequest, SceneVariant, UserProfile,
)
from .scheams import PreferencesIn


OWNER_PATHS = {
    Project: 'user',
    Act: 'project__user',
    Character: 'project__user',
    Scene: 'project__user',
    SceneCharacter: 'scene__project__user',
    SceneGenerationRequest: 'scene__project__user',
    GenerationRun: 'request__scene__project__user',
    AgentExecution: 'run__request__scene__project__user',
    SceneVariant: 'scene__project__user',
}


SCENE_GENERATION_SYSTEM_PROMPT = (
    'Jesteś polskim scenarzystą. Wykonaj instrukcję użytkownika na podstawie aktualnej sceny. '
    'Zwróć wyłącznie gotową treść sceny, bez komentarzy i bez znaczników Markdown. '
    'Jeśli scena jest pusta, napisz ją na podstawie instrukcji użytkownika.'
)


def scene_generation_prompt(prompt):
    """Use the frozen database snapshot, never scene text supplied by the browser."""
    scene = prompt.context_snapshot['scene']
    return (
        f'{prompt.system_prompt}\n\n'
        f'AKTUALNA SCENA:\n'
        f'Tytuł: {scene["title"]}\n'
        f'Miejsce / nagłówek: {scene["location_heading"]}\n'
        f'Pora dnia: {scene["time_of_day"]}\n'
        f'Treść:\n{scene["content_text"] or "(Scena nie zawiera jeszcze tekstu.)"}\n\n'
        f'INSTRUKCJA UŻYTKOWNIKA:\n{prompt.user_prompt}'
    )


def owned(model, user):
    return model.objects.filter(**{OWNER_PATHS[model]: user})


def get_owned(model, user, pk):
    return get_object_or_404(owned(model, user), pk=pk)


def lock_project(user, pk):
    return get_object_or_404(owned(Project, user).select_for_update(), pk=pk)


def save_validated(instance, changes=None):
    for name, value in (changes or {}).items():
        setattr(instance, name, value)
    for field in instance._meta.fields:
        value = getattr(instance, field.attname)
        if (value is None and not field.null and not field.primary_key
                and not getattr(field, 'auto_now', False) and not getattr(field, 'auto_now_add', False)):
            raise ValidationError({field.name: 'This field cannot be null.'})
        if isinstance(field, JSONField):
            try:
                json.dumps(value, allow_nan=False)
            except (TypeError, ValueError) as error:
                raise ValidationError({field.name: 'Use valid JSON without NaN or Infinity.'}) from error
    instance.full_clean()
    instance.save()
    return instance


def profile_for(user):
    defaults = PreferencesIn().model_dump()
    profile, _ = UserProfile.objects.get_or_create(user=user, defaults=defaults)
    return profile


def validate_avatar(value):
    if value:
        try:
            parsed = urlsplit(value)
        except ValueError as error:
            raise ValidationError({'avatar_url': 'Use a valid HTTP or HTTPS URL.'}) from error
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
            raise ValidationError({'avatar_url': 'Use an absolute HTTP or HTTPS URL.'})


def prompt_snapshot(scene, profile):
    # Freeze the inputs instead of trusting client-supplied foreign IDs or context.
    return {
        'project': {
            'id': scene.project_id, 'title': scene.project.title,
            'logline': scene.project.logline, 'synopsis': scene.project.synopsis,
            'genre': scene.project.genre, 'target_audience': scene.project.target_audience,
            'screenplay_format': scene.project.screenplay_format,
        },
        'act': {
            'id': scene.act_id, 'act_number': scene.act.act_number,
            'title': scene.act.title, 'summary': scene.act.summary,
        },
        'scene': {
            'id': scene.pk, 'scene_number': scene.scene_number, 'title': scene.title,
            'location_heading': scene.location_heading, 'time_of_day': scene.time_of_day,
            'content_text': scene.content_text, 'ai_metadata': scene.ai_metadata,
            'editor_metadata': scene.editor_metadata,
        },
        'characters': [
            {
                'id': member.character_id, 'name': member.character.name,
                'role': member.character.role, 'age': member.character.age,
                'psychological_profile': member.character.psychological_profile,
                'appearance': member.character.appearance, 'backstory': member.character.backstory,
                'goals': member.character.goals, 'fears': member.character.fears,
                'voice_profile': member.character.voice_profile,
                'memory_metadata': member.character.memory_metadata,
                'presence_type': member.presence_type, 'notes': member.notes,
            }
            for member in scene.cast_members.select_related('character').order_by('pk')
        ],
        'writing_style_preferences': profile.writing_style_preferences,
        'llm_preferences': profile.llm_preferences,
    }
