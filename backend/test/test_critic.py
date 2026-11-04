import json

import httpx
from django.test import SimpleTestCase
from langchain_core.exceptions import OutputParserException
from langchain_ollama import ChatOllama

from backend.agents.critic import CriticAgent, PromptReview, SceneReview
from backend.ollama import OLLAMA_BASE_URL, OLLAMA_MODEL


class CriticAgentTests(SimpleTestCase):
    def setUp(self):
        self.requests = []
        self.reply = None
        transport = httpx.MockTransport(self.respond)
        self.critic = CriticAgent(ChatOllama(
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

    def test_blank_prompt_requests_clarification_without_calling_ollama(self):
        review = self.critic.review_prompt(' \n\t ')

        self.assertEqual(review.verdict, 'needs_clarification')
        self.assertTrue(review.feedback)
        self.assertEqual(self.requests, [])

    def test_prompt_review_parses_both_verdicts_and_sends_context(self):
        context = {'scene': {'title': 'Powrót', 'ai_metadata': {'scene_goal': 'Odkrycie prawdy'}}}
        for prompt, verdict in [('Wymyśl coś dalej', 'accepted'), ('adada', 'needs_clarification')]:
            with self.subTest(prompt=prompt):
                self.reply = {'verdict': verdict, 'feedback': 'Wynik oceny.'}
                review = self.critic.review_prompt(prompt, context=context)

                self.assertIsInstance(review, PromptReview)
                self.assertEqual(review.model_dump(), self.reply)
                request = self.requests[-1]
                self.assertEqual(request['format'], PromptReview.model_json_schema())
                self.assertEqual([message['role'] for message in request['messages']], ['system', 'user'])
                self.assertEqual(json.loads(request['messages'][1]['content']), {
                    'user_prompt': prompt, 'context': context,
                })

    def test_scene_review_preserves_findings_and_flags_required_revision(self):
        context = {
            'characters': [{'name': 'ANNA', 'fears': 'Ogień'}],
            'previous_scenes': [{'summary': 'Anna zgubiła klucz.'}],
            'scene': {'ai_metadata': {'scene_goal': 'Odnalezienie wyjścia'}},
        }
        scene_text = 'ANNA\n\nUwielbiam ogień. Mam przy sobie klucz.'
        prompt = 'Anna szuka wyjścia.'
        self.reply = {
            'score': 4, 'feedback': 'Popraw ciągłość i zachowanie Anny.',
            'findings': [
                {'category': 'character', 'severity': 'required',
                 'issue': 'Anna uwielbia ogień.', 'suggestion': 'Pokaż jej lęk.'},
                {'category': 'continuity', 'severity': 'required',
                 'issue': 'Anna ma utracony klucz.', 'suggestion': 'Wyjaśnij, jak odzyskała klucz.'},
                {'category': 'prompt_alignment', 'severity': 'required',
                 'issue': 'Anna nie szuka wyjścia.', 'suggestion': 'Pokaż, jak szuka drogi ucieczki.'},
                {'category': 'screenplay_format', 'severity': 'advisory',
                 'issue': 'Brakuje akcji między kwestiami.', 'suggestion': 'Rozważ osobny blok akcji.'},
            ],
        }

        review = self.critic.review_scene(scene_text, user_prompt=prompt, context=context)

        self.assertIsInstance(review, SceneReview)
        self.assertEqual(review.model_dump(), {**self.reply, 'needs_revision': True})
        request, = self.requests
        self.assertEqual(request['format'], SceneReview.model_json_schema())
        self.assertEqual(json.loads(request['messages'][1]['content']), {
            'scene_text': scene_text, 'user_prompt': prompt, 'context': context,
        })

    def test_scene_review_with_only_advice_or_no_findings_passes(self):
        advice = {'category': 'screenplay_format', 'severity': 'advisory',
                  'issue': 'Długi blok akcji.', 'suggestion': 'Rozważ podział na dwa bloki.'}
        for findings in ([], [advice]):
            with self.subTest(findings=findings):
                self.reply = {'score': 9, 'feedback': 'Spójna kontynuacja.', 'findings': findings}
                review = self.critic.review_scene('Anna otwiera drzwi.', user_prompt='Kontynuuj.')

                self.assertFalse(review.needs_revision)

    def test_blank_scene_is_rejected_without_calling_ollama(self):
        with self.assertRaisesRegex(ValueError, 'Podaj tekst sceny'):
            self.critic.review_scene(' \n ', user_prompt='Kontynuuj.')

        self.assertEqual(self.requests, [])

    def test_invalid_model_responses_are_rejected(self):
        self.reply = {'verdict': 'maybe', 'feedback': 'Ocena.'}
        with self.assertRaises(OutputParserException):
            self.critic.review_prompt('Kontynuuj.')

        unknown_category = {'category': 'other', 'severity': 'required',
                            'issue': 'Problem.', 'suggestion': 'Poprawka.'}
        for score, findings in [(11, []), (5, [unknown_category])]:
            with self.subTest(score=score, findings=findings):
                self.reply = {'score': score, 'feedback': 'Ocena.', 'findings': findings}
                with self.assertRaises(OutputParserException):
                    self.critic.review_scene('Anna otwiera drzwi.', user_prompt='Kontynuuj.')
