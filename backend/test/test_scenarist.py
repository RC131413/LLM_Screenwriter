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
        self.assertEqual(request['format'], GeneratedScene.model_json_schema())
        self.assertEqual([message['role'] for message in request['messages']], ['system', 'user'])
        self.assertEqual(json.loads(request['messages'][1]['content']), {
            'user_prompt': prompt, 'context': original, 'beats': beats,
        })

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
