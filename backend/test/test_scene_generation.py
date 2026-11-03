import json
from unittest.mock import patch

from django.test import Client

from backend.api.models import AgentExecution, GenerationRun, Scene, SceneGenerationRequest, SceneVariant
from backend.ollama import OLLAMA_MODEL, OllamaError
from backend.api.scheams import GeneratedScene

from ._api_base import ApiTestCase

GENERATED_SCENE = json.dumps({'blocks': [
    {'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None, 'spoken_text': 'Znalazłam list.'},
]}, ensure_ascii=False)


def generation_answer(*args, **kwargs):
    answer = json.loads(GENERATED_SCENE)
    if 'heading' in kwargs['output_schema']['properties']:
        answer['heading'] = {'location_type': 'WN.', 'location_heading': 'DOM', 'time_of_day': 'RANO'}
    return json.dumps(answer, ensure_ascii=False)


class SceneGenerationTests(ApiTestCase):
    @patch('backend.ollama.generate')
    def test_overlong_action_is_retried_before_saving_the_batch(self, generate):
        self.scene.location_heading = 'WN. DOM'
        self.scene.save()
        wall = json.dumps({'blocks': [{'type': 'action', 'text': 'Anna wraca do domu. ' * 40}]})
        generate.side_effect = [GENERATED_SCENE, wall, GENERATED_SCENE]
        variants = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Anna spotyka sąsiada.', 'variant_count': 2,
        }), 201).json()
        self.assertEqual(len(variants), 2)
        self.assertEqual(generate.call_count, 3)
        self.assertIn('POPRAW FORMAT', generate.call_args.args[0])
        self.assertEqual(len({call.kwargs['temperature'] for call in generate.call_args_list}), 1)
        self.assertEqual(GenerationRun.objects.get(pk=variants[0]['run_id']).variants.count(), 2)

    @patch('backend.ollama.generate', side_effect=generation_answer)
    def test_requested_batch_sizes_use_the_same_snapshot_and_saved_temperature(self, generate):
        self.assert_status(self.send('put', '/users/me/preferences', {
            'llm_preferences': {'temperature': 0.4, 'max_tokens': 512},
        }), 200)
        for count in (1, 2, 3):
            with self.subTest(count=count):
                generate.reset_mock()
                variants = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
                    'user_prompt': 'Napisz początek.', 'variant_count': count,
                }), 201).json()
                self.assertEqual([variant['variant_number'] for variant in variants], list(range(1, count + 1)))
                self.assertEqual(generate.call_count, count)
                prompts = [call.args[0].split('PODEJŚCIE WARIANTU:', 1) for call in generate.call_args_list]
                self.assertEqual(len({base for base, _ in prompts}), 1)
                approaches = ['Zrównoważ akcję i dialog', 'Połóż nacisk na relację', 'Połóż nacisk na obraz']
                for (_, approach), expected in zip(prompts, approaches, strict=False):
                    self.assertIn(expected, approach)
                self.assertTrue(all(call.kwargs['temperature'] == 0.4 for call in generate.call_args_list))
                run = GenerationRun.objects.get(pk=variants[0]['run_id'])
                self.assertEqual(list(run.variants.values_list('pk', flat=True)), [variant['id'] for variant in variants])

    @patch('backend.ollama.generate')
    def test_retries_a_cut_or_an_embedded_next_scene_heading(self, generate):
        self.scene.location_heading = 'PL. CMENTARZ'
        self.scene.save()
        for block in (
            {'type': 'transition', 'text': 'CIĘCIE DO:'},
            {'type': 'action', 'text': 'Maciek czyta napis.\nWN. CHATA – NOC\nSiada przy stole.'},
        ):
            with self.subTest(block=block):
                generate.reset_mock()
                generate.side_effect = [json.dumps({'blocks': [block]}), GENERATED_SCENE]
                response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
                    'user_prompt': 'Kontynuuj scenę.', 'variant_count': 1,
                }), 201)
                self.assertEqual(generate.call_count, 2)
                self.assertIn('POPRAW FORMAT', generate.call_args.args[0])
                self.assertEqual([b['type'] for b in response.json()[0]['critic_metadata']['blocks']],
                                 ['character', 'dialogue'])

    @patch('backend.ollama.generate', side_effect=[GENERATED_SCENE, OllamaError('Model unavailable', status_code=503)])
    def test_second_call_failure_leaves_no_partial_variants(self, generate):
        self.scene.location_heading = 'WN. DOM'
        self.scene.save()
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Przetestuj serię.', 'variant_count': 3,
        }), 503)
        self.assertEqual(generate.call_count, 2)
        run = GenerationRun.objects.get(request__user_prompt='Przetestuj serię.')
        self.assertEqual(run.status, 'failed')
        self.assertFalse(run.variants.exists())

    @patch('backend.ollama.generate', side_effect=generation_answer)
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
        options = generate_text.call_args.kwargs
        self.assertEqual(options['temperature'], 0.7)
        self.assertEqual(options['max_tokens'], 2048)
        self.assertEqual(options['output_schema'], GeneratedScene.model_json_schema())
        self.assertTrue(callable(options['is_cancelled']))
        variant = SceneVariant.objects.select_related('run__request').get(pk=generated['id'])
        self.assertEqual(variant.run.status, 'completed')
        self.assertIsNotNone(variant.run.finished_at)
        self.assertIsNotNone(variant.run.total_duration_ms)
        self.assertEqual(variant.run.langgraph_thread_id, '')
        self.assertEqual(variant.run.request.model_name, OLLAMA_MODEL)
        self.assertEqual(variant.run.request.context_snapshot['scene']['content_text'], self.scene.content_text)
        self.assertEqual(variant.run.request.user_prompt, 'Dodaj krótki dialog o liście.')
        self.assertEqual(variant.critic_metadata['format'], 'screenplay_blocks_v1')
        self.assertEqual([block['type'] for block in variant.critic_metadata['blocks']], ['character', 'dialogue'])
        self.assertEqual(variant.variant_number, 1)
        self.assertEqual((SceneGenerationRequest.objects.count(), GenerationRun.objects.count(), SceneVariant.objects.count(),
                          AgentExecution.objects.count()), (before[0] + 1, before[1] + 1, before[2] + 1, before[3]))
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, 'Aktualna treść zapisana w bazie.')
        stored = self.assert_status(self.send('get', f'/variants/{variant.pk}'), 200).json()
        self.assertEqual(stored['generated_full_text'], generated['generated_full_text'])

    @patch('backend.ollama.generate', side_effect=generation_answer)
    def test_uses_saved_preferences_and_allows_valid_parameter_overrides(self, generate_text):
        self.assert_status(self.send('put', '/users/me/preferences', {
            'llm_preferences': {'temperature': 0.3, 'max_tokens': 512},
        }), 200)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Zmień scenę.'}), 201)
        self.assertEqual(generate_text.call_args.kwargs['temperature'], 0.3)
        self.assertEqual(generate_text.call_args.kwargs['max_tokens'], 512)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Skróć scenę.', 'generation_parameters': {'temperature': 0.2, 'max_tokens': 128},
        }), 201)
        self.assertEqual(generate_text.call_args.kwargs['temperature'], 0.2)
        self.assertEqual(generate_text.call_args.kwargs['max_tokens'], 128)

    @patch('backend.ollama.generate', side_effect=generation_answer)
    def test_saved_scene_goal_notes_cast_and_style_are_sent_to_the_model(self, generate_text):
        self.assert_status(self.send('patch', f'/scenes/{self.scene.pk}', {
            'ai_metadata': {'scene_goal': 'Anna rozpoznaje pismo ojca.', 'notes': 'List pozostaje nieotwarty.'},
        }), 200)
        self.assert_status(self.send('put', '/users/me/preferences', {
            'writing_style_preferences': {'stage_directions_style': 'concise_technical',
                                          'dialogue_tone': 'Nerwowy', 'parentheticals': 'ignore'},
        }), 200)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Kontynuuj.'}), 201)
        text = generate_text.call_args.args[0]
        for expected in ('Anna rozpoznaje pismo ojca.', 'List pozostaje nieotwarty.', 'ANNA',
                         'Ton dialogów: Nerwowy', 'parenthetical zawsze null', 'CEL SCENY'):
            self.assertIn(expected, text)
        run = GenerationRun.objects.get(request__user_prompt='Kontynuuj.')
        self.assertEqual(run.request.context_snapshot['scene']['ai_metadata']['scene_goal'], 'Anna rozpoznaje pismo ojca.')
        self.assertNotIn('scene_goal', SceneVariant.objects.get(run=run).generated_full_text)

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
                        {'user_prompt': 'Test', 'generation_parameters': {'max_tokens': 0}},
                        {'user_prompt': 'Test', 'variant_count': 0}, {'user_prompt': 'Test', 'variant_count': 4},
                        {'user_prompt': 'Test', 'variant_count': 1.5}, {'user_prompt': 'Test', 'variant_count': True}):
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

    @patch('backend.ollama.generate', side_effect=generation_answer)
    def test_can_generate_for_an_empty_scene(self, generate_text):
        response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Napisz scenę spotkania.'}), 201)
        self.assertEqual(response.json()['critic_metadata']['heading'], {'location_heading': 'WN. DOM', 'time_of_day': 'RANO'})
        self.assertIn('(Scena nie zawiera jeszcze tekstu.)', generate_text.call_args.args[0])

    @patch('backend.ollama.generate')
    def test_deleted_scene_does_not_reappear_after_a_late_llm_response(self, generate_text):
        scene_id = self.scene.pk

        def delete_during_generation(*args, **kwargs):
            Scene.objects.filter(pk=scene_id).delete()
            return GENERATED_SCENE

        generate_text.side_effect = delete_during_generation
        self.assert_status(self.send('post', f'/scenes/{scene_id}/generate', {'user_prompt': 'Test'}), 404)
        self.assertFalse(Scene.objects.filter(pk=scene_id).exists())
        self.assertFalse(SceneVariant.objects.filter(scene_id=scene_id).exists())

    @patch('backend.ollama.generate', return_value='ANNA\nZły format bez JSON')
    def test_invalid_model_format_fails_without_creating_a_variant(self, generate_text):
        before = SceneVariant.objects.count()
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Test invalid format'}), 502)
        self.assertEqual(SceneVariant.objects.count(), before)
        run = GenerationRun.objects.get(request__user_prompt='Test invalid format')
        self.assertEqual(run.status, 'failed')
        self.assertIn('format', run.error_message)
        generate_text.assert_called_once()
