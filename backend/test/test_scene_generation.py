from unittest.mock import patch

from django.test import Client

from backend.api.models import AgentExecution, GenerationRun, Scene, SceneGenerationRequest, SceneVariant
from backend.ollama import OLLAMA_MODEL, OllamaError

from ._api_base import ApiTestCase


class SceneGenerationTests(ApiTestCase):
    @patch('backend.ollama.generate', return_value='ANNA\n\nZnalazłam list.')
    def test_current_database_scene_and_user_instruction_produce_a_persisted_variant(self, generate_text):
        self.scene.content_text = 'Aktualna treść zapisana w bazie.'
        self.scene.location_heading = 'WN. POCIĄG'
        self.scene.time_of_day = 'NOC'
        self.scene.save()
        before = (SceneGenerationRequest.objects.count(), GenerationRun.objects.count(),
                  SceneVariant.objects.count(), AgentExecution.objects.count())
        response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Dodaj krótki dialog o liście.',
        }), 201)
        generated = response.json()
        self.assertEqual(generated['scene_id'], self.scene.pk)
        self.assertEqual(generated['generated_full_text'], 'ANNA\n\nZnalazłam list.')
        self.assertIsNone(generated['critic_score'])
        self.assertEqual(response['Cache-Control'], 'no-store')
        text = generate_text.call_args.args[0]
        for expected in ('Aktualna treść zapisana w bazie.', 'WN. POCIĄG', 'NOC', 'Dodaj krótki dialog o liście.'):
            self.assertIn(expected, text)
        generate_text.assert_called_once()
        self.assertEqual(generate_text.call_args.kwargs, {'temperature': 0.7, 'max_tokens': 2048})
        variant = SceneVariant.objects.select_related('run__request').get(pk=generated['id'])
        self.assertEqual(variant.run.status, 'completed')
        self.assertIsNotNone(variant.run.finished_at)
        self.assertIsNotNone(variant.run.total_duration_ms)
        self.assertEqual(variant.run.langgraph_thread_id, '')
        self.assertEqual(variant.run.request.model_name, OLLAMA_MODEL)
        self.assertEqual(variant.run.request.context_snapshot['scene']['content_text'], self.scene.content_text)
        self.assertEqual(variant.run.request.user_prompt, 'Dodaj krótki dialog o liście.')
        self.assertEqual((SceneGenerationRequest.objects.count(), GenerationRun.objects.count(), SceneVariant.objects.count(),
                          AgentExecution.objects.count()), (before[0] + 1, before[1] + 1, before[2] + 1, before[3]))
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, 'Aktualna treść zapisana w bazie.')
        stored = self.assert_status(self.send('get', f'/variants/{variant.pk}'), 200).json()
        self.assertEqual(stored['generated_full_text'], generated['generated_full_text'])

    @patch('backend.ollama.generate', return_value='Nowa scena.')
    def test_uses_saved_preferences_and_allows_valid_parameter_overrides(self, generate_text):
        self.assert_status(self.send('put', '/users/me/preferences', {
            'llm_preferences': {'temperature': 0.3, 'max_tokens': 512},
        }), 200)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Zmień scenę.'}), 201)
        self.assertEqual(generate_text.call_args.kwargs, {'temperature': 0.3, 'max_tokens': 512})
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Skróć scenę.', 'generation_parameters': {'temperature': 0.2, 'max_tokens': 128},
        }), 201)
        self.assertEqual(generate_text.call_args.kwargs, {'temperature': 0.2, 'max_tokens': 128})

    @patch('backend.ollama.generate')
    def test_requires_session_csrf_and_scene_ownership_before_contacting_ollama(self, generate_text):
        anonymous = Client(enforce_csrf_checks=True)
        endpoint = f'/scenes/{self.scene.pk}/generate'
        self.assert_status(self.send('post', endpoint, {'user_prompt': 'Test'}, client=anonymous), 401)
        self.assert_status(self.send('post', endpoint, {'user_prompt': 'Test'}, csrf=False), 403)
        self.assert_status(self.send('post', f'/scenes/{self.foreign_scene.pk}/generate', {'user_prompt': 'Test'}), 404)
        generate_text.assert_not_called()

    @patch('backend.ollama.generate')
    def test_rejects_blank_prompts_and_browser_supplied_scene_or_model(self, generate_text):
        before = SceneGenerationRequest.objects.count()
        for payload in ({'user_prompt': ''}, {'user_prompt': '   '}, {'user_prompt': 'Test', 'content_text': 'Forged'},
                        {'user_prompt': 'Test', 'model_name': 'Other model'},
                        {'user_prompt': 'Test', 'generation_parameters': {'max_tokens': 0}}):
            with self.subTest(payload=payload):
                self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', payload), 422)
        self.assertEqual(SceneGenerationRequest.objects.count(), before)
        generate_text.assert_not_called()

    @patch('backend.ollama.generate')
    def test_failed_generations_keep_history_and_failed_run_without_creating_variants(self, generate_text):
        before = SceneVariant.objects.count()
        for status in (502, 503, 504):
            with self.subTest(status=status):
                generate_text.side_effect = OllamaError('Ollama unavailable', status_code=status)
                response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
                    'user_prompt': f'Test failure {status}',
                }), status)
                self.assertEqual(response.json(), {'detail': 'Ollama unavailable'})
                run = GenerationRun.objects.get(request__user_prompt=f'Test failure {status}')
                self.assertEqual(run.status, 'failed')
                self.assertEqual(run.error_message, 'Ollama unavailable')
                self.assertIsNotNone(run.finished_at)
                self.assertEqual(run.variants.count(), 0)
        self.assertEqual(SceneVariant.objects.count(), before)

    @patch('backend.ollama.generate', return_value='Nowa scena od zera.')
    def test_can_generate_for_an_empty_scene(self, generate_text):
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Napisz scenę spotkania.'}), 201)
        self.assertIn('(Scena nie zawiera jeszcze tekstu.)', generate_text.call_args.args[0])

    @patch('backend.ollama.generate')
    def test_deleted_scene_does_not_reappear_after_a_late_llm_response(self, generate_text):
        scene_id = self.scene.pk

        def delete_during_generation(*args, **kwargs):
            Scene.objects.filter(pk=scene_id).delete()
            return 'Late response'

        generate_text.side_effect = delete_during_generation
        self.assert_status(self.send('post', f'/scenes/{scene_id}/generate', {'user_prompt': 'Test'}), 404)
        self.assertFalse(Scene.objects.filter(pk=scene_id).exists())
        self.assertFalse(SceneVariant.objects.filter(scene_id=scene_id).exists())
