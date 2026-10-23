import json
from decimal import Decimal

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from .models import (
    Act, AgentExecution, Character, GenerationRun, Project, Scene,
    SceneCharacter, SceneGenerationRequest, SceneVariant, User, UserProfile,
)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.password = 'An-original-test-password-483!'
        cls.user = User.objects.create_user('writer', 'writer@example.com', cls.password)
        cls.other_user = User.objects.create_user('other', 'other@example.com', cls.password)
        cls.project = Project.objects.create(user=cls.user, title='First project')
        cls.second_project = Project.objects.create(user=cls.user, title='Second project')
        cls.foreign_project = Project.objects.create(user=cls.other_user, title='Private project')
        cls.act = Act.objects.create(project=cls.project, act_number=1)
        cls.next_act = Act.objects.create(project=cls.project, act_number=2)
        cls.second_act = Act.objects.create(project=cls.second_project, act_number=1)
        cls.foreign_act = Act.objects.create(project=cls.foreign_project, act_number=1)
        cls.scene = Scene.objects.create(project=cls.project, act=cls.act, scene_number=1, title='Opening')
        cls.next_scene = Scene.objects.create(project=cls.project, act=cls.act, scene_number=2)
        cls.foreign_scene = Scene.objects.create(project=cls.foreign_project, act=cls.foreign_act, scene_number=1)
        cls.character = Character.objects.create(project=cls.project, name='ANNA')
        cls.second_character = Character.objects.create(project=cls.second_project, name='ADAM')
        cls.foreign_character = Character.objects.create(project=cls.foreign_project, name='EWA')
        cls.member = SceneCharacter.objects.create(scene=cls.scene, character=cls.character)
        cls.foreign_member = SceneCharacter.objects.create(scene=cls.foreign_scene, character=cls.foreign_character)
        cls.prompt = SceneGenerationRequest.objects.create(scene=cls.scene, user_prompt='Opening prompt')
        cls.foreign_prompt = SceneGenerationRequest.objects.create(scene=cls.foreign_scene, user_prompt='Private prompt')
        cls.generation_run = GenerationRun.objects.create(request=cls.prompt, status='completed', total_duration_ms=125)
        cls.foreign_run = GenerationRun.objects.create(request=cls.foreign_prompt)
        cls.execution = AgentExecution.objects.create(run=cls.generation_run, agent_name='Writer', status='completed')
        cls.foreign_execution = AgentExecution.objects.create(run=cls.foreign_run, agent_name='Writer')
        cls.variant = SceneVariant.objects.create(
            run=cls.generation_run, scene=cls.scene, variant_number=1,
            generated_full_text='ANNA opens the window.', critic_score=Decimal('8.50'),
        )
        cls.next_variant = SceneVariant.objects.create(
            run=cls.generation_run, scene=cls.scene, variant_number=2, generated_full_text='ANNA closes the door.',
        )
        cls.foreign_variant = SceneVariant.objects.create(
            run=cls.foreign_run, scene=cls.foreign_scene, variant_number=1, generated_full_text='Private text.',
        )

    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.user)

    def send(self, method, path, data=None, *, client=None, csrf=True):
        client = client or self.client
        headers = {}
        if csrf and method.lower() not in {'get', 'head', 'options'}:
            token = client.get('/api/auth/csrf').json()['csrf_token']
            headers['HTTP_X_CSRFTOKEN'] = token
        return getattr(client, method.lower())(
            '/api' + path, data=json.dumps(data) if data is not None else None,
            content_type='application/json', **headers,
        ) if method.lower() != 'get' else client.get('/api' + path)

    def assert_status(self, response, expected):
        self.assertEqual(response.status_code, expected, response.content[:1500])
        return response

    def test_openapi_and_docs_cover_all_resource_groups(self):
        response = self.assert_status(self.client.get('/api/openapi.json'), 200)
        schema = response.json()
        self.assertIn('/api/scenes/{scene_id}/prompts', schema['paths'])
        self.assertIn('/api/variants/{variant_id}/select', schema['paths'])
        self.assertIn('cookie', json.dumps(schema['components']['securitySchemes']))
        self.assertNotIn('password', schema['components']['schemas']['UserOut']['properties'])
        self.assert_status(self.client.get('/api/docs'), 200)

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

    def registration_payload(self, **changes):
        return {
            'username': 'new_writer', 'email': 'NEW@example.com',
            'password': self.password, 'password_confirm': self.password, **changes,
        }

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

    def test_current_account_does_not_expose_authentication_fields(self):
        response = self.assert_status(self.send('get', '/users/me'), 200).json()
        self.assertEqual(response['email'], self.user.email)
        self.assertEqual(response['profile']['user_id'], self.user.pk)
        for field in ['password', 'password_hash', 'is_staff', 'is_superuser', 'user_permissions']:
            self.assertNotIn(field, response)

    def test_account_update_only_allows_username(self):
        self.assert_status(self.send('patch', '/users/me', {'username': 'screenwriter'}), 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, 'screenwriter')
        for data in [{'email': 'changed@example.com'}, {'is_staff': True}, {'username': None}]:
            self.assert_status(self.send('patch', '/users/me', data), 422)
        self.assert_status(self.send('patch', '/users/me', {'username': 'OTHER'}), 409)

    def test_password_change_verifies_old_and_confirmation_and_preserves_session(self):
        data = {'old_password': self.password, 'new_password': 'Another-strong-password-826!',
                'new_password_confirm': 'Another-strong-password-826!'}
        self.assert_status(self.send('post', '/users/me/password', {**data, 'old_password': 'wrong'}), 422)
        self.assert_status(self.send('post', '/users/me/password', {**data, 'new_password_confirm': self.password}), 422)
        self.assert_status(self.send('post', '/users/me/password', data), 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(data['new_password']))
        self.assertFalse(self.user.check_password(self.password))
        self.assert_status(self.send('get', '/users/me'), 200)

    def test_profile_and_preferences_defaults_and_updates(self):
        response = self.assert_status(self.send('patch', '/users/me/profile', {
            'display_name': 'Writer Name', 'avatar_url': 'https://example.com/avatar.png',
            'preferred_language': 'pl',
        }), 200)
        self.assertEqual(response.json()['display_name'], 'Writer Name')
        self.assert_status(self.send('get', '/users/me/profile'), 200)
        preferences = self.assert_status(self.send('get', '/users/me/preferences'), 200).json()
        self.assertEqual(preferences['llm_preferences']['max_tokens'], 2048)
        preferences['llm_preferences']['temperature'] = 0.4
        preferences['writing_style_preferences']['parentheticals'] = 'ignore'
        self.assert_status(self.send('put', '/users/me/preferences', preferences), 200)
        self.assertEqual(UserProfile.objects.get(user=self.user).llm_preferences['temperature'], 0.4)
        self.assert_status(self.send('put', '/users/me/preferences', {}), 200)
        self.assertEqual(UserProfile.objects.get(user=self.user).llm_preferences['temperature'], 0.7)

    def test_invalid_preferences_and_avatar_are_rejected(self):
        for preferences in [
            {'llm_preferences': {'temperature': 1.1}},
            {'llm_preferences': {'temperature': 0.15}},
            {'llm_preferences': {'max_tokens': 0}},
            {'llm_preferences': {'model_name': 'another model'}},
            {'writing_style_preferences': {'parentheticals': 'always'}},
            {'writing_style_preferences': None},
        ]:
            self.assert_status(self.send('put', '/users/me/preferences', preferences), 422)
        self.assert_status(self.send('patch', '/users/me/profile', {'preferred_language': 'en'}), 422)
        self.assert_status(self.send('patch', '/users/me/profile', {'avatar_url': 'javascript:alert(1)'}), 422)
        self.assert_status(self.send('patch', '/users/me/profile', {'avatar_url': 'http://['}), 422)

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

    def test_empty_legacy_profile_json_uses_defaults(self):
        UserProfile.objects.create(user=self.user)
        response = self.assert_status(self.send('get', '/users/me/preferences'), 200).json()
        self.assertEqual(response['llm_preferences']['model_name'], 'Bielik 11B (Lokalny)')
        self.assertEqual(response['writing_style_preferences']['parentheticals'], 'sparingly')

    def test_other_sessions_expire_after_password_change(self):
        another_session = Client(enforce_csrf_checks=True)
        another_session.force_login(self.user)
        self.assert_status(self.send('post', '/users/me/password', {
            'old_password': self.password, 'new_password': 'Different-test-secret-798!',
            'new_password_confirm': 'Different-test-secret-798!',
        }), 200)
        self.assert_status(self.send('get', '/users/me', client=another_session), 401)

    def test_prompt_uses_saved_engine_preferences(self):
        self.assert_status(self.send('put', '/users/me/preferences', {
            'llm_preferences': {'temperature': 0.2, 'max_tokens': 512},
        }), 200)
        prompt = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/prompts', {
            'user_prompt': 'Use the saved settings.',
        }), 201).json()
        self.assertEqual(prompt['generation_parameters'], {'temperature': 0.2, 'max_tokens': 512})
        self.assertEqual(prompt['context_snapshot']['llm_preferences']['temperature'], 0.2)

    def test_variant_with_mismatched_run_is_not_applied(self):
        SceneVariant.objects.filter(pk=self.variant.pk).update(run=self.foreign_run, variant_number=2)
        self.assert_status(self.send('post', f'/variants/{self.variant.pk}/select', {'apply_to_scene': True}), 409)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, '')

    def test_removing_character_does_not_remove_its_scenes(self):
        self.assert_status(self.send('delete', f'/characters/{self.character.pk}'), 204)
        self.assertFalse(SceneCharacter.objects.filter(pk=self.member.pk).exists())
        self.assertTrue(Scene.objects.filter(pk=self.scene.pk).exists())

    def test_project_crud_and_workspace(self):
        project = self.assert_status(self.send('post', '/projects', {
            'title': 'New film', 'synopsis': 'A long synopsis', 'target_audience': 'Adults',
        }), 201).json()
        self.assertEqual(project['user_id'], self.user.pk)
        pk = project['id']
        self.assert_status(self.send('get', f'/projects/{pk}'), 200)
        self.assert_status(self.send('patch', f'/projects/{pk}', {'title': 'Renamed'}), 200)
        self.assertEqual(Project.objects.get(pk=pk).synopsis, 'A long synopsis')
        self.assert_status(self.send('delete', f'/projects/{pk}'), 204)
        self.assertFalse(Project.objects.filter(pk=pk).exists())
        workspace = self.assert_status(self.send('get', f'/projects/{self.project.pk}/workspace'), 200).json()
        self.assertEqual(len(workspace['scenes']), 2)
        self.assertEqual(workspace['scenes'][0]['cast_members'][0]['character_id'], self.character.pk)

    def test_project_filters_soft_delete_archive_favorite_and_recent(self):
        pk = self.project.pk
        self.assertEqual(self.send('get', '/projects').json()['count'], 2)
        for action, collection in [('favorite', 'favorites'), ('open', 'recent'), ('archive', 'archive'), ('trash', 'trash')]:
            self.assert_status(self.send('post', f'/projects/{pk}/actions/{action}'), 200)
            response = self.assert_status(self.send('get', f'/projects?collection={collection}'), 200).json()
            self.assertEqual([p['id'] for p in response['items']], [pk])
        self.assertEqual(self.send('get', '/projects?collection=archive').json()['count'], 0)
        self.assert_status(self.send('post', f'/projects/{pk}/actions/restore'), 200)
        self.assert_status(self.send('post', f'/projects/{pk}/actions/unarchive'), 200)
        self.assert_status(self.send('post', f'/projects/{pk}/actions/unfavorite'), 200)
        self.assertEqual(self.send('get', '/projects?collection=favorites').json()['count'], 0)
        self.assertEqual(self.send('get', '/projects').json()['count'], 2)
        self.assertEqual(self.send('get', '/projects?search=Second').json()['count'], 1)

    def test_pagination_is_bounded_and_validated(self):
        response = self.assert_status(self.send('get', '/projects?limit=1&offset=1'), 200).json()
        self.assertEqual(response['count'], 2)
        self.assertEqual(len(response['items']), 1)
        for query in ['limit=0', 'limit=101', 'offset=-1', 'collection=invalid']:
            self.assert_status(self.send('get', '/projects?' + query), 422)

    def test_client_cannot_override_owner_or_server_fields(self):
        for data in [{'title': 'No', 'user_id': self.other_user.pk},
                     {'title': 'No', 'id': 999}, {'title': 'No', 'created_at': '2000-01-01'}]:
            self.assert_status(self.send('post', '/projects', data), 422)
        self.assert_status(self.send('patch', f'/acts/{self.act.pk}', {'project_id': self.foreign_project.pk}), 422)

    def test_act_crud_and_nonempty_delete_protection(self):
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/acts'), 200)
        act = self.assert_status(self.send('post', f'/projects/{self.project.pk}/acts', {
            'act_number': 3, 'title': 'Final act', 'summary': 'Resolution',
        }), 201).json()
        self.assert_status(self.send('get', f'/acts/{act["id"]}'), 200)
        self.assert_status(self.send('patch', f'/acts/{act["id"]}', {'summary': 'New summary', 'sort_order': 7}), 200)
        self.assert_status(self.send('delete', f'/acts/{act["id"]}'), 204)
        self.assert_status(self.send('delete', f'/acts/{self.act.pk}'), 409)
        self.assertTrue(Scene.objects.filter(pk=self.scene.pk).exists())

    def test_duplicate_numbers_and_null_values_fail_without_database_damage(self):
        self.assert_status(self.send('post', f'/projects/{self.project.pk}/acts', {'act_number': 1}), 422)
        for payload in [{'act_number': 0}, {'act_number': None}, {'title': None}, {'metadata': None}]:
            self.assert_status(self.send('patch', f'/acts/{self.next_act.pk}', payload), 422)
        self.next_act.refresh_from_db()
        self.assertEqual(self.next_act.act_number, 2)
        self.assert_status(self.send('get', '/projects'), 200)

    def test_character_crud_includes_llm_context_fields(self):
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/characters'), 200)
        character = self.assert_status(self.send('post', f'/projects/{self.project.pk}/characters', {
            'name': 'JAN', 'appearance': 'Grey coat', 'backstory': 'A former teacher',
            'voice_profile': {'tone': 'quiet'}, 'age': 40,
        }), 201).json()
        self.assertEqual(character['appearance'], 'Grey coat')
        pk = character['id']
        self.assert_status(self.send('get', f'/characters/{pk}'), 200)
        self.assert_status(self.send('patch', f'/characters/{pk}', {'backstory': 'A former writer', 'age': None}), 200)
        self.assert_status(self.send('delete', f'/characters/{pk}'), 204)

    def test_scene_crud_move_and_context_get_are_independent(self):
        scene = self.assert_status(self.send('post', f'/projects/{self.project.pk}/scenes', {
            'act_id': self.act.pk, 'scene_number': 3, 'title': 'New scene',
            'ai_metadata': {'scene_goal': 'Reveal the truth'}, 'editor_metadata': {'notes': 'Quietly'},
        }), 201).json()
        pk = scene['id']
        self.assert_status(self.send('patch', f'/scenes/{pk}', {'act_id': self.next_act.pk}), 200)
        self.assertEqual(Scene.objects.get(pk=pk).act_id, self.next_act.pk)
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/scenes?act_id={self.act.pk}'), 200)
        self.assertEqual(Scene.objects.get(pk=pk).act_id, self.next_act.pk)
        self.assert_status(self.send('get', f'/scenes/{pk}'), 200)
        self.assert_status(self.send('delete', f'/scenes/{pk}'), 204)

    def test_scene_cannot_move_to_another_project_even_same_owner(self):
        for act in [self.second_act, self.foreign_act]:
            self.assert_status(self.send('patch', f'/scenes/{self.scene.pk}', {'act_id': act.pk}), 404)
            self.assert_status(self.send('post', f'/projects/{self.project.pk}/scenes', {
                'act_id': act.pk, 'scene_number': 3,
            }), 404)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.act_id, self.act.pk)
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/scenes?act_id={self.second_act.pk}'), 404)

    def test_cast_crud_and_cross_project_validation(self):
        response = self.assert_status(self.send('get', f'/scenes/{self.scene.pk}/cast'), 200).json()
        self.assertEqual(response['count'], 1)
        member = self.assert_status(self.send('post', f'/scenes/{self.next_scene.pk}/cast', {
            'character_id': self.character.pk, 'presence_type': 'voice_over', 'notes': 'Phone call',
        }), 201).json()
        pk = member['id']
        self.assert_status(self.send('get', f'/cast/{pk}'), 200)
        self.assert_status(self.send('patch', f'/cast/{pk}', {'notes': 'Off screen'}), 200)
        self.assert_status(self.send('post', f'/scenes/{self.next_scene.pk}/cast', {'character_id': self.character.pk}), 422)
        for character in [self.second_character, self.foreign_character]:
            self.assert_status(self.send('post', f'/scenes/{self.next_scene.pk}/cast', {'character_id': character.pk}), 404)
        self.assert_status(self.send('delete', f'/cast/{pk}'), 204)

    def test_prompt_history_is_per_scene_and_snapshot_is_immutable(self):
        payload = {'user_prompt': 'Make this scene quieter.'}
        response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/prompts', payload), 201).json()
        prompt = SceneGenerationRequest.objects.get(pk=response['id'])
        self.assertEqual(prompt.context_snapshot['characters'][0]['name'], self.character.name)
        self.assertIn('appearance', prompt.context_snapshot['characters'][0])
        self.assertEqual(prompt.context_snapshot['act']['id'], self.act.pk)
        self.assertEqual(prompt.generation_parameters['temperature'], 0.7)
        self.assertEqual(prompt.model_name, 'Bielik 11B')
        self.assertFalse(GenerationRun.objects.filter(request=prompt).exists())
        self.assertEqual(self.send('get', f'/scenes/{self.scene.pk}/prompts').json()['items'][0]['id'], prompt.pk)
        self.assertEqual(self.send('get', f'/scenes/{self.next_scene.pk}/prompts').json()['count'], 0)
        self.assert_status(self.send('get', f'/prompts/{prompt.pk}'), 200)
        self.assert_status(self.send('get', f'/prompts/{prompt.pk}/run'), 404)
        self.assert_status(self.send('patch', f'/prompts/{prompt.pk}', {'user_prompt': 'Changed'}), 405)
        self.assert_status(self.send('patch', f'/scenes/{self.scene.pk}', {'title': 'Later title'}), 200)
        prompt.refresh_from_db()
        self.assertEqual(prompt.context_snapshot['scene']['title'], 'Opening')

    def test_prompt_parameters_are_validated_and_context_cannot_be_spoofed(self):
        for payload in [
            {'user_prompt': ''},
            {'user_prompt': 'Text', 'model_name': 'Not Bielik'},
            {'user_prompt': 'Text', 'context_snapshot': {'scene_id': self.foreign_scene.pk}},
            {'user_prompt': 'Text', 'system_prompt': 'Injected system prompt'},
            {'user_prompt': 'Text', 'generation_parameters': {'temperature': 2}},
        ]:
            self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/prompts', payload), 422)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/prompts', {
            'user_prompt': 'Text', 'generation_parameters': {'temperature': 0.3, 'max_tokens': 512},
        }), 201)

    def test_runs_agents_and_variants_are_read_only_and_related(self):
        for path in [f'/scenes/{self.scene.pk}/runs', f'/runs/{self.generation_run.pk}',
                     f'/prompts/{self.prompt.pk}/run', f'/runs/{self.generation_run.pk}/agents',
                     f'/agent-executions/{self.execution.pk}', f'/runs/{self.generation_run.pk}/variants',
                     f'/scenes/{self.scene.pk}/variants', f'/variants/{self.variant.pk}']:
            with self.subTest(path=path):
                self.assert_status(self.send('get', path), 200)
        response = self.send('get', f'/runs/{self.generation_run.pk}').json()
        self.assertEqual(len(response['agent_executions']), 1)
        self.assertEqual(len(response['variants']), 2)
        self.assertEqual(Decimal(response['variants'][0]['critic_score']), Decimal('8.50'))
        self.assert_status(self.send('patch', f'/runs/{self.generation_run.pk}', {'status': 'completed'}), 405)
        self.assert_status(self.send('delete', f'/agent-executions/{self.execution.pk}'), 405)
        self.assert_status(self.send('patch', f'/variants/{self.variant.pk}', {'critic_score': 100}), 405)

    def test_variant_selection_is_unique_across_scene_runs_and_applies_text_explicitly(self):
        later_prompt = SceneGenerationRequest.objects.create(scene=self.scene, user_prompt='Later')
        later_run = GenerationRun.objects.create(request=later_prompt)
        later_variant = SceneVariant.objects.create(run=later_run, scene=self.scene, variant_number=1,
                                                     generated_full_text='Later', is_selected=True)
        self.assert_status(self.send('post', f'/variants/{self.variant.pk}/select', {}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, '')
        later_variant.refresh_from_db()
        self.assertFalse(later_variant.is_selected)
        self.scene.editor_metadata = {'blocks': [{'text': 'Stale'}], 'zoom': 120}
        self.scene.save()
        self.assert_status(self.send('post', f'/variants/{self.next_variant.pk}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, self.next_variant.generated_full_text)
        self.assertNotIn('blocks', self.scene.editor_metadata)
        self.assertEqual(self.scene.editor_metadata['zoom'], 120)
        self.assertEqual(SceneVariant.objects.filter(scene=self.scene, is_selected=True).count(), 1)

    def test_statistics_are_scoped_to_the_current_user(self):
        stats = self.assert_status(self.send('get', '/users/me/statistics'), 200).json()
        self.assertEqual(stats['projects'], 2)
        self.assertEqual(stats['scenes'], 2)
        self.assertEqual(stats['generation_requests'], 1)
        self.assertEqual(stats['completed_runs'], 1)
        self.assertEqual(stats['variants'], 2)
        self.assertEqual(stats['total_generation_duration_ms'], 125)
        self.assertEqual(stats['prompt_activity'][0]['count'], 1)

    def test_foreign_resources_return_404_for_every_read_path(self):
        paths = [
            f'/projects/{self.foreign_project.pk}', f'/projects/{self.foreign_project.pk}/workspace',
            f'/projects/{self.foreign_project.pk}/acts', f'/projects/{self.foreign_project.pk}/characters',
            f'/projects/{self.foreign_project.pk}/scenes', f'/acts/{self.foreign_act.pk}',
            f'/characters/{self.foreign_character.pk}', f'/scenes/{self.foreign_scene.pk}',
            f'/scenes/{self.foreign_scene.pk}/cast', f'/cast/{self.foreign_member.pk}',
            f'/scenes/{self.foreign_scene.pk}/prompts', f'/prompts/{self.foreign_prompt.pk}',
            f'/prompts/{self.foreign_prompt.pk}/run', f'/scenes/{self.foreign_scene.pk}/runs',
            f'/runs/{self.foreign_run.pk}', f'/runs/{self.foreign_run.pk}/agents',
            f'/agent-executions/{self.foreign_execution.pk}', f'/runs/{self.foreign_run.pk}/variants',
            f'/scenes/{self.foreign_scene.pk}/variants', f'/variants/{self.foreign_variant.pk}',
        ]
        for path in paths:
            with self.subTest(path=path):
                self.assert_status(self.send('get', path), 404)

    def test_foreign_resources_cannot_be_changed_or_deleted(self):
        paths = [f'/projects/{self.foreign_project.pk}', f'/acts/{self.foreign_act.pk}',
                 f'/characters/{self.foreign_character.pk}', f'/scenes/{self.foreign_scene.pk}',
                 f'/cast/{self.foreign_member.pk}']
        for path in paths:
            for method in ['patch', 'delete']:
                with self.subTest(path=path, method=method):
                    self.assert_status(self.send(method, path, {}), 404)
        self.assert_status(self.send('post', f'/variants/{self.foreign_variant.pk}/select', {}), 404)
        self.assert_status(self.send('post', f'/projects/{self.foreign_project.pk}/actions/trash'), 404)

    def test_foreign_parent_creation_endpoints_are_protected(self):
        for path, payload in [
            (f'/projects/{self.foreign_project.pk}/acts', {'act_number': 2}),
            (f'/projects/{self.foreign_project.pk}/characters', {'name': 'No'}),
            (f'/projects/{self.foreign_project.pk}/scenes', {'act_id': self.foreign_act.pk, 'scene_number': 2}),
            (f'/scenes/{self.foreign_scene.pk}/cast', {'character_id': self.foreign_character.pk}),
            (f'/scenes/{self.foreign_scene.pk}/prompts', {'user_prompt': 'No'}),
        ]:
            self.assert_status(self.send('post', path, payload), 404)

    def test_invalid_ids_and_json_fail_cleanly(self):
        self.assert_status(self.send('get', '/projects/0'), 422)
        self.assert_status(self.send('get', '/projects/not-an-id'), 422)
        self.assert_status(self.send('get', '/projects/999999'), 404)
        self.assert_status(self.send('post', '/projects', {'title': 'Invalid JSON', 'metadata': {'value': float('nan')}}), 422)
        self.assert_status(self.send('post', '/projects', {'title': ''}), 422)
        self.assert_status(self.send('patch', f'/projects/{self.project.pk}', {'metadata': []}), 422)

    def test_project_deletion_cascades_only_its_own_data(self):
        self.assert_status(self.send('delete', f'/projects/{self.project.pk}'), 204)
        for model, pk in [(Act, self.act.pk), (Scene, self.scene.pk), (Character, self.character.pk),
                          (SceneCharacter, self.member.pk), (SceneGenerationRequest, self.prompt.pk),
                          (GenerationRun, self.generation_run.pk), (AgentExecution, self.execution.pk),
                          (SceneVariant, self.variant.pk)]:
            self.assertFalse(model.objects.filter(pk=pk).exists())
        self.assertTrue(Project.objects.filter(pk=self.foreign_project.pk).exists())
        self.assertTrue(Scene.objects.filter(pk=self.foreign_scene.pk).exists())
