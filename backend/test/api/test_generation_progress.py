import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.utils import timezone

from backend.api.models import AgentExecution, GenerationRun, SceneGenerationRequest
from backend.test.support.api_base import ApiTestCase


class GenerationProgressTests(ApiTestCase):
    def test_live_three_variant_progress_tracks_real_nodes_and_critic_revisions(self):
        observations = []
        reviews = {}

        def respond(prompt, **options):
            active = self.assert_status(self.send('get', '/generation/active'), 200).json()
            observations.append(active['progress'])
            properties = options['output_schema']['properties']
            if 'continuity_facts' in properties:
                reply = {'characters': [], 'previous_scenes': [], 'continuity_facts': [], 'open_threads': []}
            elif 'beats' in properties:
                reply = {'beats': ['Anna otwiera list.']}
            elif 'score' in properties:
                number = active['variant_number']
                reviews[number] = reviews.get(number, 0) + 1
                findings = [{'category': 'prompt_alignment', 'severity': 'required',
                             'issue': 'Brakuje otwarcia listu.', 'suggestion': 'Pokaż otwarcie listu.'}]
                reply = {'score': 8, 'feedback': 'Ocena sceny.',
                         'findings': findings if number == 1 and reviews[number] == 1 else []}
            else:
                reply = {'blocks': [{'type': 'action', 'text': 'Anna otwiera list.'}]}
                if 'heading' in properties:
                    reply['heading'] = {'location_type': 'WN.', 'location_heading': 'DOM', 'time_of_day': 'RANO'}
            return json.dumps(reply)

        with patch('backend.ollama.generate', side_effect=respond):
            variants = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
                'user_prompt': 'Anna otwiera list.', 'variant_count': 3, 'generation_id': str(uuid4()),
            }), 201).json()
        self.assertEqual([snapshot['percent'] for snapshot in observations],
                         [0, 10, 20, 30, 30, 30, 40, 50, 60, 70, 80, 90])
        self.assertTrue(all(snapshot['total_steps'] == 10 for snapshot in observations))
        self.assertTrue(all(sum(row['status'] == 'running' for row in snapshot['agent_executions']) == 1
                            for snapshot in observations))
        self.assertNotIn('logs', observations[-1]['agent_executions'][0])
        self.assertNotIn('input_payload', observations[-1]['agent_executions'][0])
        detail = self.assert_status(self.send('get', f'/runs/{variants[0]["run_id"]}'), 200).json()
        self.assertEqual(detail['progress']['percent'], 100)
        self.assertEqual(detail['progress']['completed_steps'], 10)
        self.assertEqual(len(detail['progress']['agent_executions']), 12)
        self.assertEqual([row['review_status'] for row in detail['progress']['agent_executions']
                          if row['node_name'] == 'critic'], ['revision_requested', 'accepted', 'accepted', 'accepted'])
        self.assertIsNone(self.send('get', '/generation/active').json())

    def test_two_variant_run_never_reports_full_progress_before_results_are_saved(self):
        now = timezone.now()
        run = GenerationRun.objects.create(
            request=SceneGenerationRequest.objects.create(scene=self.scene, user_prompt='Napisz scenę.'),
            status='running', started_at=now,
            run_metadata={'generation_id': str(uuid4()), 'variant_count': 2},
        )
        for node, number in [('archivist', 1), ('director', 1), ('scenarist', 1), ('critic', 1),
                             ('director', 2), ('scenarist', 2), ('critic', 2)]:
            AgentExecution.objects.create(run=run, agent_name=node, node_name=node, status='completed',
                started_at=now, finished_at=now, duration_ms=0, input_payload={'variant_number': number},
                output_payload={'review_status': 'accepted'} if node == 'critic' else {})
        progress = self.assert_status(self.send('get', '/generation/active'), 200).json()['progress']
        self.assertEqual((progress['completed_steps'], progress['total_steps'], progress['percent']), (7, 7, 99))
        run.status = 'failed'
        run.finished_at = now
        run.save()
        failed = self.assert_status(self.send('get', f'/runs/{run.pk}'), 200).json()['progress']
        self.assertEqual(failed['percent'], 99)

    def test_interrupted_history_does_not_display_a_stale_running_agent(self):
        finished = timezone.now()
        run = GenerationRun.objects.create(
            request=SceneGenerationRequest.objects.create(scene=self.scene, user_prompt='Napisz scenę.'),
            status='failed', started_at=finished - timedelta(seconds=10), finished_at=finished,
        )
        AgentExecution.objects.create(run=run, agent_name='Scenarzysta', node_name='scenarist', status='running',
                                      started_at=finished - timedelta(seconds=2))
        progress = self.assert_status(self.send('get', f'/runs/{run.pk}'), 200).json()['progress']
        self.assertEqual(progress['agent_executions'][0]['status'], 'failed')
        self.assertEqual(progress['agent_executions'][0]['duration_ms'], 2000)
