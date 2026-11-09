"""The built SPA and cookie-authenticated API share the Django origin."""

import json
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from django.conf import settings
from django.test import Client, override_settings

from backend.test.support.api_base import ApiTestCase


class FrontendServingTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.directory = Path(self.enterContext(TemporaryDirectory()))
        dist = self.directory / 'dist'
        (dist / 'assets').mkdir(parents=True)
        (self.directory / 'staticfiles').mkdir()
        (dist / 'index.html').write_text(
            '<!doctype html><title>AgentDraft build fixture</title>'
            '<script type="module" src="/static/frontend/assets/app-test.js"></script>',
            encoding='utf-8',
        )
        (dist / 'assets/app-test.js').write_text('window.agentDraftLoaded = true;', encoding='utf-8')
        (dist / 'favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding='utf-8')
        shutil.copytree(dist, self.directory / 'staticfiles/frontend')
        templates = [{**template, 'DIRS': [dist]} for template in settings.TEMPLATES]
        self.enterContext(override_settings(
            DEBUG=False, SECURE_SSL_REDIRECT=False, TEMPLATES=templates,
            STATIC_ROOT=self.directory / 'staticfiles', STATICFILES_DIRS=[('frontend', dist)],
            WHITENOISE_AUTOREFRESH=False, WHITENOISE_USE_FINDERS=False,
        ))
        self.browser = Client(enforce_csrf_checks=True)

    def test_anonymous_browser_receives_uncached_spa_with_security_headers(self):
        response = self.browser.get('/')
        self.assertContains(response, 'AgentDraft build fixture')
        self.assertContains(response, '/static/frontend/assets/app-test.js')
        self.assertIn('no-store', response['Cache-Control'])
        self.assertIn("frame-ancestors 'none'", response['Content-Security-Policy'])
        self.assertEqual(response['X-Frame-Options'], 'DENY')
        self.assertEqual(self.browser.head('/').status_code, 200)
        response = self.browser.get('/static/frontend/index.html')
        body = b''.join(response.streaming_content) if response.streaming else response.content
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'AgentDraft build fixture', body)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertIn("frame-ancestors 'none'", response['Content-Security-Policy'])
        self.assertEqual(response['X-Frame-Options'], 'DENY')

    def test_whitenoise_serves_javascript_and_favicon_without_a_session(self):
        for path, expected, content_type in [
            ('assets/app-test.js', b'window.agentDraftLoaded', 'javascript'),
            ('favicon.svg', b'<svg', 'image/svg+xml'),
        ]:
            with self.subTest(path=path):
                response = self.browser.get('/static/frontend/' + path)
                body = b''.join(response.streaming_content) if response.streaming else response.content
                self.assertEqual(response.status_code, 200)
                self.assertIn(content_type, response['Content-Type'])
                self.assertIn(expected, body)

    def test_missing_assets_api_and_unknown_routes_do_not_return_the_spa(self):
        for path in ['/static/frontend/assets/missing.js', '/api/missing', '/missing']:
            with self.subTest(path=path):
                response = self.browser.get(path)
                self.assertEqual(response.status_code, 404)
                self.assertNotContains(response, 'AgentDraft build fixture', status_code=404)

    def test_missing_build_returns_clear_unavailable_response(self):
        templates = [{**template, 'DIRS': [self.directory / 'missing']} for template in settings.TEMPLATES]
        with override_settings(TEMPLATES=templates):
            response = self.browser.get('/')
        self.assertEqual(response.status_code, 503)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertNotContains(response, 'Traceback', status_code=503)

    def test_same_origin_login_and_write_use_session_and_rotated_csrf(self):
        origin = {'HTTP_HOST': 'localhost:8000', 'HTTP_ORIGIN': 'http://localhost:8000'}
        self.assertEqual(self.browser.get('/', **origin).status_code, 200)
        token = self.browser.get('/api/auth/csrf', **origin).json()['csrf_token']
        response = self.browser.post('/api/auth/login', json.dumps({
            'identifier': self.user.username, 'password': self.password,
        }), content_type='application/json', HTTP_X_CSRFTOKEN=token, **origin)
        self.assert_status(response, 200)
        self.assertIn(settings.SESSION_COOKIE_NAME, self.browser.cookies)
        response = self.browser.post('/api/projects', json.dumps({'title': 'Same-origin project'}),
            content_type='application/json', HTTP_X_CSRFTOKEN=self.browser.cookies[settings.CSRF_COOKIE_NAME].value,
            **origin)
        self.assert_status(response, 201)
