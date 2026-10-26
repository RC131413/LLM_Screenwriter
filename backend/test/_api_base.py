import json
from decimal import Decimal

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from backend.api.models import (
    Act, AgentExecution, Character, GenerationRun, Project, Scene,
    SceneCharacter, SceneGenerationRequest, SceneVariant, User,
)


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ApiTestCase(TestCase):

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

    def registration_payload(self, **changes):
        return {
            'username': 'new_writer', 'email': 'NEW@example.com',
            'password': self.password, 'password_confirm': self.password, **changes,
        }

