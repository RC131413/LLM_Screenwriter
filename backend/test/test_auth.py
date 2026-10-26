import json

from django.test import Client

from backend.api.models import User

from ._api_base import ApiTestCase


class AuthTests(ApiTestCase):

    def test_anonymous_requests_cannot_read_or_write_private_data(self):
        anonymous = Client(enforce_csrf_checks=True)
        for path in ['/users/me', '/users/me/profile', '/users/me/preferences', '/projects',
                     f'/scenes/{self.scene.pk}', f'/runs/{self.generation_run.pk}']:
            with self.subTest(path=path):
                self.assert_status(self.send('get', path, client=anonymous), 401)
        self.assert_status(self.send('post', '/projects', {'title': 'No'}, client=anonymous), 401)

    def test_session_writes_require_csrf(self):
        self.assert_status(self.send('post', '/projects', {'title': 'No token'}, csrf=False), 403)
        self.assert_status(self.send('post', '/projects', {'title': 'With token'}), 201)

    def test_login_and_registration_require_csrf_even_without_a_session(self):
        client = Client(enforce_csrf_checks=True)
        for path, data in [('/auth/login', {'identifier': 'writer', 'password': self.password}),
                           ('/auth/register', self.registration_payload())]:
            with self.subTest(path=path):
                self.assert_status(self.send('post', path, data, client=client, csrf=False), 403)

    def test_registration_hashes_password_creates_profile_and_logs_in(self):
        client = Client(enforce_csrf_checks=True)
        response = self.assert_status(self.send('post', '/auth/register', self.registration_payload(), client=client), 201)
        user = User.objects.get(username='new_writer')
        self.assertEqual(user.email, 'new@example.com')
        self.assertTrue(user.check_password(self.password))
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertEqual(user.profile.llm_preferences['temperature'], 0.7)
        self.assertNotIn('password', response.json())
        self.assert_status(self.send('get', '/users/me', client=client), 200)

    def test_registration_rejects_duplicates_and_invalid_passwords(self):
        for data, code in [
            (self.registration_payload(email='WRITER@example.com'), 409),
            (self.registration_payload(username='WRITER'), 409),
            (self.registration_payload(password_confirm='Different-password-12!'), 422),
            (self.registration_payload(password='password', password_confirm='password'), 422),
            (self.registration_payload(email='not-an-email'), 422),
            (self.registration_payload(username='invalid user'), 422),
            (self.registration_payload(is_staff=True), 422),
        ]:
            with self.subTest(code=code, keys=list(data)):
                client = Client(enforce_csrf_checks=True)
                self.assert_status(self.send('post', '/auth/register', data, client=client), code)
        self.assertFalse(User.objects.filter(username='new_writer').exists())

    def test_login_by_username_or_email_and_logout(self):
        for identifier in ['writer', 'WRITER@example.com']:
            with self.subTest(identifier=identifier):
                client = Client(enforce_csrf_checks=True)
                self.assert_status(self.send('post', '/auth/login', {
                    'identifier': identifier, 'password': self.password,
                }, client=client), 200)
                self.assert_status(self.send('post', '/auth/logout', client=client), 200)
                self.assert_status(self.send('get', '/users/me', client=client), 401)

    def test_login_rejects_bad_credentials_and_inactive_users(self):
        client = Client(enforce_csrf_checks=True)
        for identifier, password in [('writer', 'wrong'), ('missing', self.password)]:
            self.assert_status(self.send('post', '/auth/login', {
                'identifier': identifier, 'password': password,
            }, client=client), 401)
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assert_status(self.send('post', '/auth/login', {
            'identifier': 'writer', 'password': self.password,
        }, client=client), 401)

    def test_login_throttles_repeated_attempts(self):
        client = Client(enforce_csrf_checks=True)
        for _ in range(10):
            self.assert_status(self.send('post', '/auth/login', {
                'identifier': 'writer', 'password': 'wrong',
            }, client=client), 401)
        self.assert_status(self.send('post', '/auth/login', {
            'identifier': 'writer', 'password': 'wrong',
        }, client=client), 429)

    def test_cross_origin_login_and_session_writes_fail_csrf(self):
        token = self.client.get('/api/auth/csrf').json()['csrf_token']
        response = self.client.post('/api/projects', json.dumps({'title': 'Attack'}),
                                    content_type='application/json', HTTP_X_CSRFTOKEN=token,
                                    HTTP_ORIGIN='https://untrusted.example.com')
        self.assert_status(response, 403)
        response = self.client.post('/api/auth/login', json.dumps({
            'identifier': self.user.username, 'password': self.password,
        }), content_type='application/json', HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN='https://untrusted.example.com')
        self.assert_status(response, 403)

