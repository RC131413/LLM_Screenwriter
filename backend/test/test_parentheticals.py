import json
from copy import deepcopy
from unittest.mock import patch

from django.test import SimpleTestCase

from backend.api.screenplay import generated_continuation
from ._api_base import ApiTestCase


SCENE = {'content_text': '', 'location_heading': 'WN. CHATA', 'time_of_day': 'ŚWIT'}


def speech(direction, text, speaker='MACIEK'):
    return {'type': 'speech', 'speaker': speaker, 'parenthetical': direction, 'spoken_text': text}


def answer(*blocks, heading=False):
    value = {'blocks': blocks}
    if heading:
        value['heading'] = {'location_type': 'WN.', 'location_heading': 'CHATA', 'time_of_day': 'ŚWIT'}
    return json.dumps(value)


REPEATED = answer(
    speech('szeptem do siebie', 'To musi być wskazówka.'),
    {'type': 'action', 'text': 'Maciek obraca kulę.'},
    speech('SZEPTEM, DO SIEBIE', 'Widzę znajomy znak.'),
    speech('(szeptem)', 'Pamiętam go.'),
    speech('głośno do siebie', 'Już wiem, gdzie szukać.'),
    heading=True,
)


class ParentheticalFormatTests(SimpleTestCase):
    def test_recovers_one_delivery_hint_from_narration_without_repeating_it_for_each_line(self):
        blocks, _ = generated_continuation(answer(
            speech('Dziadek uśmiecha się ciepło.', 'Usiądź.', speaker='DZIADEK'),
            speech('Dziadek mówi spokojnie i z troską.', 'Znałem twojego ojca.', speaker='DZIADEK'),
            speech('Dziadek mówi z nostalgią i miłością.', 'Zostawił ci ten list.', speaker='DZIADEK'),
        ), SCENE)
        self.assertEqual([b['text'] for b in blocks if b['type'] == 'parenthetical'], ['(spokojnie i z troską)'])
        self.assertEqual(len([b for b in blocks if b['type'] == 'dialogue']), 3)

    def test_screenshot_style_repetitions_are_suppressed_without_removing_dialogue(self):
        model_blocks = [speech('szeptem do siebie', 'Pierwsza kwestia.'),
                        {'type': 'action', 'text': 'Maciek obraca kulę.'},
                        speech('SZEPTEM, DO SIEBIE', 'Druga kwestia.'),
                        speech('(szeptem)', 'Trzecia kwestia.'),
                        speech('głośno do siebie', 'Czwarta kwestia.')]
        original = deepcopy(model_blocks)
        blocks, _ = generated_continuation(answer(*model_blocks), SCENE)
        self.assertEqual([b['text'] for b in blocks if b['type'] == 'parenthetical'], ['(szeptem)', '(głośno)'])
        self.assertEqual([b['text'] for b in blocks if b['type'] == 'dialogue'],
                         ['Pierwsza kwestia.', 'Druga kwestia.', 'Trzecia kwestia.', 'Czwarta kwestia.'])
        self.assertEqual([b['text'] for b in blocks if b['type'] == 'action'], ['Maciek obraca kulę.'])
        self.assertEqual(model_blocks, original)

    def test_real_changes_of_delivery_are_preserved_including_a_return_to_whisper(self):
        blocks, _ = generated_continuation(answer(
            speech('szeptem', 'Poczekaj.'), speech('głośno', 'Stój!'), speech('szeptem', 'Teraz możesz podejść.'),
        ), SCENE)
        self.assertEqual([b['text'] for b in blocks if b['type'] == 'parenthetical'],
                         ['(szeptem)', '(głośno)', '(szeptem)'])

    def test_the_same_direction_is_preserved_for_a_different_speaker(self):
        blocks, _ = generated_continuation(answer(
            speech('szeptem', 'Słyszysz to?'), speech('szeptem', 'Tak.', speaker='ANNA'),
        ), SCENE)
        self.assertEqual(len([b for b in blocks if b['type'] == 'parenthetical']), 2)

    def test_continuation_does_not_repeat_a_direction_from_the_authored_scene(self):
        old_blocks = [{'id': 'who', 'type': 'character', 'text': 'MACIEK'},
                      {'id': 'how', 'type': 'parenthetical', 'text': '(szeptem do siebie)'},
                      {'id': 'words', 'type': 'dialogue', 'text': 'To musi być wskazówka.'}]
        scene = {**SCENE, 'content_text': 'MACIEK\n\n(szeptem do siebie)\n\nTo musi być wskazówka.',
                 'editor_metadata': {'blocks': old_blocks}}
        original = deepcopy(scene)
        blocks, _ = generated_continuation(answer(speech('szeptem', 'Na odwrocie jest data.')), scene)
        self.assertEqual([b['type'] for b in blocks], ['character', 'dialogue'])
        self.assertEqual(scene, original)

    def test_self_address_alone_is_removed_but_useful_directions_remain(self):
        blocks, _ = generated_continuation(answer(
            speech('do siebie', 'To tutaj.'),
            speech('mówiąc do siebie', 'Znalazłem.'),
            speech('do telefonu', 'Anno, przyjedź.'),
            speech('z ironią', 'Wspaniały pomysł.'),
        ), SCENE)
        self.assertEqual([b['text'] for b in blocks if b['type'] == 'parenthetical'],
                         ['(do telefonu)', '(z ironią)'])


class ParentheticalApiTests(ApiTestCase):
    @patch('backend.ollama.generate', return_value=REPEATED)
    def test_preview_text_and_applied_scene_share_refined_parentheticals(self, generate):
        variant = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Maciek rozpoznaje znak na kuli.',
        }), 201).json()
        blocks = variant['critic_metadata']['blocks']
        self.assertEqual([b['text'] for b in blocks if b['type'] == 'parenthetical'], ['(szeptem)', '(głośno)'])
        self.assertNotIn('do siebie', variant['generated_full_text'])
        self.assertEqual(variant['generated_full_text'], '\n\n'.join(b['text'] for b in blocks))
        self.assert_status(self.send('post', f'/variants/{variant["id"]}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.editor_metadata['blocks'], blocks)
        self.assertEqual(self.scene.content_text, variant['generated_full_text'])
        generate.assert_called_once()

    @patch('backend.ollama.generate', return_value=REPEATED)
    def test_ignore_preference_removes_all_new_parentheticals_even_if_model_returns_them(self, generate):
        self.assert_status(self.send('put', '/users/me/preferences', {
            'writing_style_preferences': {'parentheticals': 'ignore'},
        }), 200)
        variant = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Maciek rozpoznaje znak na kuli.',
        }), 201).json()
        self.assertFalse(any(b['type'] == 'parenthetical' for b in variant['critic_metadata']['blocks']))
        self.assertEqual(len([b for b in variant['critic_metadata']['blocks'] if b['type'] == 'dialogue']), 4)
        self.assertNotIn('(szeptem)', variant['generated_full_text'])
        generate.assert_called_once()
