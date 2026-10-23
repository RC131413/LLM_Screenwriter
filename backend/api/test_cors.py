import json
import os
import runpy
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.test import Client, SimpleTestCase, TestCase, override_settings

from .models import User


FRONTEND_ORIGINS = [
    f'http://{host}:{port}'
    for host in ('127.0.0.1', 'localhost')
    for port in (5173, 5174, 4173)
]


@override_settings(CORS_ALLOWED_ORIGINS=FRONTEND_ORIGINS, CSRF_TRUSTED_ORIGINS=FRONTEND_ORIGINS)
class CorsHeadersTests(SimpleTestCase):
    def test_csrf_bootstrap_has_credentials_and_exact_origin_headers(self):
        for origin in FRONTEND_ORIGINS:
            with self.subTest(origin=origin):
                response = self.client.get('/api/auth/csrf', HTTP_ORIGIN=origin)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['Access-Control-Allow-Origin'], origin)
                self.assertEqual(response['Access-Control-Allow-Credentials'], 'true')
                self.assertIn('origin', response['Vary'].lower())
                self.assertIn('cookie', response['Vary'].lower())
                self.assertIn(settings.CSRF_COOKIE_NAME, response.cookies)
                self.assertIn('csrf_token', response.json())
                self.assertEqual(response['Cache-Control'], 'no-store')

    def test_preflight_allows_api_methods_and_csrf_header_without_login(self):
        for method in ('GET', 'POST', 'PATCH', 'PUT', 'DELETE'):
            with self.subTest(method=method):
                response = self.client.options(
                    '/api/projects', HTTP_ORIGIN=FRONTEND_ORIGINS[0],
                    HTTP_ACCESS_CONTROL_REQUEST_METHOD=method,
                    HTTP_ACCESS_CONTROL_REQUEST_HEADERS='content-type,x-csrftoken',
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['Access-Control-Allow-Origin'], FRONTEND_ORIGINS[0])
                self.assertEqual(response['Access-Control-Allow-Credentials'], 'true')
                self.assertIn(method, response['Access-Control-Allow-Methods'])
                self.assertIn('x-csrftoken', response['Access-Control-Allow-Headers'])
                self.assertIn('content-type', response['Access-Control-Allow-Headers'])

    def test_unknown_origins_are_not_authorized_including_null_and_wrong_port(self):
        for origin in ('https://untrusted.example.com', 'http://localhost:9999', 'null',
                       'http://localhost:5173.evil.example.com'):
            with self.subTest(origin=origin):
                for response in (
                    self.client.get('/api/auth/csrf', HTTP_ORIGIN=origin),
                    self.client.options('/api/projects', HTTP_ORIGIN=origin,
                                        HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST'),
                ):
                    self.assertNotIn('Access-Control-Allow-Origin', response)
                    self.assertNotIn('Access-Control-Allow-Credentials', response)

    def test_admin_is_not_exposed_via_cors(self):
        response = self.client.get('/admin/login/', HTTP_ORIGIN=FRONTEND_ORIGINS[0])
        self.assertNotIn('Access-Control-Allow-Origin', response)

    def test_error_responses_also_have_cors_headers(self):
        for path, status in [('/api/projects', 401), ('/api/does-not-exist', 404)]:
            response = self.client.get(path, HTTP_ORIGIN=FRONTEND_ORIGINS[0])
            self.assertEqual(response.status_code, status)
            self.assertEqual(response['Access-Control-Allow-Origin'], FRONTEND_ORIGINS[0])

    def test_same_origin_requests_still_work_without_cors_headers(self):
        response = self.client.get('/api/auth/csrf')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('Access-Control-Allow-Origin', response)


class CorsConfigurationTests(SimpleTestCase):
    def configured(self, **overrides):
        environment = {
            'DJANGO_SECRET_KEY': 'test-settings-key', 'DJANGO_DEBUG': 'False',
            'POSTGRES_DB': 'settings_test', 'POSTGRES_USER': 'settings_test',
            'POSTGRES_PASSWORD': 'test-settings-password', **overrides,
        }
        with patch.dict(os.environ, environment, clear=True), patch('dotenv.load_dotenv'):
            return runpy.run_path(str(settings.PROJECT_ROOT / 'backend' / 'settings.py'))

    def test_production_defaults_are_secure_and_deny_cross_origin_access(self):
        config = self.configured()
        self.assertEqual(config['CORS_ALLOWED_ORIGINS'], [])
        self.assertEqual(config['CSRF_TRUSTED_ORIGINS'], [])
        self.assertFalse(config['CORS_ALLOW_ALL_ORIGINS'])
        self.assertTrue(config['SESSION_COOKIE_SECURE'])
        self.assertTrue(config['CSRF_COOKIE_SECURE'])
        self.assertEqual(config['SESSION_COOKIE_SAMESITE'], 'Lax')

    def test_local_defaults_allow_only_known_frontend_ports(self):
        config = self.configured(DJANGO_DEBUG='True')
        self.assertCountEqual(config['CORS_ALLOWED_ORIGINS'], FRONTEND_ORIGINS)
        self.assertCountEqual(config['CSRF_TRUSTED_ORIGINS'], FRONTEND_ORIGINS)
        self.assertFalse(config['SESSION_COOKIE_SECURE'])
        self.assertFalse(config['CSRF_COOKIE_SECURE'])

    def test_env_origin_lists_override_defaults_and_allow_separate_csrf_trust(self):
        config = self.configured(
            CORS_ALLOWED_ORIGINS=' https://app.example.com, https://reader.example.com, ',
            CSRF_TRUSTED_ORIGINS='https://app.example.com',
        )
        self.assertEqual(config['CORS_ALLOWED_ORIGINS'], ['https://app.example.com', 'https://reader.example.com'])
        self.assertEqual(config['CSRF_TRUSTED_ORIGINS'], ['https://app.example.com'])
        self.assertEqual(self.configured(DJANGO_DEBUG='True', CORS_ALLOWED_ORIGINS='')['CORS_ALLOWED_ORIGINS'], [])

    def test_truly_cross_site_cookies_require_secure_https_configuration(self):
        config = self.configured(SESSION_COOKIE_SAMESITE='None', CSRF_COOKIE_SAMESITE='None')
        self.assertEqual(config['SESSION_COOKIE_SAMESITE'], 'None')
        self.assertEqual(config['CSRF_COOKIE_SAMESITE'], 'None')
        for overrides in [
            {'SESSION_COOKIE_SAMESITE': 'None', 'SESSION_COOKIE_SECURE': 'False'},
            {'CSRF_COOKIE_SAMESITE': 'None', 'CSRF_COOKIE_SECURE': 'False'},
            {'SESSION_COOKIE_SAMESITE': 'invalid'}, {'CSRF_COOKIE_SECURE': 'invalid'},
        ]:
            with self.subTest(overrides=overrides), self.assertRaises(ImproperlyConfigured):
                self.configured(**overrides)

    def test_cors_middleware_precedes_response_generating_middleware(self):
        middleware = settings.MIDDLEWARE
        self.assertLess(middleware.index('corsheaders.middleware.CorsMiddleware'),
                        middleware.index('django.middleware.common.CommonMiddleware'))


@override_settings(
    CORS_ALLOWED_ORIGINS=FRONTEND_ORIGINS, CSRF_TRUSTED_ORIGINS=FRONTEND_ORIGINS,
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
    SESSION_COOKIE_SECURE=False, CSRF_COOKIE_SECURE=False,
    SESSION_COOKIE_SAMESITE='Lax', CSRF_COOKIE_SAMESITE='Lax',
)
class CrossOriginSessionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.password = 'A-valid-cookie-test-password-63!'
        cls.user = User.objects.create_user('cors_writer', 'cors.writer@example.com', cls.password)

    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.origin = FRONTEND_ORIGINS[0]

    def bootstrap(self):
        response = self.client.get('/api/auth/csrf', HTTP_ORIGIN=self.origin)
        self.assertEqual(response['Access-Control-Allow-Origin'], self.origin)
        return response.json()['csrf_token']

    def login(self, token):
        return self.client.post('/api/auth/login', json.dumps({
            'identifier': self.user.email, 'password': self.password,
        }), content_type='application/json', HTTP_ORIGIN=self.origin, HTTP_X_CSRFTOKEN=token)

    def test_cross_origin_login_authenticated_write_and_logout(self):
        response = self.login(self.bootstrap())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response['Access-Control-Allow-Origin'], self.origin)
        self.assertEqual(response['Access-Control-Allow-Credentials'], 'true')
        session = response.cookies[settings.SESSION_COOKIE_NAME]
        self.assertTrue(session['httponly'])
        self.assertEqual(session['samesite'], 'Lax')
        self.assertFalse(session['secure'])
        self.assertFalse(session['domain'])
        token = self.bootstrap()
        response = self.client.get('/api/users/me', HTTP_ORIGIN=self.origin)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['id'], self.user.pk)
        response = self.client.post('/api/projects', json.dumps({'title': 'Cross-origin project'}),
                                    content_type='application/json', HTTP_ORIGIN=self.origin,
                                    HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response['Access-Control-Allow-Credentials'], 'true')
        response = self.client.post('/api/auth/logout', HTTP_ORIGIN=self.origin, HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/api/users/me', HTTP_ORIGIN=self.origin).status_code, 401)

    def test_allowed_origin_does_not_bypass_csrf_or_authentication(self):
        self.bootstrap()
        response = self.client.post('/api/auth/login', json.dumps({
            'identifier': self.user.username, 'password': self.password,
        }), content_type='application/json', HTTP_ORIGIN=self.origin)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response['Access-Control-Allow-Origin'], self.origin)
        self.assertEqual(self.client.get('/api/projects', HTTP_ORIGIN=self.origin).status_code, 401)

    def test_old_csrf_token_is_rejected_after_login_rotation(self):
        old_token = self.bootstrap()
        self.assertEqual(self.login(old_token).status_code, 200)
        response = self.client.post('/api/projects', json.dumps({'title': 'Wrong token'}),
                                    content_type='application/json', HTTP_ORIGIN=self.origin,
                                    HTTP_X_CSRFTOKEN=old_token)
        self.assertEqual(response.status_code, 403)
        response = self.client.post('/api/projects', json.dumps({'title': 'Fresh token'}),
                                    content_type='application/json', HTTP_ORIGIN=self.origin,
                                    HTTP_X_CSRFTOKEN=self.bootstrap())
        self.assertEqual(response.status_code, 201)

    @override_settings(CSRF_TRUSTED_ORIGINS=[])
    def test_cors_permission_alone_does_not_grant_write_trust(self):
        response = self.login(self.bootstrap())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response['Access-Control-Allow-Origin'], self.origin)

    @override_settings(SESSION_COOKIE_SECURE=True, CSRF_COOKIE_SECURE=True,
                       SESSION_COOKIE_SAMESITE='None', CSRF_COOKIE_SAMESITE='None')
    def test_secure_cross_site_cookie_attributes_are_applied(self):
        csrf = self.client.get('/api/auth/csrf', secure=True, HTTP_ORIGIN=self.origin)
        self.assertTrue(csrf.cookies[settings.CSRF_COOKIE_NAME]['secure'])
        self.assertEqual(csrf.cookies[settings.CSRF_COOKIE_NAME]['samesite'], 'None')
        response = self.client.post('/api/auth/login', json.dumps({
            'identifier': self.user.username, 'password': self.password,
        }), content_type='application/json', secure=True, HTTP_ORIGIN=self.origin,
            HTTP_X_CSRFTOKEN=csrf.json()['csrf_token'])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.cookies[settings.SESSION_COOKIE_NAME]['secure'])
        self.assertEqual(response.cookies[settings.SESSION_COOKIE_NAME]['samesite'], 'None')
