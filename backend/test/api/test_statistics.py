from datetime import timedelta, timezone as datetime_timezone
from zoneinfo import ZoneInfo

from django.test import Client
from django.utils import timezone

from backend.api.models import AgentExecution, GenerationRun, SceneGenerationRequest, User
from backend.test.support.api_base import ApiTestCase


class StatisticsTests(ApiTestCase):
    def stats(self, query=''):
        return self.assert_status(self.send('get', '/users/me/statistics' + query), 200).json()

    def run_for(self, status, *, scene=None, at=None):
        prompt = SceneGenerationRequest.objects.create(scene=scene or self.scene, user_prompt='Pisz dalej.')
        return GenerationRun.objects.create(request=prompt, status=status, finished_at=at)

    def test_per_project_counts_count_runs_not_variants_or_agent_steps(self):
        for status in ['completed', 'failed', 'failed', 'cancelled', 'running', 'pending']:
            self.run_for(status)
        AgentExecution.objects.create(run=self.generation_run, agent_name='Krytyk', status='completed')
        counts = {row['project_id']: row for row in self.stats()['project_generations']}
        # The original completed run has two variants and multiple executions.
        self.assertEqual(counts[self.project.pk]['completed_runs'], 2)
        self.assertEqual(counts[self.project.pk]['failed_runs'], 2)
        self.assertEqual(counts[self.second_project.pk]['completed_runs'], 0)
        self.assertEqual(counts[self.second_project.pk]['failed_runs'], 0)
        self.assertNotIn(self.foreign_project.pk, counts)

    def test_five_repeated_openings_survive_reload_and_keep_other_metadata(self):
        self.project.metadata = {'custom': {'keep': True}, 'last_opened_at': '2020-01-01T12:00:00Z'}
        self.project.save()
        for _ in range(7):
            self.assert_status(self.send('post', f'/projects/{self.project.pk}/actions/open'), 200)
        first = self.stats()['recent_activity']
        self.assertEqual(len(first), 5)
        self.assertTrue(all(row['project_id'] == self.project.pk and row['action'] == 'open' for row in first))
        self.assertEqual(len({row['id'] for row in first}), 5)
        self.assertEqual(self.stats()['recent_activity'], first)
        self.project.refresh_from_db()
        self.assertEqual(len(self.project.metadata['recent_activity']), 5)
        self.assertEqual(self.project.metadata['custom'], {'keep': True})
        self.assertEqual(self.project.metadata['last_opened_at'], self.project.metadata['recent_activity'][-1]['occurred_at'])

    def test_creation_editing_and_library_actions_record_real_events(self):
        created = self.assert_status(self.send('post', '/projects', {'title': 'Nowy projekt'}), 201).json()
        pk = created['id']
        self.assertEqual(created['metadata']['recent_activity'][-1]['action'], 'create')
        self.assert_status(self.send('patch', f'/projects/{pk}', {
            'title': 'Nowy tytuł', 'metadata': {'custom': 7, 'recent_activity': []},
        }), 200)
        for action in ['archive', 'trash', 'restore']:
            self.assert_status(self.send('post', f'/projects/{pk}/actions/{action}'), 200)
        recent = self.stats()['recent_activity']
        self.assertEqual([row['action'] for row in recent], ['restore', 'trash', 'archive', 'edit', 'create'])
        self.assertTrue(all(row['project_title'] == 'Nowy tytuł' for row in recent))
        saved = self.send('get', f'/projects/{pk}').json()
        self.assertEqual(saved['metadata']['custom'], 7)
        self.assertEqual(len(saved['metadata']['recent_activity']), 5)

    def test_generation_outcomes_mix_with_project_events_in_time_order(self):
        now = timezone.now()
        completed = self.run_for('completed', at=now + timedelta(minutes=1))
        failed = self.run_for('failed', at=now + timedelta(minutes=2))
        cancelled = self.run_for('cancelled', at=now + timedelta(minutes=3))
        self.run_for('running')
        recent = self.stats()['recent_activity']
        self.assertEqual([row['id'] for row in recent[:3]],
                         [f'generation-{cancelled.pk}', f'generation-{failed.pk}', f'generation-{completed.pk}'])
        self.assertEqual([row['action'] for row in recent[:3]],
                         ['generation_cancelled', 'generation_failed', 'generation_completed'])

    def test_legacy_openings_and_malformed_history_do_not_break_statistics(self):
        self.project.metadata = {'last_opened_at': '2026-01-01T20:00:00Z', 'recent_activity': [
            None, {'id': 'bad', 'action': 'open', 'occurred_at': 'not a date'},
        ]}
        self.project.save()
        recent = self.stats()['recent_activity']
        legacy = next(row for row in recent if row['id'] == f'legacy-open-{self.project.pk}')
        self.assertEqual(legacy['action'], 'open')
        self.assertEqual(legacy['occurred_at'], '2026-01-01T20:00:00Z')

    def test_prompt_days_use_the_requested_time_zone_and_exclude_old_requests(self):
        SceneGenerationRequest.objects.filter(scene__project__user=self.user).delete()
        at = timezone.now().astimezone(datetime_timezone.utc).replace(hour=23, minute=30, second=0, microsecond=0) - timedelta(days=1)
        recent = SceneGenerationRequest.objects.create(scene=self.scene, user_prompt='Nowsze polecenie.')
        old = SceneGenerationRequest.objects.create(scene=self.scene, user_prompt='Stare polecenie.')
        SceneGenerationRequest.objects.filter(pk=recent.pk).update(created_at=at)
        SceneGenerationRequest.objects.filter(pk=old.pk).update(created_at=at - timedelta(days=31))
        local_day = at.astimezone(ZoneInfo('Europe/Warsaw')).date().isoformat()
        self.assertEqual(self.stats('?time_zone=Europe%2FWarsaw')['prompt_activity'], [{'date': local_day, 'count': 1}])
        self.assertEqual(self.stats('?time_zone=UTC')['prompt_activity'], [{'date': at.date().isoformat(), 'count': 1}])
        self.assert_status(self.send('get', '/users/me/statistics?time_zone=invalid-zone'), 422)

    def test_statistics_and_activity_do_not_leak_other_users_data(self):
        self.foreign_project.metadata = {'last_opened_at': '2099-01-01T00:00:00Z'}
        self.foreign_project.save()
        self.run_for('completed', scene=self.foreign_scene, at=timezone.now() + timedelta(days=1))
        stats = self.stats()
        self.assertTrue(all(row['project_id'] != self.foreign_project.pk for row in stats['recent_activity']))
        self.assertEqual(stats['completed_runs'], 1)
        self.assert_status(self.send('get', '/users/me/statistics', client=Client()), 401)

    def test_new_account_has_zero_counts_and_empty_activity(self):
        empty = User.objects.create_user('empty', 'empty@example.com')
        self.client.force_login(empty)
        stats = self.stats()
        for key in ['projects', 'acts', 'scenes', 'characters', 'generation_requests', 'generation_runs', 'completed_runs', 'variants']:
            self.assertEqual(stats[key], 0)
        self.assertEqual(stats['project_generations'], [])
        self.assertEqual(stats['recent_activity'], [])
        self.assertEqual(stats['prompt_activity'], [])
