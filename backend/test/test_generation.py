from decimal import Decimal

from backend.api.models import GenerationRun, SceneGenerationRequest, SceneVariant

from ._api_base import ApiTestCase


class GenerationTests(ApiTestCase):

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

