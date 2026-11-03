"""Ownership checks and shared write operations for the HTTP API."""

import json
from datetime import timedelta
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.db.models import JSONField
from django.db import connections
from django.shortcuts import get_object_or_404
from django.utils import timezone

from .models import (
    Act, AgentExecution, Character, GenerationRun, Project, Scene,
    SceneCharacter, SceneGenerationRequest, SceneVariant, UserProfile,
)
from .scheams import PreferencesIn


OWNER_PATHS = {
    Project: 'user',
    Act: 'project__user',
    Character: 'project__user',
    Scene: 'project__user',
    SceneCharacter: 'scene__project__user',
    SceneGenerationRequest: 'scene__project__user',
    GenerationRun: 'request__scene__project__user',
    AgentExecution: 'run__request__scene__project__user',
    SceneVariant: 'scene__project__user',
}


SCENE_GENERATION_SYSTEM_PROMPT = (
    'Jesteś polskim scenarzystą. Napisz nowy fragment sceny zgodnie z celem i poleceniem autora. '
    'Kontynuuj zapisaną scenę bez cytowania ani przepisywania jej końcówki; pustą scenę rozpocznij. '
    'Zwróć jeden JSON z blocks, bez Markdown. Rodzaje bloków:\n'
    'action: type, text. Widoczna akcja lub otoczenie, trzecia osoba, czas teraźniejszy. '
    'Światło i ruchy postaci należą tutaj. Myśli i emocje pokaż gestem lub wypowiedzią.\n'
    'speech: type, speaker (nazwa postaci), parenthetical (krótka wskazówka aktorska lub null), '
    'spoken_text (tylko słowa wypowiedziane na głos, bez opisów otoczenia i ruchów). '
    'Nie twórz osobnych character, dialogue ani parenthetical.\n'
    'Każdy wynik to fragment jednej sceny. Bloki zawierają wyłącznie akcję i wypowiedzi. '
    'Zakończ przed zmianą miejsca lub czasu. Nie wpisuj przejść ani kolejnych nagłówków do blocks.\n'
    'Przykład: {"blocks":[{"type":"action","text":"Światło pada na twarz Anny. Anna otwiera list."},'
    '{"type":"speech","speaker":"ANNA","parenthetical":null,"spoken_text":"To niemożliwe."},'
    '{"type":"action","text":"Anna odkłada list."}]}. '
)

SCENE_VARIANT_APPROACHES = (
    'Zrównoważ akcję i dialog odpowiednio do sceny. Jeśli postacie rozmawiają, pokaż ich słowa w osobnych blokach speech.',
    'Połóż nacisk na relację i podtekst. Jeśli dochodzi do rozmowy, pokaż krótką wymianę kwestii, w której każda coś zmienia.',
    'Połóż nacisk na obraz i działanie. Pokaż odkrycie przez gest, przedmiot lub decyzję. Zachowaj kwestie niezbędne dla sceny.',
)


def scene_generation_prompt(prompt):
    """Use the frozen database snapshot, never scene text supplied by the browser."""
    scene = prompt.context_snapshot['scene']
    from .screenplay import can_generate_heading
    heading_instruction = (
        'Scena jest pusta i nie ma nagłówka. Najpierw ustal miejsce pierwszego działania na podstawie polecenia '
        'i celu sceny, a następnie zapisz heading i dopiero potem blocks. '
        'location_type wybierz według tego, czy pierwsza akcja dzieje się we wnętrzu (WN.) czy w plenerze (PL.). '
        'location_heading to nazwa tego samego miejsca, bez prefiksu i pory dnia. '
        'time_of_day to pora pierwszej akcji. Cały fragment rozegraj w miejscu i czasie podanym w heading.'
        if can_generate_heading(scene) else
        'Nie wymyślaj ani nie zwracaj nagłówka. Istniejący nagłówek i pora dnia pozostają bez zmian.'
    )
    metadata = scene.get('ai_metadata', {})
    goal = metadata.get('scene_goal', '')
    notes = metadata.get('notes', '')
    style = prompt.context_snapshot.get('writing_style_preferences', {})
    action_style = 'Zwięzły, techniczny opis widocznej akcji.' if style.get('stage_directions_style') != 'literary_descriptive' else 'Opis może być literacki, ale dotyczy wyłącznie tego, co można pokazać lub usłyszeć.'
    parentheticals = (
        'Nie używaj wskazówek w nawiasach; parenthetical zawsze null.'
        if style.get('parentheticals') == 'ignore' else
        'Używaj krótkich, konkretnych didaskaliów w nawiasach tam, gdzie pomagają zagrać kwestię: '
        'dla intencji, pauzy albo zmiany sposobu mówienia wynikającej z sytuacji. Zwykle 1–4 słowa. '
        'W polu parenthetical wpisz samą wskazówkę, np. „po krótkiej pauzie”, bez imienia postaci i pełnego zdania. '
        'W dłuższej rozmowie poszukaj jednego ważnego momentu dla krótkiej wskazówki, np. pauzy przed wyznaniem lub półgłosu przy zdradzaniu sekretu. '
        'Pozostałe kwestie zwykle zostaw bez wskazówek. '
        'Nie dopisuj didaskaliów mechanicznie do każdej kwestii ani nie wymyślaj ich wbrew kontekstowi. '
        'Samotność postaci nie jest powodem do określania sposobu mówienia ani adresata. '
        'Ustalony sposób mówienia utrzymuje się w kolejnych kwestiach; oznacz dopiero jego istotną zmianę. '
        'Unikaj powtarzania wskazówek i zastępowania ich synonimami. Ruchy, gesty i objaśnienia należą do action.'
    )
    cast = ', '.join(character['name'] for character in prompt.context_snapshot.get('characters', []))
    composition = (
        'Dialog jest opcjonalny. Dobierz akcję i wypowiedzi do sytuacji i polecenia autora; scena może być całkowicie niema. '
        'Nie dopisuj samotnej postaci monologu tylko po to, żeby powstał dialog. '
        'Zrób jeden konkretny krok w stronę celu: drobne odkrycie, przeszkodę lub decyzję wynikającą z sytuacji. '
        'Każdy akapit rozwija ten krok; zastępuj powtarzane pytania i gesty nowym działaniem. '
        'Każde nowe działanie zapisz w osobnym krótkim bloku action. Jeśli postacie rozmawiają, podaj ich rzeczywiste słowa w speech zamiast streszczać rozmowę w action. '
        'Pisz wyłącznie to, co kamera widzi lub mikrofon słyszy; emocje wyrażaj zachowaniem. '
        'Zachowaj ustalone fakty, stan wiedzy bohatera i dokładne imiona. '
        'Jedna scena ma jedno miejsce i porę dnia. Jeśli dalsze wydarzenia wymagają innej lokalizacji lub przeskoku w czasie, zakończ przed nimi. '
        'Domyślnie 3–5 krótkich bloków po 1–2 zdania; długość podana przez autora ma pierwszeństwo. '
        'Finał to konkretna czynność, trop lub decyzja, bez przedwczesnego rozwiązania całej zagadki.'
    )
    location = scene.get('location_heading', '').strip()
    if location.upper().startswith('WN.'):
        setting = f'WEWNĄTRZ: {location}. Cała akcja tego fragmentu pozostaje we wnętrzu; zakończ go przed wyjściem bohatera.'
    elif location.upper().startswith('PL.'):
        setting = f'PLENER: {location}. Cała akcja tego fragmentu pozostaje na zewnątrz; zakończ go przed wejściem do wnętrza.'
    else:
        setting = location or 'Wybierz jedno miejsce dla nagłówka i utrzymaj w nim cały fragment.'
    return (
        f'{prompt.system_prompt}\n\n'
        f'{heading_instruction}\n\n'
        f'KOMPOZYCJA SCENY:\n{composition}\n\n'
        f'ZASADY STYLU:\n{action_style}\n{parentheticals}\n'
        f'Ton dialogów: {style.get("dialogue_tone", "Neutralny, realistyczny")}\n\n'
        f'CEL SCENY (kierunek fabularny, nie tekst do przepisania):\n{goal or "(Nie określono.)"}\n'
        f'NOTATKI AUTORA (kontekst, nie fragment scenariusza):\n{notes or "(Brak.)"}\n'
        f'POSTACIE WYBRANE DO SCENY:\n{cast or "(Nie wybrano.)"}\n\n'
        f'AKTUALNA SCENA:\n'
        f'Tytuł: {scene["title"]}\n'
        f'Miejsce / nagłówek: {scene["location_heading"]}\n'
        f'Pora dnia: {scene["time_of_day"]}\n'
        f'Treść:\n{scene["content_text"] or "(Scena nie zawiera jeszcze tekstu.)"}\n\n'
        f'INSTRUKCJA UŻYTKOWNIKA:\n{prompt.user_prompt}\n\n'
        f'KONTROLA PRZED ZWROTEM:\nMiejsce: {setting}\n'
        f'Pora dnia: {scene.get("time_of_day") or "zgodna z nagłówkiem"}. '
        'Zacznij od nowego zdarzenia po końcu zapisanej sceny. Nie kopiuj wcześniejszych akapitów, także po pominięciu dialogów. '
        'Rozdziel działania i wypowiedzi na krótkie bloki; action ma najwyżej 600 znaków. '
        'Zachowaj pomocne parenthetical, usuń jedynie zbędne i powtórzone wskazówki. '
        'Zwróć wyłącznie JSON; nie wypisuj tej kontroli w blocks.'
    )


def owned(model, user):
    return model.objects.filter(**{OWNER_PATHS[model]: user})


def generation_is_cancelled(run_id):
    """Called by the cancellation watcher; release its thread-local DB connection."""
    try:
        runs = GenerationRun.objects.filter(pk=run_id, status='running')
        now = timezone.now()
        return not (runs.filter(updated_at__lt=now - timedelta(seconds=10)).update(updated_at=now)
                    or runs.exists())
    finally:
        connections['default'].close()


def get_owned(model, user, pk):
    return get_object_or_404(owned(model, user), pk=pk)


def lock_project(user, pk):
    return get_object_or_404(owned(Project, user).select_for_update(), pk=pk)


def save_validated(instance, changes=None):
    for name, value in (changes or {}).items():
        setattr(instance, name, value)
    for field in instance._meta.fields:
        value = getattr(instance, field.attname)
        if (value is None and not field.null and not field.primary_key
                and not getattr(field, 'auto_now', False) and not getattr(field, 'auto_now_add', False)):
            raise ValidationError({field.name: 'This field cannot be null.'})
        if isinstance(field, JSONField):
            try:
                json.dumps(value, allow_nan=False)
            except (TypeError, ValueError) as error:
                raise ValidationError({field.name: 'Use valid JSON without NaN or Infinity.'}) from error
    instance.full_clean()
    instance.save()
    return instance


def profile_for(user):
    defaults = PreferencesIn().model_dump()
    profile, _ = UserProfile.objects.get_or_create(user=user, defaults=defaults)
    return profile


def validate_avatar(value):
    if value:
        try:
            parsed = urlsplit(value)
        except ValueError as error:
            raise ValidationError({'avatar_url': 'Use a valid HTTP or HTTPS URL.'}) from error
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
            raise ValidationError({'avatar_url': 'Use an absolute HTTP or HTTPS URL.'})


def prompt_snapshot(scene, profile):
    # Freeze the inputs instead of trusting client-supplied foreign IDs or context.
    return {
        'project': {
            'id': scene.project_id, 'title': scene.project.title,
            'logline': scene.project.logline, 'synopsis': scene.project.synopsis,
            'genre': scene.project.genre, 'target_audience': scene.project.target_audience,
            'screenplay_format': scene.project.screenplay_format,
        },
        'act': {
            'id': scene.act_id, 'act_number': scene.act.act_number,
            'title': scene.act.title, 'summary': scene.act.summary,
        },
        'scene': {
            'id': scene.pk, 'scene_number': scene.scene_number, 'title': scene.title,
            'location_heading': scene.location_heading, 'time_of_day': scene.time_of_day,
            'content_text': scene.content_text, 'ai_metadata': scene.ai_metadata,
            'editor_metadata': scene.editor_metadata,
        },
        'characters': [
            {
                'id': member.character_id, 'name': member.character.name,
                'role': member.character.role, 'age': member.character.age,
                'psychological_profile': member.character.psychological_profile,
                'appearance': member.character.appearance, 'backstory': member.character.backstory,
                'goals': member.character.goals, 'fears': member.character.fears,
                'voice_profile': member.character.voice_profile,
                'memory_metadata': member.character.memory_metadata,
                'presence_type': member.presence_type, 'notes': member.notes,
            }
            for member in scene.cast_members.select_related('character').order_by('pk')
        ],
        'writing_style_preferences': profile.writing_style_preferences,
        'llm_preferences': profile.llm_preferences,
    }
