import type { Project, ScriptBlock } from '../types';

const blocks = (items: [ScriptBlock['type'], string][]): ScriptBlock[] =>
  items.map(([type, text], index) => ({ id: `block-${index}`, type, text }));

export const mockProjects: Project[] = [
  {
    id: 'last-tram', title: 'Ostatni kurs', genre: 'Dramat / thriller',
    acts: [
      { act_number: 1, title: 'Ostatni pasażer', summary: 'Anna rusza na nocny kurs. Nieznajomy pasażer wręcza jej kopertę z tropem dotyczącym zaginionego ojca.' },
      { act_number: 2, title: 'Ślady przeszłości', summary: 'Wizyta na zamkniętej stacji ujawnia sekret rodziny. Anna konfrontuje brata z tym, co odkryła.' },
      { act_number: 3, title: 'Pierwszy kurs', summary: 'Anna poznaje prawdę i podejmuje decyzję, jak żyć z nią dalej.' },
    ],
    synopsis: 'Motornicza Anna od lat szuka odpowiedzi na pytanie o zniknięcie ojca. Podczas ostatniego nocnego kursu spotyka Marka, który zostawia jej kopertę. Trop prowadzi na zamkniętą stację i zmusza ją do konfrontacji z rodzinną tajemnicą.',
    target_audience: 'Dorośli widzowie kina niezależnego i dramatów psychologicznych',
    logline: 'Podczas ostatniego nocnego kursu motornicza spotyka człowieka, który zna szczegóły zaginięcia jej ojca.',
    characters: [
      { id: 'anna', name: 'ANNA', age: '32', role: 'Protagonistka · motornicza', goal: 'Poznać prawdę o zniknięciu ojca.', flaw: 'Nie ufa ludziom i za wszelką cenę chce mieć kontrolę.', voice: 'Krótkie, konkretne zdania. Pod presją odpowiada pytaniem.', appearance: 'Ciemne włosy spięte z tyłu, granatowy mundur. Podczas rozmowy unika kontaktu wzrokowego.', backstory: 'Po zniknięciu ojca została w rodzinnym mieście. Pracuje w tej samej zajezdni, w której pracował on.' },
      { id: 'marek', name: 'MAREK', age: '58', role: 'Tajemniczy pasażer', goal: 'Przekazać Annie list, zanim odnajdzie go dawny wspólnik.', flaw: 'Ukrywa prawdę za półsłówkami.', voice: 'Spokojny, unika nazwisk. Często urywa zdania.', appearance: 'Siwiejący, szczupły. Nosi stary płaszcz i stale sprawdza wewnętrzną kieszeń.', backstory: 'Przed laty pracował z ojcem Anny. Przez długi czas nie miał odwagi opowiedzieć rodzinie, co wydarzyło się na stacji.' },
      { id: 'tomek', name: 'TOMEK', age: '34', role: 'Brat Anny', goal: 'Przekonać siostrę, żeby przestała szukać ojca.', flaw: 'Myli troskę z kontrolą.', voice: 'Potoczny język, ironia maskująca lęk.', appearance: 'Krótko ostrzyżony, sportowa kurtka. Nerwowo obraca telefon w dłoni.', backstory: 'Po zaginięciu ojca przejął opiekę nad rodziną. Ukrył przed Anną list, wierząc, że ją chroni.' },
    ],
    scenes: [
      { id: 'depot', title: 'Przed ostatnim kursem', heading: 'WN. ZAJEZDNIA TRAMWAJOWA — NOC', act: 1, status: 'ready', synopsis: 'Anna odbiera telefon od brata i rusza na ostatni kurs.', characterIds: ['anna', 'tomek'], notes: '', blocks: blocks([
        ['action', 'Pusta zajezdnia. W kałużach odbijają się jarzeniowe lampy. ANNA sprawdza pulpit starego tramwaju. Telefon wibruje.'],
        ['character', 'TOMEK'], ['parenthetical', '(przez telefon)'], ['dialogue', 'Wracasz po zmianie? Mama znowu pytała.'],
        ['character', 'ANNA'], ['dialogue', 'Jeszcze jeden kurs. Potem zadzwonię.'],
        ['action', 'Rozłącza się, zanim zdąży odpowiedzieć. Wsuwa pod pulpit wyblakłe zdjęcie ojca.'],
      ]) },
      { id: 'passenger', title: 'Nieznajomy pasażer', heading: 'WN. TRAMWAJ, LINIA 17 — NOC', act: 1, status: 'draft', synopsis: 'Nieznajomy wsiada na pustym przystanku. Wie więcej, niż powinien.', characterIds: ['anna', 'marek'], notes: 'Nie ujawniać jeszcze, skąd Marek zna ojca Anny.', blocks: blocks([
        ['action', 'Tramwaj sunie przez opustoszałe miasto. Deszcz rozmywa światła za szybą. ANNA (32) zerka na zegar. 23:47.'],
        ['action', 'Na przystanku stoi jeden człowiek. MAREK (58), przemoczony płaszcz, mała koperta w dłoni. Wsiada. Nie kasuje biletu.'],
        ['character', 'ANNA'], ['dialogue', 'To ostatni kurs. Jadę tylko do zajezdni.'],
        ['character', 'MAREK'], ['dialogue', 'Wiem.'],
        ['action', 'Siada tuż za kabiną. Anna obserwuje go w lusterku. Przez chwilę słychać tylko koła na szynach.'],
        ['character', 'MAREK'], ['dialogue', 'Ojciec też zawsze wybierał nocne zmiany?'],
        ['action', 'Dłoń Anny nieruchomieje na nastawniku.'],
        ['character', 'ANNA'], ['parenthetical', '(nie odwracając się)'], ['dialogue', 'Skąd pan zna mojego ojca?'],
        ['character', 'MAREK'], ['dialogue', 'Nie powiedziałem, że go znam.'],
        ['action', 'Anna hamuje gwałtowniej, niż zamierzała. Koperta ześlizguje się z kolan Marka.'],
      ]) },
      { id: 'envelope', title: 'Koperta', heading: 'WN. TRAMWAJ — NOC', act: 1, status: 'review', synopsis: 'W kopercie jest fotografia i adres zamkniętej stacji.', characterIds: ['anna', 'marek'], notes: '', blocks: blocks([
        ['action', 'Anna podnosi kopertę. Z rogu wystaje czarno-biała fotografia. Ten sam płaszcz, który ojciec nosił w dniu zaginięcia.'],
        ['character', 'MAREK'], ['dialogue', 'Nie tutaj. Na końcowym.'],
        ['character', 'ANNA'], ['dialogue', 'Na końcowym porozmawiamy z policją.'],
      ]) },
      { id: 'station', title: 'Zamknięta stacja', heading: 'PL. STARA STACJA — NOC', act: 2, status: 'draft', synopsis: 'Anna trafia pod wskazany adres. Ktoś zapalił światło w budynku.', characterIds: ['anna'], notes: '', blocks: blocks([
        ['action', 'Zardzewiała brama jest uchylona. Anna wyłącza latarkę. Na piętrze dawnej nastawni pali się jedna lampa.'],
        ['action', 'Z wnętrza dochodzi dźwięk radia. Ta sama melodia, którą nucił ojciec.'],
      ]) },
      { id: 'brother', title: 'Telefon do brata', heading: 'WN. NASTAWNIA — NOC', act: 2, status: 'draft', synopsis: 'Tomek przyznaje, że od lat wiedział o liście.', characterIds: ['anna', 'tomek'], notes: '', blocks: blocks([
        ['character', 'ANNA'], ['dialogue', 'Powiedz mi, że nic o tym nie wiedziałeś.'],
        ['action', 'Cisza w słuchawce trwa o sekundę za długo.'],
        ['character', 'TOMEK'], ['dialogue', 'Chciałem cię ochronić.'],
      ]) },
      { id: 'morning', title: 'Pierwszy kurs', heading: 'PL. PRZYSTANEK — ŚWIT', act: 3, status: 'draft', synopsis: 'Anna pozwala odejść przeszłości i wraca do miasta.', characterIds: ['anna'], notes: '', blocks: blocks([
        ['action', 'Pierwszy tramwaj wyjeżdża zza zakrętu. Anna składa list i chowa go do kieszeni. Tym razem siada po stronie pasażerów.'],
        ['transition', 'CIĘCIE DO CZERNI.'],
      ]) },
    ],
  },
  {
    id: 'signal', title: 'Sygnał', genre: 'Science fiction / krótki metraż',
    acts: [
      { act_number: 1, title: 'Transmisja', summary: 'Ewa rozpoznaje własny głos w tajemniczym sygnale radiowym.' },
      { act_number: 2, title: 'Zakłócenia', summary: 'Ewa szuka źródła transmisji i próbuje zmienić zapowiedziane wydarzenia.' },
      { act_number: 3, title: 'Odpowiedź', summary: 'Ewa decyduje, jak odpowiedzieć na wiadomość z przyszłości.' },
    ],
    synopsis: 'Techniczka radiowa odbiera sygnał, w którym słyszy swój własny głos z następnego dnia. Próbuje ustalić, czy transmisja jest ostrzeżeniem, czy początkiem zdarzeń, przed którymi chce uciec.',
    target_audience: 'Widzowie kameralnego science fiction i krótkich metraży',
    logline: 'Techniczka radiowa odbiera transmisję ze swojego mieszkania, wysłaną dzień później.',
    characters: [{ id: 'ewa', name: 'EWA', age: '29', role: 'Protagonistka · techniczka', goal: 'Ustalić źródło sygnału.', flaw: 'Woli pomiary od własnej intuicji.', voice: 'Precyzyjna, rzeczowa, używa terminów radiowych.', appearance: 'Okulary w cienkich oprawkach, robocza bluza, słuchawki przewieszone przez szyję.', backstory: 'Po studiach została na niewielkiej stacji radiowej. W pracy odnajduje porządek, którego brakuje jej poza nią.' }],
    scenes: [{ id: 'radio', title: 'Częstotliwość', heading: 'WN. STACJA RADIOWA — WIECZÓR', act: 1, status: 'draft', synopsis: 'Ewa odbiera wiadomość z przyszłości.', characterIds: ['ewa'], notes: '', blocks: blocks([
      ['action', 'Na monitorze pojawia się pojedynczy pik. EWA dostraja odbiornik. W szumie rozpoznaje własny głos.'],
      ['character', 'EWA'], ['dialogue', 'Kto nadaje na tej częstotliwości?'],
      ['action', 'Odpowiedź przychodzi natychmiast. Zbyt szybko, by była echem.'],
    ]) }],
  },
];
