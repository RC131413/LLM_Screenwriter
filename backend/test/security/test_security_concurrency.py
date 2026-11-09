from concurrent.futures import ThreadPoolExecutor
import json

from django.db import connections
from django.test import Client, TransactionTestCase, override_settings

from backend.api.models import RequestRateLimit, User
from backend.api.security import RateLimitExceeded, consume_limit


class RateLimitConcurrencyTests(TransactionTestCase):
    def test_concurrent_workers_cannot_exceed_a_shared_limit(self):
        def attempt(_):
            try:
                consume_limit('concurrent', 'one-client', limit=5, seconds=60)
                return True
            except RateLimitExceeded:
                return False
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=5) as workers:
            accepted = list(workers.map(attempt, range(20)))
        self.assertEqual(sum(accepted), 5)
        self.assertEqual(RequestRateLimit.objects.get().requests, 6)

    @override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
    def test_crossed_email_usernames_cannot_race_registration_checks(self):
        def register(addresses):
            try:
                client = Client(enforce_csrf_checks=True)
                token = client.get('/api/auth/csrf').json()['csrf_token']
                response = client.post('/api/auth/register', json.dumps({
                    'username': addresses[0], 'email': addresses[1],
                    'password': 'An-original-password-567!', 'password_confirm': 'An-original-password-567!',
                }), content_type='application/json', HTTP_X_CSRFTOKEN=token)
                return response.status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(register, [('alice@example.com', 'bob@example.com'), ('bob@example.com', 'alice@example.com')]))
        self.assertEqual(sorted(results), [201, 409])
        self.assertEqual(User.objects.count(), 1)
