import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import Client
from django.utils import timezone

from backend.agents.archivist import ArchivedContext
from backend.api.models import GenerationRun, SceneGenerationRequest, SceneVariant
from backend.ollama import OllamaCancelled
from ._api_base import ApiTestCase
from ._graph_transport import patch_writer


ANSWER = json.dumps({'blocks': [{'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None, 'spoken_text': 'Nowa scena.'}],
                     'heading': {'location_type': 'WN.', 'location_heading': 'DOM', 'time_of_day': 'RANO'}})


class GenerationCancellationTests(ApiTestCase):
    @patch_writer(return_value=ANSWER)
    def test_cancellation_after_shared_archive_stops_all_variants(self, generate):
        payload = self.payload()
        before = SceneVariant.objects.count()

        def cancel_after_archive(**kwargs):
            self.assert_status(self.cancel(payload), 200)
            return ArchivedContext(characters=[], previous_scenes=[], continuity_facts=[], open_threads=[])

        with patch('backend.agents.graph.ArchivistAgent.prepare_context', side_effect=cancel_after_archive) as archive:
            self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
                **payload, 'variant_count': 3,
            }), 409)

        archive.assert_called_once()
        generate.assert_not_called()
        run = GenerationRun.objects.get(run_metadata__generation_id=payload['generation_id'])
        self.assertEqual(run.status, 'cancelled')
        self.assertEqual(list(run.agent_executions.values_list('node_name', 'status')), [('archivist', 'cancelled')])
        self.assertEqual(SceneVariant.objects.count(), before)

    @patch_writer()
    def test_active_run_is_recoverable_and_blocks_another_scene(self, generate):
        payload = self.payload()

        def model(*args, **kwargs):
            active = self.assert_status(self.send('get', '/generation/active'), 200).json()
            self.assertEqual(active, {**payload, 'scene_id': self.scene.pk, 'variant_count': 1,
                                      'current_agent': 'Scenarzysta', 'variant_number': 1})
            other_account = Client()
            other_account.force_login(self.other_user)
            self.assertIsNone(self.send('get', '/generation/active', client=other_account).json())
            other_scene = f'/scenes/{self.next_scene.pk}/generate'
            self.assert_status(self.send('post', other_scene, self.payload()), 409)
            return ANSWER

        generate.side_effect = model
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', payload), 201)
        self.assertIsNone(self.send('get', '/generation/active').json())
        generate.assert_called_once()

    def test_active_run_without_a_heartbeat_expires(self):
        run = GenerationRun.objects.create(
            request=SceneGenerationRequest.objects.create(scene=self.scene, user_prompt='Dalej'),
            status='running', run_metadata={'generation_id': str(uuid4())},
        )
        GenerationRun.objects.filter(pk=run.pk).update(updated_at=timezone.now() - timedelta(minutes=2))
        self.assertIsNone(self.assert_status(self.send('get', '/generation/active'), 200).json())
        run.refresh_from_db()
        self.assertEqual(run.status, 'failed')
        self.assertIsNotNone(run.finished_at)

    def payload(self):
        return {'generation_id': str(uuid4()), 'user_prompt': 'Napisz scenę.'}

    def cancel(self, payload, scene_id=None):
        return self.send('post', f'/scenes/{scene_id or self.scene.pk}/cancel-generation', payload)

    @patch_writer()
    def test_cancel_arriving_before_generate_prevents_any_model_call(self, generate):
        payload = self.payload()
        count = SceneGenerationRequest.objects.count()
        self.assert_status(self.cancel(payload), 200)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', payload), 409)
        self.assertEqual(SceneGenerationRequest.objects.count(), count + 1)
        run = GenerationRun.objects.get(run_metadata__generation_id=payload['generation_id'])
        self.assertEqual(run.status, 'cancelled')
        self.assertEqual(run.variants.count(), 0)
        generate.assert_not_called()

    @patch_writer()
    def test_cancel_during_model_call_does_not_save_partial_output(self, generate):
        payload = self.payload()

        def cancelled_model(*args, **kwargs):
            self.assertTrue(callable(kwargs['is_cancelled']))
            self.assert_status(self.cancel(payload), 200)
            raise OllamaCancelled()

        generate.side_effect = cancelled_model
        before = SceneVariant.objects.count()
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', payload), 409)
        run = GenerationRun.objects.get(run_metadata__generation_id=payload['generation_id'])
        self.assertEqual(run.status, 'cancelled')
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(SceneVariant.objects.count(), before)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, '')

    @patch_writer()
    def test_cancellation_during_the_second_variant_discards_the_batch(self, generate):
        payload = self.payload()

        def final_token(*args, **kwargs):
            if generate.call_count == 2:
                self.assert_status(self.cancel(payload), 200)
            return ANSWER

        generate.side_effect = final_token
        before = SceneVariant.objects.count()
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {**payload, 'variant_count': 3}), 409)
        self.assertEqual(generate.call_count, 2)
        self.assertEqual(SceneVariant.objects.count(), before)

    @patch_writer(return_value=ANSWER)
    def test_late_cancel_discards_only_its_own_result_and_is_idempotent(self, generate):
        payload = self.payload()
        variant = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', payload), 201).json()
        self.assert_status(self.cancel(payload), 200)
        self.assert_status(self.cancel(payload), 200)
        self.assertFalse(SceneVariant.objects.filter(pk=variant['id']).exists())
        self.assertTrue(SceneVariant.objects.filter(pk=self.variant.pk).exists())
        self.assertEqual(GenerationRun.objects.get(pk=variant['run_id']).status, 'cancelled')

    @patch_writer(return_value=ANSWER)
    def test_duplicate_generation_id_does_not_start_a_second_generation(self, generate):
        payload = self.payload()
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', payload), 201)
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', payload), 409)
        generate.assert_called_once()

    def test_cancel_requires_authentication_csrf_and_scene_ownership(self):
        payload = self.payload()
        path = f'/scenes/{self.scene.pk}/cancel-generation'
        self.assert_status(self.send('post', path, payload, client=Client(enforce_csrf_checks=True)), 401)
        self.assert_status(self.send('post', path, payload, csrf=False), 403)
        self.assert_status(self.cancel(payload, self.foreign_scene.pk), 404)
        self.assert_status(self.cancel({**payload, 'generation_id': 'not-a-uuid'}), 422)
