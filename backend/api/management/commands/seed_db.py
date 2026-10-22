import os
from collections import Counter
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.exceptions import MultipleObjectsReturned, ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from backend.api.models import (
    Act, AgentExecution, Character, GenerationRun, Project, Scene,
    SceneCharacter, SceneGenerationRequest, SceneVariant, User, UserProfile,
)


SEED_KEY = 'agentdraft_demo_v1'
DEMO_PROJECTS = [
    {
        'key': 'night-tram',
        'username': 'demo_writer',
        'email': 'demo.writer@example.com',
        'display_name': 'Demo Writer',
        'title': 'Ostatni kurs',
        'genre': 'Dramat / thriller',
        'logline': 'Motornicza podczas nocnego kursu odkrywa tajemnicę swojej rodziny.',
        'synopsis': 'Anna odbiera telefon od brata. Wizyta na pustym przystanku prowadzi ją do prawdy o zaginionym ojcu.',
        'target_audience': 'Dorośli widzowie dramatów psychologicznych',
        'characters': [
            {'name': 'ANNA', 'role': 'Protagonistka, motornicza', 'age': 32,
             'appearance': 'Granatowy mundur, ciemne włosy spięte z tyłu.',
             'backstory': 'Od lat szuka zaginionego ojca.',
             'goals': 'Poznać prawdę o rodzinie.', 'fears': 'Utrata kontaktu z bratem.',
             'psychological_profile': 'Uważna i nieufna, pod presją unika rozmowy.'},
            {'name': 'TOMEK', 'role': 'Brat Anny', 'age': 34,
             'appearance': 'Sportowa kurtka, telefon stale w dłoni.',
             'backstory': 'Ukrył przed siostrą list od ojca.',
             'goals': 'Ochronić siostrę.', 'fears': 'Ujawnienie rodzinnego sekretu.',
             'psychological_profile': 'Troskliwy, lecz skłonny do kontroli.'},
        ],
        'scenes': [
            {'title': 'Nocny telefon', 'act_title': 'Ostatni pasażer', 'heading': 'WN. ZAJEZDNIA - NOC', 'time': 'NOC',
             'summary': 'Telefon od brata przerywa przygotowania Anny do ostatniego kursu.', 'cast': [0, 1],
             'blocks': [('action', 'Anna sprawdza pulpit tramwaju. Telefon wibruje.'), ('character', 'TOMEK'), ('dialogue', 'Wracasz po zmianie?'), ('character', 'ANNA'), ('dialogue', 'Jeszcze jeden kurs.')]},
            {'title': 'Pusty przystanek', 'act_title': 'Ślady przeszłości', 'heading': 'PL. PRZYSTANEK - NOC', 'time': 'NOC',
             'summary': 'Anna znajduje kopertę z adresem dawnej nastawni.', 'cast': [0],
             'blocks': [('action', 'Anna zatrzymuje tramwaj. Na ławce leży koperta podpisana jej imieniem. Przez chwilę nie otwiera drzwi.')]},
            {'title': 'Pierwszy kurs', 'act_title': 'Powrót', 'heading': 'WN. TRAMWAJ - ŚWIT', 'time': 'ŚWIT',
             'summary': 'Anna i Tomek decydują, co zrobić z listem ojca.', 'cast': [0, 1],
             'blocks': [('action', 'Anna siada obok Tomka. Pomiędzy nimi leży otwarta koperta.'), ('character', 'ANNA'), ('dialogue', 'Tym razem przeczytamy go razem.'), ('character', 'TOMEK'), ('dialogue', 'Dobrze.')]},
        ],
    },
    {
        'key': 'signal',
        'username': 'demo_editor',
        'email': 'demo.editor@example.com',
        'display_name': 'Demo Editor',
        'title': 'Sygnał',
        'genre': 'Science fiction / krótki metraż',
        'logline': 'Techniczka radiowa odbiera wiadomość nadaną własnym głosem z przyszłości.',
        'synopsis': 'Ewa i Leon szukają źródła nietypowego sygnału. Kolejne nagranie zmusza ich do podjęcia decyzji, której konsekwencje już słyszeli.',
        'target_audience': 'Widzowie kameralnego science fiction',
        'characters': [
            {'name': 'EWA', 'role': 'Protagonistka, techniczka', 'age': 29,
             'appearance': 'Okulary w cienkich oprawkach, robocza bluza.',
             'backstory': 'Po studiach została na niewielkiej stacji radiowej.',
             'goals': 'Ustalić źródło sygnału.', 'fears': 'Utrata kontroli nad własnymi decyzjami.',
             'psychological_profile': 'Precyzyjna i sceptyczna, ufa pomiarom.'},
            {'name': 'LEON', 'role': 'Realizator dźwięku', 'age': 41,
             'appearance': 'Siwiejące włosy, słuchawki przewieszone przez szyję.',
             'backstory': 'Pracował przy zamkniętym eksperymencie radiowym.',
             'goals': 'Pomóc Ewie przerwać transmisję.', 'fears': 'Powtórzenie dawnego błędu.',
             'psychological_profile': 'Spokojny obserwator, ukrywa poczucie winy.'},
        ],
        'scenes': [
            {'title': 'Częstotliwość', 'act_title': 'Transmisja', 'heading': 'WN. STACJA RADIOWA - WIECZÓR', 'time': 'WIECZÓR',
             'summary': 'Ewa i Leon rozpoznają głos w nieznanej transmisji.', 'cast': [0, 1],
             'blocks': [('action', 'Ewa dostraja odbiornik. Leon zatrzymuje taśmę.'), ('character', 'EWA'), ('dialogue', 'To mój głos.'), ('character', 'LEON'), ('dialogue', 'Sprawdź datę nagrania.')]},
            {'title': 'Zakłócenia', 'act_title': 'Źródło', 'heading': 'WN. ARCHIWUM NAGRAŃ - NOC', 'time': 'NOC',
             'summary': 'Ewa znajduje dokumentację dawnego eksperymentu.', 'cast': [0],
             'blocks': [('action', 'Ewa rozkłada stare schematy. Na marginesie ktoś zapisał częstotliwość, której właśnie słuchała.')]},
            {'title': 'Odpowiedź', 'act_title': 'Decyzja', 'heading': 'WN. STUDIO RADIOWE - RANO', 'time': 'RANO',
             'summary': 'Ewa i Leon nadają wiadomość, która może zmienić ich przyszłość.', 'cast': [0, 1],
             'blocks': [('action', 'Leon włącza mikrofon. Ewa patrzy na pustą kartkę.'), ('character', 'EWA'), ('dialogue', 'Nie powtórzymy tego, co usłyszeliśmy.'), ('character', 'LEON'), ('dialogue', 'Zacznij od początku.')]},
        ],
    },
]
AGENTS = [('Archiwista', 'context', 120), ('Reżyser', 'outline', 180), ('Scenarzysta', 'write', 400), ('Krytyk', 'review', 250)]
MODELS = (User, UserProfile, Project, Act, Character, Scene, SceneCharacter,
          SceneGenerationRequest, GenerationRun, AgentExecution, SceneVariant)


class Command(BaseCommand):
    help = 'Create related, repeatable demo data for all ERD models without overwriting existing records.'
    requires_migrations_checks = True

    def add_arguments(self, parser):
        parser.add_argument('--password', help='Initial demo account password; defaults to SEED_DEMO_PASSWORD.')

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('seed_db is only available for local development (DJANGO_DEBUG=True).')
        password = options['password'] or os.environ.get('SEED_DEMO_PASSWORD', '')
        if len(password) < 12:
            raise CommandError('Set SEED_DEMO_PASSWORD or --password to at least 12 characters.')
        self.created = Counter()
        try:
            with transaction.atomic():
                if connection.vendor == 'postgresql':
                    # Serialize concurrent seeds; JSON lookup keys have no unique DB constraint.
                    with connection.cursor() as cursor:
                        cursor.execute('SELECT pg_advisory_xact_lock(%s)', [742396210])
                for spec in DEMO_PROJECTS:
                    self.seed_project(spec, password)
        except (ValidationError, IntegrityError, MultipleObjectsReturned) as error:
            raise CommandError(f'Seeding failed; all changes were rolled back: {error}') from error
        for model in MODELS:
            self.stdout.write(f'{model.__name__}: {self.created[model.__name__]} created')
        self.stdout.write(self.style.SUCCESS('Demo data ready. Existing data and passwords were preserved.'))

    def ensure(self, model, *, defaults=None, **lookup):
        instance, created = model.objects.get_or_create(defaults=defaults or {}, **lookup)
        instance.full_clean()
        self.created[model.__name__] += int(created)
        return instance

    def seed_project(self, spec, password):
        user = self.ensure(User, username=spec['username'], defaults={
            'email': spec['email'], 'password': lambda: make_password(password),
            'is_staff': False, 'is_superuser': False,
        })
        if user.email != spec['email']:
            raise CommandError(f'Reserved demo username {spec["username"]} belongs to another email. No data was changed.')
        self.ensure(UserProfile, user=user, defaults={
            'display_name': spec['display_name'], 'preferred_language': 'pl',
            'writing_style_preferences': {'stage_directions_style': 'concise_technical', 'dialogue_tone': 'Neutralny, realistyczny', 'parentheticals': 'sparingly'},
            'llm_preferences': {'model_name': 'Bielik 11B (Lokalny)', 'temperature': 0.7, 'max_tokens': 2048},
        })
        seed_key = f'{SEED_KEY}:{spec["key"]}'
        project = self.ensure(Project, user=user, metadata__seed_key=seed_key, defaults={
            **{field: spec[field] for field in ('title', 'genre', 'logline', 'synopsis', 'target_audience')},
            'screenplay_format': 'fountain', 'status': 'draft', 'metadata': {'seed_key': seed_key},
        })
        characters = [self.ensure(Character, project=project, memory_metadata__seed_key=f'{seed_key}:character:{index}', defaults={
            **character, 'voice_profile': {'style': 'natural', 'language': 'pl'},
            'memory_metadata': {'seed_key': f'{seed_key}:character:{index}', 'facts': [character['backstory']]},
        }) for index, character in enumerate(spec['characters'], 1)]
        for number, item in enumerate(spec['scenes'], 1):
            act = self.ensure(Act, project=project, act_number=number, defaults={
                'title': item['act_title'], 'sort_order': number - 1,
                'summary': item['summary'], 'metadata': {'seed_key': f'{seed_key}:act:{number}'},
            })
            blocks = [{'id': f'{spec["key"]}-{number}-{index}', 'type': kind, 'text': text}
                      for index, (kind, text) in enumerate(item['blocks'], 1)]
            text = item['heading'] + '\n\n' + '\n\n'.join(block['text'] for block in blocks)
            scene = self.ensure(Scene, project=project, scene_number=number, defaults={
                'act': act, 'sort_order': number - 1, 'title': item['title'],
                'location_heading': item['heading'], 'time_of_day': item['time'], 'content_text': text,
                'ai_metadata': {'seed_key': f'{seed_key}:scene:{number}', 'scene_goal': item['summary'], 'notes': 'Dane przykładowe.'},
                'editor_metadata': {'blocks': blocks, 'zoom': 100},
            })
            for index in item['cast']:
                self.ensure(SceneCharacter, scene=scene, character=characters[index], defaults={
                    'presence_type': 'on_screen', 'notes': 'Udział w scenie przykładowej.',
                })
            self.seed_generation(scene, seed_key, number)

    def seed_generation(self, scene, project_key, number):
        key = f'{project_key}:scene:{number}:request'
        request = self.ensure(SceneGenerationRequest, scene=scene, context_snapshot__seed_key=key, defaults={
            'user_prompt': f'Rozwiń scenę „{scene.title}”. Zachowaj oszczędne dialogi i napięcie budowane przez podtekst.',
            'system_prompt': 'Piszesz scenariusz filmowy w formacie Fountain. Zachowaj spójność postaci i kontekstu.',
            'model_name': 'Bielik 11B', 'generation_parameters': {'temperature': 0.7, 'max_tokens': 2048},
            'context_snapshot': {'seed_key': key, 'project_id': scene.project_id, 'scene_id': scene.pk,
                                 'act_number': scene.act.act_number, 'characters': list(scene.characters.values_list('name', flat=True))},
        })
        started = timezone.now() - timedelta(days=number)
        duration = sum(item[2] for item in AGENTS)
        run = self.ensure(GenerationRun, request=request, defaults={
            'status': 'completed', 'langgraph_thread_id': key,
            'started_at': started, 'finished_at': started + timedelta(milliseconds=duration),
            'total_duration_ms': duration, 'run_metadata': {'seed_key': key, 'source': 'seed_db', 'simulated': True},
        })
        run_started = run.started_at or started
        elapsed = 0
        for agent_name, node, duration in AGENTS:
            self.ensure(AgentExecution, run=run, node_name=node, defaults={
                'agent_name': agent_name, 'status': 'completed',
                'started_at': run_started + timedelta(milliseconds=elapsed),
                'finished_at': run_started + timedelta(milliseconds=elapsed + duration),
                'duration_ms': duration, 'input_payload': {'scene_id': scene.pk, 'prompt': request.user_prompt},
                'output_payload': {'result': 'ok', 'node': node, 'simulated': True},
                'logs': {'events': [{'level': 'info', 'message': f'Demo node {node} completed.'}]},
            })
            elapsed += duration
        for variant_number, (title, score) in enumerate([('Podtekst', '8.75'), ('Konfrontacja', '8.25')], 1):
            self.ensure(SceneVariant, run=run, variant_number=variant_number, defaults={
                'scene': scene, 'title': title,
                'generated_full_text': scene.content_text + f'\n\n{title}: zapada cisza, zanim pada odpowiedź.',
                'critic_score': Decimal(score), 'critic_feedback': 'Spójna scena. Dobrze utrzymane napięcie.',
                'critic_metadata': {'seed_key': key, 'simulated': True, 'consistency': 'ok'},
                'is_selected': variant_number == 1,
            })
