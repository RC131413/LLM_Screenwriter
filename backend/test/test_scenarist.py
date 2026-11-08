import json
from copy import deepcopy

import httpx
from django.test import SimpleTestCase
from langchain_core.exceptions import OutputParserException
from langchain_ollama import ChatOllama
from pydantic import ValidationError

from backend.agents.scenarist import ScenaristAgent
from backend.api.screenplay import SceneStructureError
from backend.ollama import OLLAMA_BASE_URL, OLLAMA_MODEL
from backend.screenplay_schemas import GeneratedScene, GeneratedSceneWithHeading


class ScenaristAgentTests(SimpleTestCase):
    def setUp(self):
        self.requests = []
        self.reply = {'blocks': [{'type': 'action', 'text': 'Marta rusza na peron.'}]}
        transport = httpx.MockTransport(self.respond)
        self.scenarist = ScenaristAgent(ChatOllama(
            model=OLLAMA_MODEL, base_url=OLLAMA_BASE_URL,
            client_kwargs={'transport': transport},
        ))

    def respond(self, request):
        self.assertEqual((request.method, request.url.path), ('POST', '/api/chat'))
        self.requests.append(json.loads(request.content))
        chunk = {
            'model': OLLAMA_MODEL,
            'message': {'role': 'assistant', 'content': json.dumps(self.reply)},
            'done': True,
            'done_reason': 'stop',
        }
        return httpx.Response(200, text=json.dumps(chunk) + '\n')

    def test_writing_preferences_are_explicit_instructions_for_each_style(self):
        for style, policy, expected_action, expected_direction in [
            ('concise_technical', 'sparingly', 'zwięzłe i rzeczowe', 'parenthetical opcjonalne'),
            ('literary_descriptive', 'ignore', 'detalem obrazu i dźwięku', 'parenthetical zawsze null'),
            ('concise_technical', 'standard', 'zwięzłe i rzeczowe', 'proponuj krótkie, naturalne wskazówki'),
        ]:
            with self.subTest(style=style, policy=policy):
                context = {'writing_style_preferences': {
                    'stage_directions_style': style, 'dialogue_tone': 'Lekki, ironiczny', 'parentheticals': policy,
                }}
                original = deepcopy(context)
                self.scenarist.write_scene(user_prompt='Marta rusza na peron.', context=context,
                                          beats=['Marta rusza na peron.'])
                system = self.requests[-1]['messages'][0]['content']
                self.assertIn(expected_action, system)
                self.assertIn(expected_direction, system)
                self.assertIn('Lekki, ironiczny', system)
                self.assertIn('indywidualny głos postaci mają pierwszeństwo', system)
                self.assertIn('Nie wymuszaj rozmowy', system)
                self.assertEqual(context, original)

    def test_sends_ordered_plan_and_voice_profiles_and_renders_screenplay(self):
        context = {
            'characters': [
                {'name': 'Marta', 'profile': 'Mówi krótko i potocznie.'},
                {'name': 'Olek', 'voice_profile': {'address': 'Zwraca się per pani.'}},
            ],
            'continuity_facts': ['Olek znalazł bilet Marty.'],
        }
        original = deepcopy(context)
        prompt = 'Napisz krótką scenę na dworcu.'
        beats = ['Marta pyta o bilet.', 'Olek oddaje jej bilet.', 'Marta rusza na peron.']
        self.reply = {'blocks': [
            {'type': 'speech', 'speaker': 'Marta', 'parenthetical': None, 'spoken_text': 'Hej, masz mój bilet?'},
            {'type': 'speech', 'speaker': 'Olek', 'parenthetical': 'po chwili namysłu',
             'spoken_text': 'Tak, pani Marto.'},
            {'type': 'action', 'text': 'Olek podaje Marcie bilet.'},
            {'type': 'action', 'text': 'Marta rusza na peron.'},
        ]}

        result = self.scenarist.write_scene(user_prompt=prompt, context=context, beats=beats)

        self.assertEqual(result, '\n\n'.join([
            'MARTA', 'Hej, masz mój bilet?', 'OLEK', '(po chwili namysłu)',
            'Tak, pani Marto.', 'Olek podaje Marcie bilet.', 'Marta rusza na peron.',
        ]))
        self.assertEqual(context, original)
        request, = self.requests
        self.assertEqual(request['format']['$defs']['CastGeneratedSpeech']['properties']['speaker']['enum'],
                         ['MARTA', 'OLEK'])
        self.assertEqual([message['role'] for message in request['messages']], ['system', 'user'])
        self.assertEqual(json.loads(request['messages'][1]['content']), {
            'user_prompt': prompt, 'context': original, 'beats': beats,
        })

    def test_cast_label_is_fixed_while_family_terms_in_action_and_dialogue_remain(self):
        self.reply = {'blocks': [
            {'type': 'action', 'text': 'Pradziadek pokazuje Maćkowi dokument.'},
            {'type': 'speech', 'speaker': ' starszy  mężczyzna ', 'parenthetical': None,
             'spoken_text': 'Twój dziadek zostawił ten list.'},
            {'type': 'speech', 'speaker': 'Maciek', 'parenthetical': None, 'spoken_text': 'Dziękuję, pradziadku.'},
        ]}
        context = {'characters': [{'name': 'Maciek'}, {'name': 'STARSZY MĘŻCZYZNA', 'role': 'Pradziadek Maćka'}]}
        result = self.scenarist.write_scene_draft(
            user_prompt='Pradziadek pokazuje dokument.', context=context,
            beats=['Starszy mężczyzna pokazuje Maćkowi dokument.'],
        )

        self.assertEqual([block['text'] for block in result.blocks if block['type'] == 'character'],
                         ['STARSZY MĘŻCZYZNA', 'MACIEK'])
        self.assertEqual(result.blocks[0]['text'], 'Pradziadek pokazuje Maćkowi dokument.')
        self.assertIn('Twój dziadek zostawił ten list.', result.text)
        self.assertIn('Dziękuję, pradziadku.', result.text)
        self.assertEqual(len(self.requests), 1)

    def test_alias_cannot_replace_a_selected_label_even_if_a_model_ignores_the_schema(self):
        self.reply = {'blocks': [
            {'type': 'speech', 'speaker': 'PRADZIADEK', 'parenthetical': None, 'spoken_text': 'Usiądź.'},
        ]}
        with self.assertRaises(OutputParserException):
            self.scenarist.write_scene(
                user_prompt='Pradziadek zaprasza Maćka.',
                context={'characters': [{'name': 'MACIEK'}, {'name': 'STARSZY MĘŻCZYZNA'}]},
                beats=['Starszy mężczyzna zaprasza Maćka do stołu.'],
            )
        self.assertEqual(len(self.requests), 1)

    def test_labels_are_enforced_also_when_generating_a_new_heading(self):
        self.reply = {
            'heading': {'location_type': 'WN.', 'location_heading': 'CHATA', 'time_of_day': 'RANO'},
            'blocks': [{'type': 'speech', 'speaker': 'STARSZY MĘŻCZYZNA',
                        'parenthetical': None, 'spoken_text': 'To nasza rodzina.'}],
        }
        result = self.scenarist.write_scene_draft(
            user_prompt='Starszy mężczyzna wyjaśnia pochodzenie.',
            context={'scene': {}, 'characters': [{'name': 'MACIEK'}, {'name': 'STARSZY MĘŻCZYZNA'}]},
            beats=['Starszy mężczyzna wskazuje rodzinne dokumenty.'],
        )
        self.assertEqual(result.heading, {'location_heading': 'WN. CHATA', 'time_of_day': 'RANO'})
        self.assertIn('STARSZY MĘŻCZYZNA', result.text)
        self.assertEqual(self.requests[0]['format']['$defs']['CastGeneratedSpeech']['properties']['speaker']['enum'],
                         ['MACIEK', 'STARSZY MĘŻCZYZNA'])

    def test_without_selected_characters_the_model_can_still_name_a_speaker(self):
        self.reply = {'blocks': [
            {'type': 'speech', 'speaker': 'PRADZIADEK', 'parenthetical': None, 'spoken_text': 'Usiądź.'},
        ]}
        result = self.scenarist.write_scene(
            user_prompt='Pradziadek zaprasza Maćka.', context={'characters': []},
            beats=['Pradziadek zaprasza Maćka do stołu.'],
        )
        self.assertEqual(result, 'PRADZIADEK\n\nUsiądź.')
        self.assertEqual(self.requests[0]['format'], GeneratedScene.model_json_schema())

    def test_adds_generated_heading_for_an_explicitly_empty_scene(self):
        self.reply['heading'] = {'location_type': 'PL.', 'location_heading': 'peron', 'time_of_day': 'NOC'}

        result = self.scenarist.write_scene(
            user_prompt='Napisz otwarcie.', context={'scene': {}}, beats=['Marta rusza na peron.'],
        )

        self.assertEqual(result, 'PL. PERON - NOC\n\nMarta rusza na peron.')
        request, = self.requests
        self.assertEqual(request['format'], GeneratedSceneWithHeading.model_json_schema())

    def test_does_not_request_a_heading_for_an_existing_heading_or_saved_text(self):
        for scene in (
            {'location_heading': 'WN. DWORZEC'},
            {'content_text': 'Marta otrzymuje bilet.'},
            {'editor_metadata': {'blocks': [{'id': 'action-1', 'type': 'action',
                                             'text': 'Marta otrzymuje bilet.'}]}},
        ):
            with self.subTest(scene=scene):
                result = self.scenarist.write_scene(
                    user_prompt='Kontynuuj.', context={'scene': scene}, beats=['Marta rusza na peron.'],
                )

                self.assertEqual(result, 'Marta rusza na peron.')
                self.assertEqual(self.requests[-1]['format'], GeneratedScene.model_json_schema())

    def test_continuation_omits_repeated_prefix_and_respects_parenthetical_preference(self):
        self.reply = {'blocks': [
            {'type': 'action', 'text': 'Marta otrzymuje bilet. Chowa go do kieszeni.'},
            {'type': 'speech', 'speaker': 'Marta', 'parenthetical': 'z ulgą', 'spoken_text': 'Zdążę.'},
        ]}

        result = self.scenarist.write_scene(
            user_prompt='Kontynuuj.',
            context={
                'scene': {'content_text': 'Marta otrzymuje bilet.'},
                'writing_style_preferences': {'parentheticals': 'ignore'},
            },
            beats=['Marta chowa bilet do kieszeni.'],
        )

        self.assertEqual(result, 'Chowa go do kieszeni.\n\nMARTA\n\nZdążę.')

    def test_reusing_scenarist_keeps_requests_separate(self):
        first = {'characters': [{'name': 'Marta', 'profile': 'Szuka biletu.'}]}
        second = {'characters': [{'name': 'Jan', 'profile': 'Szuka klucza.'}]}
        first_result = self.scenarist.write_scene(
            user_prompt='Napisz o Marcie.', context=first, beats=['Marta rusza na peron.'],
        )
        self.reply = {'blocks': [{'type': 'action', 'text': 'Jan otwiera garaż.'}]}
        second_result = self.scenarist.write_scene(
            user_prompt='Napisz o Janie.', context=second, beats=['Jan otwiera garaż.'],
        )

        self.assertEqual(first_result, 'Marta rusza na peron.')
        self.assertEqual(second_result, 'Jan otwiera garaż.')
        self.assertEqual(self.requests[0]['format']['$defs']['CastGeneratedSpeech']['properties']['speaker']['const'], 'MARTA')
        self.assertEqual(self.requests[1]['format']['$defs']['CastGeneratedSpeech']['properties']['speaker']['const'], 'JAN')
        self.assertEqual(
            [json.loads(request['messages'][1]['content']) for request in self.requests],
            [
                {'user_prompt': 'Napisz o Marcie.', 'context': first, 'beats': ['Marta rusza na peron.']},
                {'user_prompt': 'Napisz o Janie.', 'context': second, 'beats': ['Jan otwiera garaż.']},
            ],
        )

    def test_rejects_blank_instruction_and_invalid_plan_before_calling_ollama(self):
        with self.assertRaisesRegex(ValueError, 'Podaj polecenie autora'):
            self.scenarist.write_scene(user_prompt=' \n ', context={}, beats=['Marta rusza na peron.'])
        for beats in ([], ['MARTA: Oddaj bilet.']):
            with self.subTest(beats=beats), self.assertRaises(ValidationError):
                self.scenarist.write_scene(user_prompt='Napisz scenę.', context={}, beats=beats)

        self.assertEqual(self.requests, [])

    def test_rejects_invalid_structured_responses(self):
        for scene, reply in (
            ({}, {'blocks': [{'type': 'action', 'text': 'Marta rusza na peron.'}]}),
            ({'location_heading': 'WN. DWORZEC'}, {'blocks': []}),
            ({'location_heading': 'WN. DWORZEC'}, {'blocks': [
                {'type': 'speech', 'speaker': 'Marta', 'parenthetical': None},
            ]}),
        ):
            with self.subTest(scene=scene, reply=reply), self.assertRaises(OutputParserException):
                self.reply = reply
                self.scenarist.write_scene(
                    user_prompt='Napisz scenę.', context={'scene': scene}, beats=['Marta rusza na peron.'],
                )

    def test_rejects_a_transition_hidden_inside_action(self):
        self.reply = {'blocks': [
            {'type': 'action', 'text': 'Marta wychodzi.\nCIĘCIE DO:\nPL. PERON - NOC'},
        ]}

        with self.assertRaises(SceneStructureError):
            self.scenarist.write_scene(
                user_prompt='Kontynuuj.', context={}, beats=['Marta kończy rozmowę.'],
            )
