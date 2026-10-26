import json

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from backend.api.models import Project, Scene, SceneGenerationRequest


@override_settings(
    CORS_ALLOWED_ORIGINS=['http://127.0.0.1:5173'],
    CSRF_TRUSTED_ORIGINS=['http://127.0.0.1:5173'],
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
)
class WorkspaceFlowTests(TestCase):
    origin = 'http://127.0.0.1:5173'
    password = 'A-workspace-test-secret-942!'

    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        response = self.request('post', '/auth/register', {
            'username': 'screenwriter', 'email': 'screenwriter@example.com',
            'password': self.password, 'password_confirm': self.password,
        }, status=201)
        self.user_id = response['id']

    def request(self, method, path, data=None, *, status=200):
        headers = {'HTTP_ORIGIN': self.origin}
        if method not in {'get', 'head', 'options'}:
            token = self.client.get('/api/auth/csrf', HTTP_ORIGIN=self.origin).json()['csrf_token']
            headers['HTTP_X_CSRFTOKEN'] = token
        if method == 'get':
            response = self.client.get('/api' + path, **headers)
        else:
            response = getattr(self.client, method)(
                '/api' + path, data=json.dumps(data) if data is not None else None,
                content_type='application/json', **headers,
            )
        self.assertEqual(response.status_code, status, response.content[:1500])
        self.assertEqual(response['Access-Control-Allow-Origin'], self.origin)
        self.assertEqual(response['Access-Control-Allow-Credentials'], 'true')
        return response.json() if status != 204 else None

    def create_workspace(self):
        project = self.request('post', '/projects', {
            'title': 'Night train', 'synopsis': 'A passenger discovers a letter.',
            'target_audience': 'Adults', 'metadata': {'custom': {'preserve': True}},
        }, status=201)
        act = self.request('post', f'/projects/{project["id"]}/acts', {
            'act_number': 1, 'title': 'Departure', 'summary': 'The train leaves.',
        }, status=201)
        scene = self.request('post', f'/projects/{project["id"]}/scenes', {
            'act_id': act['id'], 'scene_number': 1, 'title': 'The letter',
        }, status=201)
        character = self.request('post', f'/projects/{project["id"]}/characters', {
            'name': 'ANNA', 'appearance': 'A grey coat.', 'backstory': 'A former teacher.',
        }, status=201)
        self.request('post', f'/scenes/{scene["id"]}/cast', {
            'character_id': character['id'], 'presence_type': 'on_screen', 'notes': 'At the window.',
        }, status=201)
        return project, act, scene, character

    def login_again(self):
        self.request('post', '/auth/logout')
        self.request('get', '/users/me', status=401)
        self.client = Client(enforce_csrf_checks=True)
        self.request('post', '/auth/login', {'identifier': 'screenwriter@example.com', 'password': self.password})

    def test_complete_editor_payload_survives_a_new_login(self):
        project, act, scene, character = self.create_workspace()
        blocks = [
            {'id': 'block-action', 'type': 'action', 'text': 'ANNA opens the letter.'},
            {'id': 'block-character', 'type': 'character', 'text': 'ANNA'},
            {'id': 'block-dialogue', 'type': 'dialogue', 'text': 'Not again.'},
        ]
        self.request('patch', f'/scenes/{scene["id"]}', {
            'content_text': '\n\n'.join(block['text'] for block in blocks),
            'location_heading': 'INT. TRAIN - NIGHT',
            'ai_metadata': {'scene_goal': 'Reveal the letter.', 'notes': 'A pause.'},
            'editor_metadata': {'blocks': blocks, 'status': 'review', 'zoom': 120},
        })
        self.login_again()
        workspace = self.request('get', f'/projects/{project["id"]}/workspace')
        self.assertEqual(workspace['project']['user_id'], self.user_id)
        self.assertEqual(workspace['project']['synopsis'], project['synopsis'])
        self.assertEqual(workspace['acts'][0]['id'], act['id'])
        self.assertEqual(workspace['characters'][0]['id'], character['id'])
        stored = workspace['scenes'][0]
        self.assertEqual(stored['id'], scene['id'])
        self.assertEqual(stored['editor_metadata']['blocks'], blocks)
        self.assertEqual(stored['editor_metadata']['status'], 'review')
        self.assertEqual(stored['ai_metadata']['notes'], 'A pause.')
        self.assertEqual(stored['cast_members'][0]['character_id'], character['id'])
        self.assertEqual(Scene.objects.get(pk=scene['id']).content_text, stored['content_text'])

    def test_preferences_and_cast_are_frozen_in_a_saved_prompt(self):
        project, act, scene, character = self.create_workspace()
        self.request('put', '/users/me/preferences', {
            'writing_style_preferences': {'dialogue_tone': 'Dry and concise'},
            'llm_preferences': {'temperature': 0.3, 'max_tokens': 1024},
        })
        prompt = self.request('post', f'/scenes/{scene["id"]}/prompts', {'user_prompt': 'Continue the scene.'}, status=201)
        self.request('patch', f'/characters/{character["id"]}', {'backstory': 'Changed afterwards.'})
        self.request('patch', f'/acts/{act["id"]}', {'summary': 'Changed afterwards.'})
        self.login_again()
        history = self.request('get', f'/scenes/{scene["id"]}/prompts')
        self.assertEqual(history['count'], 1)
        stored = history['items'][0]
        self.assertEqual(stored['id'], prompt['id'])
        self.assertEqual(stored['context_snapshot']['characters'][0]['backstory'], 'A former teacher.')
        self.assertEqual(stored['context_snapshot']['act']['summary'], 'The train leaves.')
        self.assertEqual(stored['context_snapshot']['project']['id'], project['id'])
        self.assertEqual(stored['generation_parameters'], {'temperature': 0.3, 'max_tokens': 1024})
        self.assertFalse(hasattr(SceneGenerationRequest.objects.get(pk=prompt['id']), 'run'))

    def test_dashboard_actions_preserve_metadata_and_round_trip_through_collections(self):
        project, _, _, _ = self.create_workspace()
        pk = project['id']
        self.request('post', f'/projects/{pk}/actions/open')
        self.request('post', f'/projects/{pk}/actions/favorite')
        self.login_again()
        self.assertEqual(self.request('get', '/projects?collection=favorites')['items'][0]['id'], pk)
        self.assertEqual(self.request('get', '/projects?collection=recent')['count'], 1)
        self.request('post', f'/projects/{pk}/actions/archive')
        self.assertEqual(self.request('get', '/projects')['count'], 0)
        self.assertEqual(self.request('get', '/projects?collection=archive')['count'], 1)
        self.request('post', f'/projects/{pk}/actions/trash')
        self.assertEqual(self.request('get', '/projects?collection=archive')['count'], 0)
        self.assertEqual(self.request('get', '/projects?collection=trash')['count'], 1)
        self.request('post', f'/projects/{pk}/actions/restore')
        self.request('post', f'/projects/{pk}/actions/unarchive')
        self.assertEqual(self.request('get', '/projects')['count'], 1)
        self.assertEqual(Project.objects.get(pk=pk).metadata['custom'], {'preserve': True})

    def test_moving_scene_and_removing_cast_preserves_text_and_history(self):
        project, _, scene, _ = self.create_workspace()
        self.request('patch', f'/scenes/{scene["id"]}', {'content_text': 'The letter falls.'})
        prompt = self.request('post', f'/scenes/{scene["id"]}/prompts', {'user_prompt': 'Keep the tension.'}, status=201)
        other_act = self.request('post', f'/projects/{project["id"]}/acts', {'act_number': 2}, status=201)
        self.request('patch', f'/scenes/{scene["id"]}', {'act_id': other_act['id'], 'sort_order': 4})
        cast = self.request('get', f'/scenes/{scene["id"]}/cast')['items'][0]
        self.request('delete', f'/cast/{cast["id"]}', status=204)
        self.login_again()
        stored = self.request('get', f'/scenes/{scene["id"]}')
        self.assertEqual(stored['act_id'], other_act['id'])
        self.assertEqual(stored['sort_order'], 4)
        self.assertEqual(stored['content_text'], 'The letter falls.')
        self.assertEqual(stored['cast_members'], [])
        self.assertEqual(self.request('get', f'/scenes/{scene["id"]}/prompts')['items'][0]['id'], prompt['id'])

    def test_failed_edit_does_not_replace_persisted_editor_data(self):
        _, _, scene, _ = self.create_workspace()
        before = self.request('patch', f'/scenes/{scene["id"]}', {
            'content_text': 'The original scene.', 'editor_metadata': {'status': 'draft', 'custom': 42},
        })
        self.request('patch', f'/scenes/{scene["id"]}', {'title': None, 'content_text': 'Must not persist.'}, status=422)
        self.login_again()
        stored = self.request('get', f'/scenes/{scene["id"]}')
        self.assertEqual(stored['content_text'], before['content_text'])
        self.assertEqual(stored['editor_metadata'], before['editor_metadata'])
