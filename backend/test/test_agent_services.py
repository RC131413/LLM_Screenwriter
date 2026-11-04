from decimal import Decimal
from unittest.mock import patch

from django.http import Http404

from backend.agents.critic import SceneReview
from backend.agents.services import generate_scene_variant
from backend.api.models import GenerationRun, Scene, SceneVariant
from backend.api.services import save_validated

from ._api_base import ApiTestCase


BLOCKS = [
    {'id': 'action-1', 'type': 'action', 'text': 'Anna otwiera okno.'},
    {'id': 'speaker-1', 'type': 'character', 'text': 'ANNA'},
    {'id': 'dialogue-1', 'type': 'dialogue', 'text': 'Wreszcie.'},
]
HEADING = {'location_heading': 'WN. DOM', 'time_of_day': 'RANO'}


def graph_result():
    review = SceneReview(
        score=6, feedback='Wyjaśnij reakcję Anny.',
        findings=[{
            'category': 'character', 'severity': 'required', 'issue': 'Brak motywacji.',
            'suggestion': 'Pokaż, dlaczego Anna otwiera okno.',
        }],
    )
    return {
        'scene_text': 'WN. DOM - RANO\n\nAnna otwiera okno.\n\nANNA\n\nWreszcie.',
        'scene_blocks': BLOCKS, 'scene_heading': HEADING,
        'critic_review': review, 'critic_feedback': review.feedback,
        'review_status': 'revision_limit_reached', 'revision_count': 2,
    }


class AgentServiceTests(ApiTestCase):
    def generate(self, scene_id=None):
        return generate_scene_variant(
            user=self.user, scene_id=self.scene.pk if scene_id is None else scene_id,
            user_prompt='Anna otwiera okno.',
        )

    @patch('backend.agents.services.scene_graph.invoke', side_effect=lambda _: graph_result())
    def test_saves_reviewed_variant_and_applies_it_with_existing_editor_flow(self, invoke):
        variant = self.generate()
        variant.refresh_from_db()
        run = variant.run

        self.assertEqual(run.status, 'completed')
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(run.run_metadata, {
            'engine': 'langgraph', 'review_status': 'revision_limit_reached', 'revision_count': 2,
        })
        self.assertEqual(variant.critic_score, Decimal('6.00'))
        self.assertEqual(variant.critic_feedback, 'Wyjaśnij reakcję Anny.')
        self.assertTrue(variant.critic_metadata['needs_revision'])
        self.assertEqual(variant.critic_metadata['findings'], graph_result()['critic_review'].model_dump()['findings'])
        self.assertEqual(variant.critic_metadata['blocks'], BLOCKS)
        self.assertEqual(variant.critic_metadata['heading'], HEADING)
        self.assertEqual(variant.generated_full_text, 'Anna otwiera okno.\n\nANNA\n\nWreszcie.')
        self.assertFalse(variant.is_selected)
        self.assertEqual(run.request.context_snapshot, invoke.call_args.args[0]['context'])
        self.assertEqual(invoke.call_args.args[0]['context']['characters'][0]['name'], 'ANNA')
        self.assertEqual(invoke.call_args.args[0]['user_prompt'], 'Anna otwiera okno.')

        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, '')
        response = self.send('post', f'/variants/{variant.pk}/select', {'apply_to_scene': True})
        self.assert_status(response, 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.editor_metadata['blocks'], BLOCKS)
        self.assertEqual(self.scene.location_heading, HEADING['location_heading'])

    @patch('backend.agents.services.scene_graph.invoke', side_effect=lambda _: graph_result())
    def test_history_uses_only_recent_earlier_scenes_from_the_project_in_editor_order(self, invoke):
        self.act.sort_order = 2
        self.act.save(update_fields=['sort_order'])
        self.scene.sort_order = 5
        self.scene.save(update_fields=['sort_order'])
        self.next_scene.sort_order = 1
        self.next_scene.content_text = 'Tekst sceny po zmianie kolejności.'
        self.next_scene.save(update_fields=['sort_order', 'content_text'])
        for index, number in enumerate((30, 31, 32)):
            Scene.objects.create(
                project=self.project, act=self.next_act, scene_number=number, sort_order=index,
                content_text='x' * 1300 + f'Koniec {number}.',
            )
        Scene.objects.create(project=self.project, act=self.act, scene_number=3, sort_order=6, content_text='Później.')
        self.foreign_scene.content_text = 'Prywatna scena innego użytkownika.'
        self.foreign_scene.save(update_fields=['content_text'])

        self.generate()

        previous = invoke.call_args.args[0]['context']['previous_scenes']
        self.assertEqual([scene['scene_number'] for scene in previous], [31, 32, 2])
        self.assertEqual(len(previous[0]['content_text']), 1200)
        self.assertTrue(previous[0]['content_text'].endswith('Koniec 31.'))

    @patch('backend.agents.services.scene_graph.invoke')
    def test_rejects_a_scene_owned_by_someone_else_before_starting_the_graph(self, invoke):
        before = GenerationRun.objects.count()
        with self.assertRaises(Http404):
            self.generate(self.foreign_scene.pk)
        self.assertEqual(GenerationRun.objects.count(), before)
        invoke.assert_not_called()

    @patch('backend.agents.services.scene_graph.invoke', side_effect=RuntimeError('Ollama niedostępna.'))
    def test_model_failure_keeps_failed_run_without_a_variant(self, invoke):
        before = SceneVariant.objects.count()
        with self.assertRaisesRegex(RuntimeError, 'Ollama niedostępna'):
            self.generate()
        run = GenerationRun.objects.get(run_metadata__engine='langgraph')
        self.assertEqual(run.status, 'failed')
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(SceneVariant.objects.count(), before)

    @patch('backend.agents.services.scene_graph.invoke', side_effect=lambda _: graph_result())
    def test_failure_to_finish_run_rolls_back_variant(self, invoke):
        def fail_on_completion(instance, changes=None):
            if isinstance(instance, GenerationRun) and changes and changes['status'] == 'completed':
                raise RuntimeError('Nie udało się zapisać przebiegu.')
            return save_validated(instance, changes)

        with patch('backend.agents.services.save_validated', side_effect=fail_on_completion):
            with self.assertRaisesRegex(RuntimeError, 'Nie udało się zapisać przebiegu'):
                self.generate()
        run = GenerationRun.objects.get(run_metadata__engine='langgraph')
        self.assertEqual(run.status, 'failed')
        self.assertFalse(run.variants.exists())
