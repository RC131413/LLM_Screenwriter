"""Shared account profile and preference operations."""

from urllib.parse import urlsplit

from django.core.exceptions import ValidationError

from backend.api.models import UserProfile

from .schemas import PreferencesIn


def profile_for(user):
    defaults = PreferencesIn().model_dump()
    profile, _ = UserProfile.objects.get_or_create(user=user, defaults=defaults)
    return profile


def preferences_for(profile):
    """Effective account settings, including defaults for older JSON profiles."""
    defaults = PreferencesIn().model_dump()
    return {
        'writing_style_preferences': {
            **defaults['writing_style_preferences'], **profile.writing_style_preferences,
        },
        'llm_preferences': {
            **defaults['llm_preferences'], **profile.llm_preferences,
            'model_name': defaults['llm_preferences']['model_name'],
            'max_tokens': defaults['llm_preferences']['max_tokens'],
        },
    }


def validate_avatar(value):
    if value:
        try:
            parsed = urlsplit(value)
        except ValueError as error:
            raise ValidationError({'avatar_url': 'Use a valid HTTP or HTTPS URL.'}) from error
        if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
            raise ValidationError({'avatar_url': 'Use an absolute HTTP or HTTPS URL.'})
