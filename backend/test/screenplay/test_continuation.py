import json

from django.test import SimpleTestCase

from backend.api.models import SceneVariant
from backend.api.screenplay import can_generate_heading, generated_continuation, remove_repeated_prefix, scene_output_schema
from backend.ollama import OllamaError
from backend.test.support.api_base import ApiTestCase
from backend.test.support.graph_transport import patch_writer


HEADING = {'location_heading': 'WN. MIESZKANIE', 'time_of_day': 'RANO'}
MODEL_HEADING = {'location_type': 'WN.', 'location_heading': 'MIESZKANIE', 'time_of_day': 'RANO'}
NEW_BLOCKS = [{'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None, 'spoken_text': 'Nowa wypowiedź.'}]


class ContinuationFormatTests(SimpleTestCase):
    def test_removes_copied_action_when_model_omits_interleaved_dialogue(self):
        previous = [
            {'id': '1', 'type': 'action', 'text': 'Anna otwiera kopertę.'},
            {'id': '2', 'type': 'character', 'text': 'ANNA'},
            {'id': '3', 'type': 'dialogue', 'text': 'Znalazłam list.'},
            {'id': '4', 'type': 'action', 'text': 'Anna odkłada list na stół.'},
            {'id': '5', 'type': 'character', 'text': 'JAN'},
            {'id': '6', 'type': 'dialogue', 'text': 'Pokaż mi.'},
        ]
        scene = {'content_text': '\n\n'.join(block['text'] for block in previous),
                 'editor_metadata': {'blocks': previous}}
        answer = json.dumps({'blocks': [
            {'type': 'action', 'text': 'Anna otwiera kopertę.'},
            {'type': 'action', 'text': 'Anna odkłada list na stół. Jan wyciąga rękę.'},
        ]})
        blocks, _ = generated_continuation(answer, scene)
        self.assertEqual([block['text'] for block in blocks], ['Jan wyciąga rękę.'])

    def test_heading_is_allowed_only_for_empty_scene_without_any_heading(self):
        for scene, allowed in (
            ({'content_text': '', 'location_heading': '', 'time_of_day': ''}, True),
            ({'content_text': '   ', 'editor_metadata': {'blocks': [{'text': ''}]}}, True),
            ({'content_text': 'Treść'}, False),
            ({'location_heading': 'WN. DOM'}, False),
            ({'time_of_day': 'NOC'}, False),
            ({'editor_metadata': {'blocks': [{'text': 'Widoczna treść'}]}}, False),
        ):
            with self.subTest(scene=scene):
                self.assertEqual(can_generate_heading(scene), allowed)
                self.assertEqual('heading' in scene_output_schema(scene)['properties'], allowed)

    def test_removes_copied_tail_even_inside_a_generated_paragraph(self):
        blocks = [{'id': 'new', 'type': 'action', 'text': 'Anna zamyka drzwi. Za chwilę rozlega się pukanie.'}]
        result = remove_repeated_prefix('Jest późno. Anna zamyka drzwi.', blocks)
        self.assertEqual(result, [{'id': 'new', 'type': 'action', 'text': 'Za chwilę rozlega się pukanie.'}])
        self.assertEqual(blocks[0]['text'], 'Anna zamyka drzwi. Za chwilę rozlega się pukanie.')

    def test_removes_complete_copied_scene_before_new_dialogue(self):
        scene = {'content_text': 'Anna otwiera list.\n\nANNA\n\nCo to jest?'}
        copied = [{'type': 'action', 'text': 'Anna otwiera list.'},
                  {'type': 'speech', 'speaker': 'ANNA', 'parenthetical': None, 'spoken_text': 'Co to jest?'}]
        blocks, heading = generated_continuation(json.dumps({'blocks': [*copied, *NEW_BLOCKS]}), scene)
        self.assertEqual([block['text'] for block in blocks], ['ANNA', 'Nowa wypowiedź.'])
        self.assertIsNone(heading)

    def test_rejects_an_echo_without_any_new_content(self):
        with self.assertRaises(OllamaError):
            generated_continuation('{"blocks":[{"type":"action","text":"Anna otwiera list."}]}',
                                   {'content_text': 'Anna otwiera list.'})

    def test_requires_heading_for_empty_scene_and_rejects_heading_for_nonempty_scene(self):
        answer = json.dumps({'blocks': NEW_BLOCKS, 'heading': MODEL_HEADING})
        blocks, heading = generated_continuation(answer, {'content_text': ''})
        self.assertEqual(heading, HEADING)
        self.assertEqual(len(blocks), 2)
        with self.assertRaises(OllamaError):
            generated_continuation(answer, {'content_text': 'Existing text'})
        with self.assertRaises(OllamaError):
            generated_continuation(json.dumps({'blocks': NEW_BLOCKS}), {'content_text': ''})

    def test_heading_has_explicit_interior_exterior_prefix_and_no_duplicate_time(self):
        for kind in ('WN.', 'PL.'):
            blocks, heading = generated_continuation(json.dumps({
                'heading': {'location_type': kind, 'location_heading': 'Miejsce: WN. Chata - ŚWIT.', 'time_of_day': 'ŚWIT'},
                'blocks': [{'type': 'action', 'text': 'Miejsce: Chata.'},
                           {'type': 'action', 'text': 'Pora dnia: Świt.'},
                           {'type': 'action', 'text': f'{kind} CHATA - ŚWIT'},
                           {'type': 'action', 'text': 'Przez okno wpada światło.'}, *NEW_BLOCKS],
            }), {'content_text': ''})
            self.assertEqual(heading, {'location_heading': f'{kind} CHATA', 'time_of_day': 'ŚWIT'})
            self.assertEqual([block['text'] for block in blocks], ['Przez okno wpada światło.', 'ANNA', 'Nowa wypowiedź.'])

    def test_missing_or_invalid_heading_type_is_rejected_instead_of_saved(self):
        for heading in (HEADING, {**MODEL_HEADING, 'location_type': 'INT.'},
                        {**MODEL_HEADING, 'time_of_day': 'Pora dnia: Świt.'}):
            with self.subTest(heading=heading), self.assertRaises(OllamaError):
                generated_continuation(json.dumps({'heading': heading, 'blocks': NEW_BLOCKS}), {'content_text': ''})

    def test_heading_only_generation_is_rejected_without_discarding_real_narrative(self):
        with self.assertRaises(OllamaError):
            generated_continuation(json.dumps({'heading': MODEL_HEADING, 'blocks': [
                {'type': 'action', 'text': 'Miejsce: Mieszkanie.'},
                {'type': 'action', 'text': 'Pora dnia: Rano.'},
            ]}), {'content_text': ''})
        narrative = 'Anna czyta napis: Miejsce: chata. Potem odkłada kartkę.'
        blocks, _ = generated_continuation(json.dumps({'heading': MODEL_HEADING, 'blocks': [
            {'type': 'action', 'text': narrative},
        ]}), {'content_text': ''})
        self.assertEqual(blocks[0]['text'], narrative)


class ContinuationApiTests(ApiTestCase):
    @patch_writer()
    def test_generation_saves_only_new_text_without_echoed_scene_tail(self, generate):
        self.scene.content_text = 'Anna otwiera list.'
        self.scene.save()
        generate.return_value = json.dumps({'blocks': [{'type': 'action', 'text': 'Anna otwiera list.'}, *NEW_BLOCKS]})
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Kontynuuj.'}), 201).json()
        self.assertEqual(result['generated_full_text'], 'ANNA\n\nNowa wypowiedź.')
        self.assertEqual(result['critic_metadata']['operation'], 'append')
        self.assertNotIn('heading', result['critic_metadata'])
        self.assertNotIn('heading', generate.call_args.kwargs['output_schema']['properties'])

    @patch_writer(return_value=json.dumps({'blocks': NEW_BLOCKS, 'heading': MODEL_HEADING}))
    def test_empty_scene_receives_heading_and_applying_twice_does_not_duplicate(self, generate):
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Napisz początek.'}), 201).json()
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.location_heading, '')
        self.assertEqual(result['critic_metadata']['heading'], HEADING)
        for _ in range(2):
            self.assert_status(self.send('post', f'/variants/{result["id"]}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.location_heading, HEADING['location_heading'])
        self.assertEqual(self.scene.time_of_day, HEADING['time_of_day'])
        self.assertEqual(self.scene.content_text, 'ANNA\n\nNowa wypowiedź.')
        self.assertEqual(len(self.scene.editor_metadata['blocks']), 2)
        self.assertEqual(self.scene.editor_metadata['applied_variant_ids'], [result['id']])

    @patch_writer(return_value=json.dumps({'blocks': NEW_BLOCKS, 'heading': MODEL_HEADING}))
    def test_user_edits_after_generation_are_preserved_and_disable_automatic_heading(self, generate):
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Napisz początek.'}), 201).json()
        self.scene.content_text = 'Tekst dopisany ręcznie w trakcie generowania.'
        self.scene.editor_metadata = {'zoom': 120, 'blocks': [{'id': 'manual', 'type': 'action', 'text': self.scene.content_text}]}
        self.scene.save()
        self.assert_status(self.send('post', f'/variants/{result["id"]}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.location_heading, '')
        self.assertEqual(self.scene.time_of_day, '')
        self.assertTrue(self.scene.content_text.startswith('Tekst dopisany ręcznie w trakcie generowania.\n\n'))
        self.assertEqual(self.scene.editor_metadata['blocks'][0]['id'], 'manual')
        self.assertEqual(self.scene.editor_metadata['zoom'], 120)

    @patch_writer(return_value=json.dumps({'blocks': NEW_BLOCKS, 'heading': MODEL_HEADING}))
    def test_manual_heading_entered_after_generation_is_not_overwritten(self, generate):
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Napisz początek.'}), 201).json()
        self.scene.location_heading = 'PL. PARK'
        self.scene.time_of_day = 'NOC'
        self.scene.save()
        self.assert_status(self.send('post', f'/variants/{result["id"]}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual((self.scene.location_heading, self.scene.time_of_day), ('PL. PARK', 'NOC'))

    @patch_writer(return_value=json.dumps({'blocks': NEW_BLOCKS}))
    def test_no_generated_heading_for_empty_scene_with_manual_heading(self, generate):
        self.scene.location_heading = 'WN. BIURO'
        self.scene.time_of_day = 'DZIEŃ'
        self.scene.save()
        result = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {'user_prompt': 'Kontynuuj.'}), 201).json()
        self.assertNotIn('heading', result['critic_metadata'])
        self.assertNotIn('heading', generate.call_args.kwargs['output_schema']['properties'])

    def test_legacy_text_variant_is_appended_to_current_text_and_preserves_later_edits(self):
        self.prompt.context_snapshot = {'scene': {'content_text': 'Oryginalny tekst.'}}
        self.prompt.save()
        self.variant.generated_full_text = 'Oryginalny tekst.\n\nDalszy ciąg.'
        self.variant.save()
        self.scene.content_text = 'Oryginalny tekst.\n\nMoje późniejsze zdanie.'
        self.scene.save()
        for _ in range(2):
            self.assert_status(self.send('post', f'/variants/{self.variant.pk}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.content_text, 'Oryginalny tekst.\n\nMoje późniejsze zdanie.\n\nDalszy ciąg.')
        self.assertEqual(SceneVariant.objects.filter(pk=self.variant.pk).count(), 1)
