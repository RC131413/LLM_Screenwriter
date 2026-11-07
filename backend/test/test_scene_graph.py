import json
from unittest.mock import patch

import httpx
from django.test import SimpleTestCase
from langchain_ollama import ChatOllama

from backend.agents.archivist import ArchivedContext
from backend.agents.graph import MAX_REVISIONS, build_scene_graph
from backend.ollama import OLLAMA_MODEL


ARCHIVE = {'characters': [], 'previous_scenes': [], 'continuity_facts': [], 'open_threads': []}
PLAN = {'beats': ['Marta znajduje bilet.']}
REQUIRED_CHANGE = {
    'category': 'prompt_alignment', 'severity': 'required',
    'issue': 'Marta nie znajduje biletu.', 'suggestion': 'Pokaż, jak Marta znajduje bilet.',
}
ADVICE = {
    'category': 'screenplay_format', 'severity': 'advisory',
    'issue': 'Opis można skrócić.', 'suggestion': 'Skróć opis otoczenia.',
}


def draft(text):
    return {'blocks': [{'type': 'action', 'text': text}]}


class SceneGraphTests(SimpleTestCase):
    def run_graph(self, replies, *, archived_context=None, context=None):
        self.requests = []
        responses = iter([*([ARCHIVE] if archived_context is None else []), PLAN, *replies])

        def respond(request):
            self.assertEqual((request.method, request.url.path), ('POST', '/api/chat'))
            payload = json.loads(request.content)
            self.requests.append(json.loads(payload['messages'][-1]['content']))
            response = next(responses, None)
            self.assertIsNotNone(response, 'Graf wykonał dodatkowe wywołanie Ollamy.')
            chunk = {
                'model': OLLAMA_MODEL, 'message': {'role': 'assistant', 'content': json.dumps(response)},
                'done': True, 'done_reason': 'stop',
            }
            return httpx.Response(200, text=json.dumps(chunk) + '\n')

        model = ChatOllama(model=OLLAMA_MODEL, client_kwargs={'transport': httpx.MockTransport(respond)})
        with (
            patch('backend.agents.archivist.create_local_chat_model', return_value=model),
            patch('backend.agents.director.create_local_chat_model', return_value=model),
            patch('backend.agents.scenarist.create_local_chat_model', return_value=model),
            patch('backend.agents.critic.create_local_chat_model', return_value=model),
        ):
            graph = build_scene_graph()
        state = {
            'user_prompt': 'Marta ma odnaleźć bilet.',
            'context': context if context is not None else {'scene': {'location_heading': 'WN. DWORZEC'}},
        }
        if archived_context is not None:
            state['archived_context'] = archived_context
        result = graph.invoke(state)
        self.assertIsNone(next(responses, None), 'Graf skończył przed wykonaniem oczekiwanych węzłów.')
        return result

    def test_selected_names_survive_profiles_omitted_from_the_archive(self):
        result = self.run_graph([
            {'blocks': [{'type': 'speech', 'speaker': 'OLEK', 'parenthetical': None,
                         'spoken_text': 'Znalazłem twój bilet.'}]},
            {'score': 9, 'feedback': 'Scena spójna.', 'findings': []},
        ], context={
            'scene': {'location_heading': 'WN. DWORZEC'},
            'characters': [{'name': 'Marta'}, {'name': 'Olek'}],
        })

        self.assertEqual(self.requests[2]['context']['characters'], [])
        self.assertEqual(self.requests[2]['context']['selected_character_names'], ['Marta', 'Olek'])
        self.assertEqual(result['scene_blocks'][0]['text'], 'OLEK')

    def test_prepared_archive_is_reused_without_another_archivist_call(self):
        archived = ArchivedContext(
            characters=[{'name': 'Marta', 'profile': 'Szuka biletu do domu.'}],
            previous_scenes=[{'scene_number': 1, 'summary': 'Marta gubi bilet na dworcu.'}],
            continuity_facts=['Bilet został na dworcu.'], open_threads=[],
        )
        before = archived.model_dump()
        result = self.run_graph([
            draft('Marta znajduje bilet pod ławką.'),
            {'score': 9, 'feedback': 'Plan zrealizowany.', 'findings': []},
        ], archived_context=archived)

        self.assertEqual(len(self.requests), 3)
        for request in self.requests:
            for field, value in before.items():
                self.assertEqual(request['context'][field], value)
        self.assertEqual(result['archived_context'], archived)
        self.assertEqual(archived.model_dump(), before)
        self.assertEqual(result['review_status'], 'accepted')

    def test_advice_alone_does_not_trigger_a_revision(self):
        text = 'Marta znajduje bilet pod ławką.'
        result = self.run_graph([draft(text), {'score': 8, 'feedback': 'Drobna sugestia.', 'findings': [ADVICE]}])

        self.assertEqual(result['scene_text'], text)
        self.assertEqual([(block['type'], block['text']) for block in result['scene_blocks']], [('action', text)])
        self.assertIsNone(result['scene_heading'])
        self.assertEqual(result['review_status'], 'accepted')
        self.assertEqual(result['revision_count'], 0)
        self.assertEqual(result['critic_feedback'], 'Drobna sugestia.')
        self.assertEqual(self.requests[-1]['scene_text'], text)
        self.assertEqual(self.requests[-1]['context']['beats'], PLAN['beats'])

    def test_rewrites_the_previous_draft_with_required_feedback_then_stops_when_accepted(self):
        first = 'Marta przeszukuje kieszenie.'
        revised = 'Marta znajduje bilet pod ławką.'
        result = self.run_graph([
            draft(first), {'score': 5, 'feedback': 'Brakuje odkrycia.', 'findings': [REQUIRED_CHANGE, ADVICE]},
            draft(revised), {'score': 9, 'feedback': 'Plan zrealizowany.', 'findings': []},
        ])

        self.assertNotIn('revision', self.requests[2])
        self.assertEqual(self.requests[4]['revision'], {
            'previous_draft': first, 'feedback': 'Brakuje odkrycia.', 'required_changes': [REQUIRED_CHANGE],
        })
        self.assertEqual(self.requests[4]['beats'], PLAN['beats'])
        self.assertEqual(self.requests[4]['context'], self.requests[2]['context'])
        self.assertEqual(self.requests[5]['scene_text'], revised)
        self.assertEqual(result['scene_text'], revised)
        self.assertEqual(result['review_status'], 'accepted')
        self.assertEqual(result['revision_count'], 1)
        self.assertEqual(result['critic_feedback'], 'Plan zrealizowany.')

    def test_persistent_required_changes_stop_at_the_revision_limit(self):
        replies = []
        for attempt in range(MAX_REVISIONS + 1):
            replies.extend([
                draft(f'Marta nadal szuka biletu. Próba {attempt}.'),
                {'score': 5, 'feedback': f'Brakuje odkrycia w próbie {attempt}.', 'findings': [REQUIRED_CHANGE]},
            ])

        result = self.run_graph(replies)

        self.assertEqual(result['revision_count'], MAX_REVISIONS)
        self.assertEqual(result['review_status'], 'revision_limit_reached')
        self.assertTrue(result['critic_review'].needs_revision)
        self.assertEqual(result['critic_feedback'], replies[-1]['feedback'])
        self.assertEqual(result['scene_text'], replies[-2]['blocks'][0]['text'])
        self.assertEqual(self.requests[-2]['revision']['previous_draft'], replies[-4]['blocks'][0]['text'])
        self.assertEqual(self.requests[-2]['revision']['feedback'], replies[-3]['feedback'])
