"""Session-based authentication and account endpoints, mounted in the main API."""

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.middleware.csrf import get_token
from ninja import PatchDict, Router
from ninja.errors import HttpError
from ninja.security import django_auth
from ninja.utils import check_csrf

from backend.api.models import User
from backend.api.security import lock_auth_identifiers, request_limit
from backend.api.services import cancel_user_generations, save_validated

from . import schemas as s
from .services import preferences_for, profile_for, validate_avatar


router = Router(auth=django_auth)


@router.get('/auth/csrf', auth=None, response=s.CsrfOut, tags=['Authentication'])
def csrf_token(request, response: HttpResponse):
    response['Cache-Control'] = 'no-store'
    return {'csrf_token': get_token(request)}


@router.post('/auth/register', auth=None, response={201: s.UserOut}, tags=['Authentication'])
@transaction.atomic
def register(request, payload: s.RegisterIn):
    if check_csrf(request):
        raise HttpError(403, 'CSRF check failed.')
    if payload.password != payload.password_confirm:
        raise ValidationError({'password_confirm': 'Passwords do not match.'})
    email = str(payload.email).lower()
    username = User.normalize_username(payload.username)
    lock_auth_identifiers(username, email)
    if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=username)
                           | Q(email__iexact=username) | Q(username__iexact=email)).exists():
        raise HttpError(409, 'Username or email is already in use.')
    user = User(username=username, email=email)
    validate_password(payload.password, user=user)
    user.set_password(payload.password)
    save_validated(user)
    profile_for(user)
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    return 201, user


@router.post('/auth/login', auth=None, response=s.UserOut, tags=['Authentication'])
def sign_in(request, payload: s.LoginIn):
    if check_csrf(request):
        raise HttpError(403, 'CSRF check failed.')
    candidates = list(User.objects.filter(
        Q(username=payload.identifier) | Q(email__iexact=payload.identifier),
    ).values_list('pk', 'username')[:2])
    identity = f'user:{candidates[0][0]}' if len(candidates) == 1 else payload.identifier.strip().casefold()
    request_limit(request, 'login-account', limit=10, seconds=300, identity=identity)
    # Ambiguous username/email identifiers must not log into the wrong account.
    username = candidates[0][1] if len(candidates) == 1 else ''
    user = authenticate(request, username=username, password=payload.password)
    if user is None:
        raise HttpError(401, 'Invalid credentials.')
    profile_for(user)
    login(request, user)
    return user


@router.post('/auth/logout', response=s.MessageOut, tags=['Authentication'])
def sign_out(request):
    cancel_user_generations(request.auth)
    logout(request)
    return {'detail': 'Logged out.'}


@router.get('/users/me', response=s.UserOut, tags=['Account'])
def current_user(request):
    profile_for(request.auth)
    return request.auth


@router.patch('/users/me', response=s.UserOut, tags=['Account'])
@transaction.atomic
def update_account(request, payload: PatchDict[s.AccountIn]):
    user = User.objects.select_for_update().get(pk=request.auth.pk)
    payload = dict(payload)
    username = payload.get('username')
    if username:
        username = User.normalize_username(username.strip())
        payload['username'] = username
        lock_auth_identifiers(user.username, username)
        if User.objects.filter(Q(username__iexact=username) | Q(email__iexact=username)).exclude(pk=user.pk).exists():
            raise HttpError(409, 'Username is already in use.')
    save_validated(user, payload)
    profile_for(user)
    return user


@router.post('/users/me/password', response=s.MessageOut, tags=['Account'])
@transaction.atomic
def change_password(request, payload: s.PasswordIn):
    user = User.objects.select_for_update().get(pk=request.auth.pk)
    if not user.check_password(payload.old_password):
        raise ValidationError({'old_password': 'Incorrect current password.'})
    if payload.new_password != payload.new_password_confirm:
        raise ValidationError({'new_password_confirm': 'Passwords do not match.'})
    validate_password(payload.new_password, user=user)
    user.set_password(payload.new_password)
    cancel_user_generations(user)
    save_validated(user)
    update_session_auth_hash(request, user)
    return {'detail': 'Password changed.'}


@router.get('/users/me/profile', response=s.ProfileOut, tags=['Account'])
def get_profile(request):
    return profile_for(request.auth)


@router.patch('/users/me/profile', response=s.ProfileOut, tags=['Account'])
@transaction.atomic
def update_profile(request, payload: PatchDict[s.ProfileIn]):
    User.objects.select_for_update().get(pk=request.auth.pk)
    if 'avatar_url' in payload:
        validate_avatar(payload['avatar_url'])
    return save_validated(profile_for(request.auth), payload)


@router.get('/users/me/preferences', response=s.PreferencesIn, tags=['Preferences'])
def get_preferences(request):
    return preferences_for(profile_for(request.auth))


@router.put('/users/me/preferences', response=s.PreferencesIn, tags=['Preferences'])
@transaction.atomic
def update_preferences(request, payload: s.PreferencesIn):
    User.objects.select_for_update().get(pk=request.auth.pk)
    save_validated(profile_for(request.auth), payload.model_dump())
    return payload
