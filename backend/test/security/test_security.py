import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.test import Client, override_settings
from django.utils import timezone

from backend.api.api import api
from backend.api.models import Project, RequestRateLimit, SceneGenerationRequest
from backend.api.security import LLMCapacityExceeded, RateLimitExceeded, consume_limit, llm_capacity
from backend.test.support.api_base import ApiTestCase
from backend.test.support.graph_transport import patch_writer


class ApiSecurityTests(ApiTestCase):
    def test_every_private_openapi_operation_requires_an_authenticated_session(self):
        client = Client(enforce_csrf_checks=True)
        substitutions = {'project_id': self.project.pk, 'act_id': self.act.pk, 'scene_id': self.scene.pk,
                         'character_id': self.character.pk, 'cast_id': self.member.pk, 'prompt_id': self.prompt.pk,
                         'run_id': self.generation_run.pk, 'execution_id': self.execution.pk,
                         'variant_id': self.variant.pk, 'action': 'open'}
        for path, operations in api.get_openapi_schema()['paths'].items():
            if path in {'/api/auth/csrf', '/api/auth/login', '/api/auth/register'}:
                continue
            for method in operations:
                if method not in {'get', 'post', 'patch', 'put', 'delete'}:
                    continue
                concrete = path.format(**substitutions).removeprefix('/api')
                if concrete.endswith('/export'):
                    concrete += '?format=pdf'
                with self.subTest(method=method, path=path):
                    self.assert_status(self.send(method, concrete, {}, client=client), 401)

    def test_every_private_write_checks_csrf_before_parsing_the_payload(self):
        substitutions = {'project_id': self.project.pk, 'act_id': self.act.pk, 'scene_id': self.scene.pk,
                         'character_id': self.character.pk, 'cast_id': self.member.pk, 'prompt_id': self.prompt.pk,
                         'run_id': self.generation_run.pk, 'execution_id': self.execution.pk,
                         'variant_id': self.variant.pk, 'action': 'open'}
        for path, operations in api.get_openapi_schema()['paths'].items():
            for method in operations:
                if method not in {'post', 'patch', 'put', 'delete'}:
                    continue
                with self.subTest(method=method, path=path):
                    self.assert_status(self.send(method, path.format(**substitutions).removeprefix('/api'), {}, csrf=False), 403)

    def test_forged_session_cookie_and_bearer_header_cannot_authenticate(self):
        client = Client()
        client.cookies[settings.SESSION_COOKIE_NAME] = 'forged-session'
        self.assertEqual(client.get('/api/users/me', HTTP_AUTHORIZATION='Bearer fake-token').status_code, 401)

    def test_untrusted_host_is_rejected_on_a_read_endpoint(self):
        self.assertEqual(self.client.get('/api/users/me', HTTP_HOST='attacker.example').status_code, 400)

    def test_registration_or_rename_cannot_occupy_another_accounts_email_identifier(self):
        self.assert_status(self.send('post', '/auth/register', self.registration_payload(username=self.user.email),
                                     client=Client(enforce_csrf_checks=True)), 409)
        self.assert_status(self.send('patch', '/users/me', {'username': self.other_user.email}), 409)

    @override_settings(LLM_MAX_GENERATION_SECONDS=0)
    @patch_writer()
    def test_total_generation_deadline_fails_without_saving_a_variant(self, generate):
        from backend.api.models import GenerationRun
        response = self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Kontynuuj scenę.'})
        self.assert_status(response, 504)
        generate.assert_not_called()
        run = GenerationRun.objects.filter(request__scene=self.scene).latest('pk')
        self.assertEqual(run.status, 'failed')
        self.assertFalse(run.variants.exists())

    def test_raw_password_is_not_echoed_in_validation_errors(self):
        secret = 'Never-echo-this-password-' * 10
        response = self.assert_status(self.send('post', '/auth/login', {'identifier': 'writer', 'password': secret}), 422)
        self.assertNotIn(secret, response.content.decode())
        self.assertTrue(all('input' not in issue and 'ctx' not in issue for issue in response.json()['detail']))

    def test_body_limits_bad_json_and_nested_or_control_character_payloads(self):
        token = self.client.get('/api/auth/csrf').json()['csrf_token']
        too_big = self.client.post('/api/projects', b'x' * (settings.DATA_UPLOAD_MAX_MEMORY_SIZE + 1),
                                   content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assert_status(too_big, 413)
        bad = self.client.post('/api/projects', '{broken', content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assert_status(bad, 400)
        form = self.client.post('/api/projects', {'title': 'Unsupported form'}, HTTP_X_CSRFTOKEN=token)
        self.assert_status(form, 415)
        nested = 'value'
        for _ in range(20):
            nested = {'nested': nested}
        for metadata in [nested, {'note': '\0'}, {'note': '\ud800'}]:
            self.assert_status(self.send('post', '/projects', {'title': 'Invalid', 'metadata': metadata}), 422)
            self.assert_status(self.send('patch', f'/projects/{self.project.pk}', {'metadata': metadata}), 422)
        self.assert_status(self.send('get', '/projects/' + '9' * 100), 422)
        self.assert_status(self.send('post', '/projects', {'title': '   '}), 422)

    def test_code_like_story_text_is_persisted_as_literal_data(self):
        text = "Robert'); DROP TABLE api_project; -- <script>alert('story')</script>"
        created = self.assert_status(self.send('post', '/projects', {'title': text}), 201).json()
        self.assertEqual(Project.objects.get(pk=created['id']).title, text)
        self.assertTrue(Project.objects.filter(pk=self.project.pk).exists())
        response = self.send('get', f'/projects/{created["id"]}')
        self.assertEqual(response['Content-Type'].split(';')[0], 'application/json')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(response['Cache-Control'], 'no-store')

    def test_rejected_password_changes_still_consume_their_limit(self):
        payload = {'old_password': 'incorrect', 'new_password': self.password, 'new_password_confirm': self.password}
        for _ in range(5):
            self.assert_status(self.send('post', '/users/me/password', payload), 422)
        response = self.assert_status(self.send('post', '/users/me/password', payload), 429)
        self.assertGreater(int(response['Retry-After']), 0)

    def test_different_ips_cannot_bypass_account_login_limit(self):
        client = Client(enforce_csrf_checks=True)
        token = client.get('/api/auth/csrf').json()['csrf_token']
        for index in range(11):
            response = client.post('/api/auth/login', json.dumps({'identifier': 'writer', 'password': 'wrong'}),
                                   content_type='application/json', HTTP_X_CSRFTOKEN=token, REMOTE_ADDR=f'192.0.2.{index}')
            self.assertEqual(response.status_code, 401 if index < 10 else 429)

    def test_forwarded_ip_headers_cannot_bypass_ip_login_limit(self):
        client = Client(enforce_csrf_checks=True)
        token = client.get('/api/auth/csrf').json()['csrf_token']
        for index in range(11):
            response = client.post('/api/auth/login', json.dumps({'identifier': f'unknown-{index}', 'password': 'wrong'}),
                                   content_type='application/json', HTTP_X_CSRFTOKEN=token, HTTP_X_FORWARDED_FOR=f'192.0.2.{index}')
            self.assertEqual(response.status_code, 401 if index < 10 else 429)

    def test_global_model_capacity_blocks_another_user_without_creating_a_run(self):
        before = SceneGenerationRequest.objects.count()
        with llm_capacity(), patch('backend.api.api.generate_variants_for_run') as generate:
            response = self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Kontynuuj scenę.'})
            self.assert_status(response, 503)
            self.assertEqual(response['Retry-After'], '10')
            generate.assert_not_called()
            self.assertEqual(SceneGenerationRequest.objects.count(), before)
            self.assert_status(self.send('post', f'/scenes/{self.foreign_scene.pk}/generate', {'user_prompt': 'Kontynuuj scenę.'}), 404)
        with llm_capacity():
            with self.assertRaises(LLMCapacityExceeded), llm_capacity():
                pass

    def test_rate_window_expires_and_failed_attempts_do_not_extend_it(self):
        with patch('backend.api.security.rate_limits.timezone.now', return_value=timezone.now()) as clock:
            now = clock.return_value
            consume_limit('example', 'identity', limit=2, seconds=60)
            consume_limit('example', 'identity', limit=2, seconds=60)
            with self.assertRaises(RateLimitExceeded):
                consume_limit('example', 'identity', limit=2, seconds=60)
            record = RequestRateLimit.objects.get()
            self.assertNotIn('identity', record.key)
            clock.return_value = now + timedelta(seconds=61)
            consume_limit('example', 'identity', limit=2, seconds=60)
            record.refresh_from_db()
            self.assertEqual(record.requests, 1)

    def test_foreign_generations_and_cancellations_cannot_change_other_users_data(self):
        before = SceneGenerationRequest.objects.count()
        for suffix in ['generate', 'cancel-generation']:
            self.assert_status(self.send('post', f'/scenes/{self.foreign_scene.pk}/{suffix}', {
                'user_prompt': 'Kontynuuj scenę.', 'generation_id': str(uuid4()),
            }), 404)
        self.assertEqual(SceneGenerationRequest.objects.count(), before)

    def test_logout_cancels_only_the_current_accounts_running_generations(self):
        from backend.api.models import GenerationRun
        owned = GenerationRun.objects.create(request=SceneGenerationRequest.objects.create(scene=self.scene, user_prompt='Dalej'), status='running')
        self.foreign_run.status = 'running'
        self.foreign_run.save()
        self.assert_status(self.send('post', '/auth/logout'), 200)
        owned.refresh_from_db()
        self.foreign_run.refresh_from_db()
        self.assertEqual(owned.status, 'cancelled')
        self.assertEqual(self.foreign_run.status, 'running')

    @override_settings(SECURE_SSL_REDIRECT=True, TRUSTED_PROXY_IPS=['127.0.0.1'],
                       SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'))
    def test_only_an_explicitly_trusted_proxy_can_assert_https(self):
        forged = self.client.get('/api/users/me', REMOTE_ADDR='192.0.2.1', HTTP_X_FORWARDED_PROTO='https')
        self.assertEqual(forged.status_code, 301)
        trusted = self.client.get('/api/users/me', REMOTE_ADDR='127.0.0.1', HTTP_X_FORWARDED_PROTO='https')
        self.assertEqual(trusted.status_code, 200)
