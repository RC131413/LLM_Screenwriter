import json
from uuid import uuid4

from backend.api.models import GenerationRun, SceneGenerationRequest, SceneVariant
from ._api_base import ApiTestCase
from ._graph_transport import patch_writer


ACTION = {'type': 'action', 'text': 'Maćko odsuwa krzesło. Pod nogą stołu znajduje skrawek tkaniny.'}
SPEECH = {'type': 'speech', 'speaker': 'MAĆKO', 'parenthetical': 'cicho', 'spoken_text': 'Znam ten znak.'}
HEADING = {'location_type': 'WN.', 'location_heading': 'CHATA', 'time_of_day': 'ŚWIT'}
ACTION_ONLY = json.dumps({'heading': HEADING, 'blocks': [ACTION]})
SCREENPLAY = json.dumps({'heading': HEADING, 'blocks': [ACTION, SPEECH]})


class SceneCompositionApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.character.name = 'MAĆKO'
        self.character.save(update_fields=['name'])

    @patch_writer(return_value=json.dumps({'blocks': [{
        'type': 'speech', 'speaker': 'MAĆKO', 'parenthetical': None,
        'spoken_text': '. Dlaczego?\n. Czas odkryć prawdę.',
    }]}))
    def test_generated_dialogue_is_cleaned_before_saving_and_applying_without_changing_manual_text(self, generate):
        old_blocks = [
            {'id': 'speaker', 'type': 'character', 'text': 'MAĆKO'},
            {'id': 'manual', 'type': 'dialogue', 'text': '. Ręcznie wpisana kwestia...'},
        ]
        self.scene.location_heading = 'WN. CHATA'
        self.scene.content_text = 'MAĆKO\n\n. Ręcznie wpisana kwestia...'
        self.scene.editor_metadata = {'blocks': old_blocks}
        self.scene.save()
        variant = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Dodaj następny dialog.',
        }), 201).json()
        self.assertEqual(variant['generated_full_text'], 'MAĆKO\n\nDlaczego?\nCzas odkryć prawdę.')
        self.assertEqual(variant['critic_metadata']['blocks'][-1]['text'], 'Dlaczego?\nCzas odkryć prawdę.')
        self.assert_status(self.send('post', f'/variants/{variant["id"]}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.editor_metadata['blocks'][:2], old_blocks)
        self.assertEqual(self.scene.editor_metadata['blocks'][-1]['text'], 'Dlaczego?\nCzas odkryć prawdę.')
        generate.assert_called_once()

    @patch_writer(return_value=ACTION_ONLY)
    def test_generic_request_accepts_action_only_without_retry_and_applies_it(self, generate):
        before = (SceneGenerationRequest.objects.count(), SceneVariant.objects.count())
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'wymyśl mi teraz początek sceny',
        }), 201).json()
        generate.assert_called_once()
        self.assertEqual([block['type'] for block in result['critic_metadata']['blocks']], ['action'])
        self.assertEqual(SceneGenerationRequest.objects.count(), before[0] + 1)
        self.assertEqual(SceneVariant.objects.count(), before[1] + 1)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, '')
        self.assert_status(self.send('post', f'/variants/{result["id"]}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, ACTION['text'])
        self.assertEqual(self.scene.editor_metadata['blocks'], result['critic_metadata']['blocks'])
        self.assertEqual(self.scene.location_heading, 'WN. CHATA')
        self.assertEqual(self.scene.time_of_day, 'ŚWIT')

    @patch_writer()
    def test_action_only_continuation_preserves_existing_dialogue_without_adding_speech(self, generate):
        self.scene.content_text = 'MAĆKO\n\n(cicho)\n\nZnam ten znak.'
        old_blocks = [{'id': 'speaker', 'type': 'character', 'text': 'MAĆKO'},
                      {'id': 'direction', 'type': 'parenthetical', 'text': '(cicho)'},
                      {'id': 'line', 'type': 'dialogue', 'text': 'Znam ten znak.'}]
        self.scene.editor_metadata = {'blocks': old_blocks}
        self.scene.save()
        generate.return_value = json.dumps({'blocks': [SPEECH, ACTION]})
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Kontynuuj.',
        }), 201).json()
        self.assertEqual([block['type'] for block in result['critic_metadata']['blocks']], ['action'])
        self.assert_status(self.send('post', f'/variants/{result["id"]}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.editor_metadata['blocks'], [*old_blocks, *result['critic_metadata']['blocks']])
        self.assertEqual(self.scene.content_text, 'MAĆKO\n\n(cicho)\n\nZnam ten znak.\n\n' + ACTION['text'])
        generate.assert_called_once()

    @patch_writer(return_value=SCREENPLAY)
    def test_optional_dialogue_keeps_character_direction_and_spoken_words_in_order(self, generate):
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Maćko rozpoznaje znak.',
        }), 201).json()
        self.assertEqual([block['type'] for block in result['critic_metadata']['blocks']],
                         ['action', 'character', 'parenthetical', 'dialogue'])
        generate.assert_called_once()

    @patch_writer(return_value=ACTION_ONLY)
    def test_explicit_silent_scene_is_saved_without_forced_dialogue(self, generate):
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Napisz samą akcję, bez dialogów.',
        }), 201).json()
        self.assertEqual([block['type'] for block in result['critic_metadata']['blocks']], ['action'])
        generate.assert_called_once()

    @patch_writer(return_value=SCREENPLAY)
    def test_author_notes_and_current_dialogue_instruction_are_both_forwarded(self, generate):
        self.scene.ai_metadata = {'notes': 'Scena bez dialogów.'}
        self.scene.save()
        instruction = 'Jednak dodaj dialog Maćka.'
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': instruction,
        }), 201)
        self.assertIn(self.scene.ai_metadata['notes'], generate.call_args.args[0])
        self.assertIn(instruction, generate.call_args.args[0])
        generate.assert_called_once()

    @patch_writer()
    def test_cancelling_an_action_only_response_does_not_save_any_variant(self, generate):
        payload = {'user_prompt': 'Napisz początek.', 'generation_id': str(uuid4())}

        def model(*args, **kwargs):
            self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/cancel-generation', payload), 200)
            return ACTION_ONLY

        generate.side_effect = model
        self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', payload), 409)
        run = GenerationRun.objects.get(run_metadata__generation_id=payload['generation_id'])
        self.assertEqual(run.status, 'cancelled')
        self.assertFalse(run.variants.exists())
        generate.assert_called_once()
