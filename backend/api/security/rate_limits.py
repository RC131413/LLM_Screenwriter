"""Atomic PostgreSQL rate limits shared across backend processes."""

import hashlib
from ipaddress import ip_address
from datetime import timedelta

from django.conf import settings
from django.db import DatabaseError, connection
from django.utils import timezone

from ..models import RequestRateLimit
from .exceptions import RateLimitExceeded, SecurityStoreUnavailable


def consume_limit(scope, identity, *, limit, seconds):
    """One atomic UPSERT across workers; rejecting requests never extends a window."""
    key = hashlib.sha256(f'{scope}:{identity}'.encode()).hexdigest()
    now = timezone.now()
    until = now + timedelta(seconds=seconds)
    table = connection.ops.quote_name(RequestRateLimit._meta.db_table)
    try:
        with connection.cursor() as cursor:
            cursor.execute(f'''
                INSERT INTO {table} (key, requests, expires_at) VALUES (%s, 1, %s)
                ON CONFLICT (key) DO UPDATE SET
                    requests = CASE WHEN {table}.expires_at <= %s THEN 1
                                    ELSE LEAST({table}.requests + 1, %s) END,
                    expires_at = CASE WHEN {table}.expires_at <= %s THEN %s ELSE {table}.expires_at END
                RETURNING requests, expires_at
            ''', [key, until, now, limit + 1, now, until])
            count, expires = cursor.fetchone()
    except DatabaseError as error:
        raise SecurityStoreUnavailable() from error
    if count > limit:
        raise RateLimitExceeded((expires - now).total_seconds())


def request_limit(request, scope, *, limit, seconds, identity=None):
    if identity is None:
        identity = f'user:{request.user.pk}' if request.user.is_authenticated else f'ip:{client_ip(request)}'
    consume_limit(scope, identity, limit=limit, seconds=seconds)


def client_ip(request):
    peer = request.META.get('REMOTE_ADDR', 'unknown')
    if peer in settings.TRUSTED_PROXY_IPS:
        try:
            # The trusted proxy must OVERWRITE this header with one IP, not append.
            return str(ip_address(request.META.get('HTTP_X_FORWARDED_FOR', '')))
        except ValueError:
            pass
    return peer
