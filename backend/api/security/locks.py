"""PostgreSQL locks for account identifiers and local model capacity."""

from contextlib import contextmanager
import hashlib

from django.db import DatabaseError, connection, connections

from .exceptions import LLMCapacityExceeded, SecurityStoreUnavailable


def lock_auth_identifiers(*identifiers):
    """Serialize colliding registration/rename checks inside the caller's transaction."""
    keys = sorted({int.from_bytes(hashlib.sha256(value.casefold().encode()).digest()[:4], 'big') & 0x7fffffff
                   for value in identifiers})
    with connection.cursor() as cursor:
        for key in keys:
            cursor.execute('SELECT pg_advisory_xact_lock(%s, %s)', [1094992979, key])


@contextmanager
def llm_capacity():
    """A dedicated PG session holds the lock throughout inference, not a DB transaction.

    Closing/crashing the process releases it. Cancellation does NOT release it until
    the model transport has actually stopped, so a second run cannot overlap it.
    """
    guard = connections['default'].copy(alias='llm-capacity')
    acquired = False
    try:
        try:
            with guard.cursor() as cursor:
                cursor.execute('SELECT pg_try_advisory_lock(%s, %s)', [1094992978, 1])
                acquired = cursor.fetchone()[0]
        except DatabaseError as error:
            raise SecurityStoreUnavailable() from error
        if not acquired:
            raise LLMCapacityExceeded()
        yield
    finally:
        # Session closure also releases the advisory lock on exception or timeout.
        guard.close()
