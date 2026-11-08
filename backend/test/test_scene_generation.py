import json
from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4

from django.test import Client

from backend.agents.archivist import ArchivistAgent
from backend.agents.critic import SceneReview
from backend.api.models import AgentExecution, GenerationRun, Scene, SceneGenerationRequest, SceneVariant
from backend.ollama import OLLAMA_MODEL, OllamaError, OllamaOutputLimit

from ._api_base import ApiTestCase
from ._graph_transport import patch_writer

GENERATED_SCENE = json.dumps({'blocks': [
    {'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None, 'spoken_text': 'Znalazłam list.'},
]}, ensure_ascii=False)


def generation_answer(*args, **kwargs):
    answer = json.loads(GENERATED_SCENE)
    if 'heading' in kwargs['output_schema']['properties']:
        answer['heading'] = {'location_type': 'WN.', 'location_heading': 'DOM', 'time_of_day': 'RANO'}
    return json.dumps(answer, ensure_ascii=False)


class SceneGenerationTests(ApiTestCase):
    @patch_writer(archive_response={
        'characters': [], 'previous_scenes': [{'scene_number': 999, 'summary': 'Wymyślona scena.'}],
        'continuity_facts': ['Wymyślony fakt.'], 'open_threads': [],
    }, side_effect=generation_answer)
    def test_invalid_archivist_history_uses_source_profiles_and_finishes_the_whole_api_flow(self, generate):
        self.character.fears = 'Ogień'
        self.character.save()
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Anna znajduje list.',
        }), 201).json()
        sent = json.loads(generate.call_args.args[0])['context']
        self.assertEqual(sent['characters'][0]['name'], 'ANNA')
        self.assertIn('Ogień', sent['characters'][0]['profile'])
        self.assertEqual(sent['previous_scenes'], [])
        self.assertEqual(sent['continuity_facts'], [])
        run = GenerationRun.objects.get(pk=result['run_id'])
        self.assertEqual(run.status, 'completed')
        self.assertEqual(run.agent_executions.get(node_name='archivist').logs['model_calls'][0]['max_tokens'], 1024)
        self.assertEqual(list(run.agent_executions.values_list('status', flat=True)), ['completed'] * 4)
        self.assertIsNone(self.send('get', '/generation/active').json())

    @patch_writer(side_effect=[OllamaOutputLimit('{"blocks":[{"type":"action","text":"Anna'), GENERATED_SCENE])
    def test_cut_scene_is_retried_then_only_the_complete_result_enters_variants_and_history(self, generate):
        self.scene.location_heading = 'WN. DOM'
        self.scene.save()
        before = self.send('get', f'/scenes/{self.scene.pk}/prompts').json()['count']
        response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Anna znajduje list.',
        }), 201).json()

        self.assertEqual(generate.call_count, 2)
        self.assertEqual(response['generated_full_text'], 'ANNA\n\nZnalazłam list.')
        run = GenerationRun.objects.get(pk=response['run_id'])
        self.assertEqual(run.status, 'completed')
        self.assertEqual(run.variants.count(), 1)
        self.assertEqual(run.agent_executions.count(), 4)
        self.assertEqual([call['attempt'] for call in run.agent_executions.get(node_name='scenarist').logs['model_calls']], [1, 2])
        self.assertEqual(self.send('get', f'/scenes/{self.scene.pk}/prompts').json()['count'], before + 1)
        self.assertIsNone(self.send('get', '/generation/active').json())
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, '')

    @patch_writer(side_effect=OllamaOutputLimit('{"blocks":[{"type":"action","text":"Anna'))
    def test_exhausted_output_recovery_never_saves_partial_text_or_adds_prompt_history(self, generate):
        before = self.send('get', f'/scenes/{self.scene.pk}/prompts').json()['count']
        response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Próba niedokończonej sceny.',
        }), 502)
        self.assertEqual(generate.call_count, 2)
        self.assertIn('dokończyć odpowiedzi', response.json()['detail'])
        run = GenerationRun.objects.get(request__user_prompt='Próba niedokończonej sceny.')
        self.assertEqual(run.status, 'failed')
        self.assertFalse(run.variants.exists())
        self.assertEqual(self.send('get', f'/scenes/{self.scene.pk}/prompts').json()['count'], before)
        self.assertIsNone(self.send('get', '/generation/active').json())


    @patch_writer(side_effect=generation_answer)
    def test_continuation_does_not_send_editor_state_or_duplicate_the_scene(self, generate):
        blocks = [{'id': str(uuid4()), 'type': 'action', 'text': f'Anna przegląda dokument numer {number}.'}
                  for number in range(21)]
        text = '\n\n'.join(block['text'] for block in blocks)
        metadata = {'blocks': blocks, 'status': 'draft', 'applied_variant': {
            'run_id': self.generation_run.pk, 'block_ids': [str(uuid4()) for _ in range(100)],
        }}
        self.scene.content_text = text
        self.scene.editor_metadata = metadata
        self.scene.ai_metadata = {'scene_goal': 'Odnaleźć list ojca.', 'notes': 'Nie otwieraj listu.'}
        self.scene.location_heading = 'WN. DOM'
        self.scene.save()
        original = deepcopy(metadata)

        variant = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Kontynuuj, zbliżając się do celu sceny.',
        }), 201).json()
        sent = json.loads(generate.call_args.args[0])['context']
        self.assertEqual(sent['scene']['content_text'], text)
        self.assertEqual(sent['scene']['ai_metadata'], self.scene.ai_metadata)
        self.assertNotIn('editor_metadata', sent['scene'])
        self.assertNotIn('llm_preferences', sent)
        generate.assert_called_once()

        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, text)
        self.assertEqual(self.scene.editor_metadata, original)
        run = GenerationRun.objects.select_related('request').get(pk=variant['run_id'])
        self.assertEqual(run.request.context_snapshot['scene']['editor_metadata'], original)
        self.assertEqual(list(run.agent_executions.values_list('status', flat=True)), ['completed'] * 4)


    @patch_writer(side_effect=generation_answer)
    def test_output_preference_is_forwarded_without_local_token_budget_rejection(self, generate):
        response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Anna znajduje klucz.', 'generation_parameters': {'max_tokens': 8192},
        }), 201)
        self.assertIn('generated_full_text', response.json())
        generate.assert_called_once()
        options = generate.call_args.kwargs
        self.assertEqual(options['num_ctx'], 4096)
        self.assertEqual(options['max_tokens'], 8192)
        run = GenerationRun.objects.get(request__user_prompt='Anna znajduje klucz.')
        self.assertEqual(run.status, 'completed')
        self.assertEqual(run.request.generation_parameters['max_tokens'], 8192)
        writer = run.agent_executions.get(node_name='scenarist')
        self.assertEqual(writer.logs['model_calls'][0]['requested_max_tokens'], 8192)
        self.assertNotIn('input_tokens', writer.logs['model_calls'][0])

    @patch_writer()
    def test_unintelligible_prompt_does_not_save_variants_or_enter_history(self, generate):
        path = f'/scenes/{self.scene.pk}/generate'
        count = SceneVariant.objects.count()
        self.assertIn('Nie rozumiem', self.assert_status(self.send('post', path, {'user_prompt': '?!...'}), 422).json()['detail'])
        self.assertIn('Nie rozumiem', self.assert_status(self.send('post', path, {'user_prompt': 'adada'}), 422).json()['detail'])
        self.assertIn('Nie rozumiem', self.assert_status(self.send('post', path, {'user_prompt': 'wq gwg'}), 422).json()['detail'])
        response = self.send('post', path, {'user_prompt': 'asdfgh qwerty', 'variant_count': 3})
        self.assertIn('Nie rozumiem', self.assert_status(response, 422).json()['detail'])
        generate.assert_not_called()
        self.assertEqual(SceneVariant.objects.count(), count)
        self.assertEqual(self.send('get', f'/scenes/{self.scene.pk}/prompts').json()['count'], 1)
        self.assertIsNone(self.assert_status(self.send('get', '/generation/active'), 200).json())

    @patch_writer()
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
        self.assertIn('POPRAW FORMAT', generate.call_args.kwargs['messages'][0]['content'])
        self.assertEqual(len({call.kwargs['temperature'] for call in generate.call_args_list}), 1)
        self.assertEqual(GenerationRun.objects.get(pk=variants[0]['run_id']).variants.count(), 2)

    @patch_writer(side_effect=generation_answer)
    @patch('backend.agents.graph.ArchivistAgent.prepare_context', autospec=True,
           side_effect=ArchivistAgent.prepare_context)
    def test_requested_batch_sizes_share_one_fresh_archive_and_saved_temperature(self, generate, prepare_context):
        self.assert_status(self.send('put', '/users/me/preferences', {
            'llm_preferences': {'temperature': 0.4},
        }), 200)
        for count in (1, 2, 3):
            with self.subTest(count=count):
                generate.reset_mock()
                prepare_context.reset_mock()
                self.scene.ai_metadata = {'scene_goal': f'Cel dla {count} wariantów.'}
                self.scene.save(update_fields=['ai_metadata'])
                variants = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
                    'user_prompt': 'Napisz początek.', 'variant_count': count,
                }), 201).json()
                self.assertEqual([variant['variant_number'] for variant in variants], list(range(1, count + 1)))
                self.assertEqual(generate.call_count, count)
                contexts = [json.loads(call.args[0])['context'] for call in generate.call_args_list]
                approaches = ['Zrównoważ akcję i dialog', 'Połóż nacisk na relację', 'Połóż nacisk na obraz']
                for context, expected in zip(contexts, approaches, strict=False):
                    self.assertIn(expected, context.pop('variant_approach'))
                self.assertTrue(all(context == contexts[0] for context in contexts))
                self.assertTrue(all(call.kwargs['temperature'] == 0.4 for call in generate.call_args_list))
                run = GenerationRun.objects.get(pk=variants[0]['run_id'])
                self.assertEqual(list(run.variants.values_list('pk', flat=True)), [variant['id'] for variant in variants])
                prepare_context.assert_called_once()
                self.assertEqual(prepare_context.call_args.kwargs['user_prompt'], 'Napisz początek.')
                self.assertEqual(prepare_context.call_args.kwargs['context'], run.request.context_snapshot)
                self.assertEqual(prepare_context.call_args.kwargs['context']['scene']['ai_metadata'],
                                 self.scene.ai_metadata)
                self.assertEqual(list(run.agent_executions.values_list('node_name', 'status')), [
                    ('archivist', 'completed'),
                    *[entry for _ in range(count) for entry in (
                        ('director', 'completed'), ('scenarist', 'completed'), ('critic', 'completed'),
                    )],
                ])
                self.assertEqual(list(run.agent_executions.exclude(node_name='archivist')
                                      .values_list('input_payload', flat=True)),
                                 [{'variant_number': number} for number in range(1, count + 1) for _ in range(3)])

    @patch_writer()
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
                self.assertIn('POPRAW FORMAT', generate.call_args.kwargs['messages'][0]['content'])
                self.assertEqual([b['type'] for b in response.json()[0]['critic_metadata']['blocks']],
                                 ['character', 'dialogue'])

    @patch_writer(side_effect=[GENERATED_SCENE, OllamaError('Model unavailable', status_code=503)])
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

    @patch_writer(side_effect=generation_answer)
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
        self.assertEqual(generated['critic_score'], '8')
        self.assertEqual(generated['critic_feedback'], 'Scena jest spójna.')
        self.assertEqual(response['Cache-Control'], 'no-store')
        text = generate_text.call_args.args[0]
        for expected in ('Aktualna treść zapisana w bazie.', 'WN. POCIĄG', 'NOC', 'Dodaj krótki dialog o liście.'):
            self.assertIn(expected, text)
        generate_text.assert_called_once()
        options = generate_text.call_args.kwargs
        self.assertEqual(options['temperature'], 0.7)
        self.assertEqual(options['max_tokens'], 2048)
        self.assertNotIn('heading', options['output_schema']['properties'])
        self.assertEqual(options['output_schema']['$defs']['CastGeneratedSpeech']['properties']['speaker']['const'], 'ANNA')
        self.assertTrue(callable(options['is_cancelled']))
        variant = SceneVariant.objects.select_related('run__request').get(pk=generated['id'])
        self.assertEqual(variant.run.status, 'completed')
        self.assertIsNotNone(variant.run.finished_at)
        self.assertIsNotNone(variant.run.total_duration_ms)
        self.assertEqual(variant.run.run_metadata['engine'], 'langgraph')
        self.assertEqual(list(variant.run.agent_executions.values_list('node_name', 'status')), [
            ('archivist', 'completed'), ('director', 'completed'), ('scenarist', 'completed'), ('critic', 'completed'),
        ])
        self.assertEqual(variant.run.request.model_name, OLLAMA_MODEL)
        self.assertEqual(variant.run.request.context_snapshot['scene']['content_text'], self.scene.content_text)
        self.assertEqual(variant.run.request.user_prompt, 'Dodaj krótki dialog o liście.')
        self.assertEqual(variant.critic_metadata['format'], 'screenplay_blocks_v1')
        self.assertEqual([block['type'] for block in variant.critic_metadata['blocks']], ['character', 'dialogue'])
        self.assertEqual(variant.variant_number, 1)
        self.assertEqual((SceneGenerationRequest.objects.count(), GenerationRun.objects.count(), SceneVariant.objects.count(),
                          AgentExecution.objects.count()), (before[0] + 1, before[1] + 1, before[2] + 1, before[3] + 4))
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, 'Aktualna treść zapisana w bazie.')
        stored = self.assert_status(self.send('get', f'/variants/{variant.pk}'), 200).json()
        self.assertEqual(stored['generated_full_text'], generated['generated_full_text'])

    @patch_writer(side_effect=generation_answer)
    def test_uses_saved_preferences_and_allows_valid_parameter_overrides(self, generate_text):
        self.assert_status(self.send('put', '/users/me/preferences', {
            'llm_preferences': {'temperature': 0.3},
        }), 200)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Zmień scenę.'}), 201)
        self.assertEqual(generate_text.call_args.kwargs['temperature'], 0.3)
        self.assertEqual(generate_text.call_args.kwargs['max_tokens'], 2048)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Skróć scenę.', 'generation_parameters': {'temperature': 0.2, 'max_tokens': 128},
        }), 201)
        self.assertEqual(generate_text.call_args.kwargs['temperature'], 0.2)
        self.assertEqual(generate_text.call_args.kwargs['max_tokens'], 128)

    @patch_writer(side_effect=generation_answer)
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
                         'Nerwowy', 'ignore', 'scene_goal'):
            self.assertIn(expected, text)
        run = GenerationRun.objects.get(request__user_prompt='Kontynuuj.')
        self.assertEqual(run.request.context_snapshot['scene']['ai_metadata']['scene_goal'], 'Anna rozpoznaje pismo ojca.')
        self.assertNotIn('scene_goal', SceneVariant.objects.get(run=run).generated_full_text)

    @patch_writer()
    def test_requires_session_csrf_and_scene_ownership_before_contacting_ollama(self, generate_text):
        anonymous = Client(enforce_csrf_checks=True)
        endpoint = f'/scenes/{self.scene.pk}/generate'
        self.assert_status(self.send('post', endpoint, {'user_prompt': 'Test'}, client=anonymous), 401)
        self.assert_status(self.send('post', endpoint, {'user_prompt': 'Test'}, csrf=False), 403)
        self.assert_status(self.send('post', f'/scenes/{self.foreign_scene.pk}/generate', {'user_prompt': 'Test'}), 404)
        generate_text.assert_not_called()

    @patch_writer()
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

    @patch_writer()
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

    @patch_writer(side_effect=generation_answer)
    def test_can_generate_for_an_empty_scene(self, generate_text):
        response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'wymyśl coś dalej'}), 201)
        generate_text.assert_called_once()
        self.assertIn('wymyśl coś dalej', generate_text.call_args.args[0])
        self.assertEqual(response.json()['critic_metadata']['heading'], {'location_heading': 'WN. DOM', 'time_of_day': 'RANO'})
        self.assertIn('Scena jest pusta.', generate_text.call_args.kwargs['messages'][0]['content'])

    @patch_writer()
    def test_deleted_scene_does_not_reappear_after_a_late_llm_response(self, generate_text):
        scene_id = self.scene.pk

        def delete_during_generation(*args, **kwargs):
            Scene.objects.filter(pk=scene_id).delete()
            return GENERATED_SCENE

        generate_text.side_effect = delete_during_generation
        self.assert_status(self.send('post', f'/scenes/{scene_id}/generate', {'user_prompt': 'Test'}), 404)
        self.assertFalse(Scene.objects.filter(pk=scene_id).exists())
        self.assertFalse(SceneVariant.objects.filter(scene_id=scene_id).exists())

    @patch_writer(return_value='ANNA\nZły format bez JSON')
    def test_invalid_model_format_fails_without_creating_a_variant(self, generate_text):
        before = SceneVariant.objects.count()
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Test invalid format'}), 502)
        self.assertEqual(SceneVariant.objects.count(), before)
        run = GenerationRun.objects.get(request__user_prompt='Test invalid format')
        self.assertEqual(run.status, 'failed')
        self.assertIn('format', run.error_message)
        generate_text.assert_called_once()
