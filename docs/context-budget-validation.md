# Dobór kontekstu Bielika — weryfikacja z 7 listopada 2026

## Zachowanie aplikacji

Każde wywołanie agenta przechodzi przez lokalne przygotowanie kontekstu:

1. Tokenizer Bielika liczy zawartość wszystkich wiadomości, także systemowej.
2. Do wyniku dochodzi ostrożny narzut szablonu rozmowy: 64 tokeny na wiadomość
   oraz 32 na rozpoczęcie odpowiedzi. Licznik jest więc konserwatywny,
   nie jest deklarowany jako dokładna kopia formatowania każdej wersji Ollamy.
3. Rezerwowany jest pełny limit odpowiedzi i dodatkowe 128 tokenów.
4. Wybierane jest okno 2048 albo 4096. Aplikacja nie zwiększa go automatycznie
   do 8192 na karcie z 8 GB VRAM ani nie zmniejsza limitu odpowiedzi.
5. W przypadku przekroczenia limitu kod ponawia wyłącznie lokalne liczenie po
   uporządkowaniu kopii JSON: usuwa identyfikatory techniczne, spacje formatowania
   JSON i wykorzystuje niepuste, już istniejące streszczenia poprzednich scen,
   jeżeli przekazano je razem z pełnym tekstem. Nie tworzy nowych streszczeń.
6. Jeżeli to nie wystarcza, zwracany jest czytelny błąd HTTP 422 przed tym
   wywołaniem modelu. Instrukcja autora, bieżąca scena, cele, notatki i profile
   nie są po cichu przycinane. Oryginalny kontekst i dane w bazie pozostają bez zmian.

Tokenizer jest wczytywany z lokalnego pliku raz na proces. Słownik wszystkich
32128 tokenów porównano z metadanymi lokalnego GGUF — nie było różnic.
Uruchomienie aplikacji nie pobiera danych z Hugging Face i nie ładuje drugiego
modelu. Źródło, przypięta wersja, suma SHA-256 i licencja są w
`backend/agents/data/README.md`.

## Dlaczego okno nie zmniejsza się podczas jednego generowania

Bezpośrednie przełączanie 4096 → 2048 → 4096 powodowało w pomiarze po około
5,1–5,4 sekundy ponownego ładowania modelu przy każdej zmianie.

Dlatego oba modele LangChain używane przez API współdzielą jedną lokalną politykę
na całe żądanie, także dla kolejnych wariantów i poprawek Krytyka. Okno może
wzrosnąć, ale nie zmniejsza się przed końcem żądania. Przy limicie odpowiedzi
Scenarzysty 2048 od razu wybierane jest 4096: sama odpowiedź nie zostawia miejsca
na wejście w mniejszym oknie. Przy mniejszych limitach można zacząć od 2048.
Nowe żądanie dostaje nową politykę.

## Pomiary lokalnego przygotowania

Pomiar na tym komputerze, po wczytaniu tokenizera:

- Rzeczywiste wejścia agentów: około 0,6–2,1 ms.
- Sztuczne wejście około 29 tys. tokenów, z gotowym streszczeniem i dużą listą
  technicznych ID: średnio 16,0 ms w 25 próbach po rozgrzaniu.
- Duży, nieskracalny tekst około 24 tys. tokenów: średnio 37,8 ms w 25 próbach;
  kończy się lokalnym błędem, bez inferencji.
- Pierwsze wczytanie tokenizera w procesie: około 52–57 ms.

To mały narzut w porównaniu z generowaniem trwającym sekundy. Duże wejście jest
tokenizowane ponownie tylko po zmianie reprezentacji, nie jest ponownie wysyłane
do LLM w celu sprawdzenia długości.

## Rzeczywista Ollama: stałe okno i dobór okna

Model Bielik 11B Q4_K_M, temperatura 0, limit odpowiedzi 1024, batch 64.
Wywołania były sekwencyjne, bez zapisów wariantów do bazy.
Ta próba porównuje również koszt przełączania przed dodaniem ochrony przed
zmniejszaniem okna w obrębie jednego generowania.

| Próba | Okno | Rzeczywiste tokeny wejścia | Czas |
| --- | ---: | ---: | ---: |
| Krótkie polecenie Reżysera, stałe okno | 4096 | 675 | 6,81 s |
| To samo polecenie, mniejsze okno po przełączeniu | 2048 | 675 | 8,48 s |
| Rzeczywisty kontekst Archiwisty, stałe okno | 4096 | 2059 | 14,69 s |
| Ten sam kontekst po powrocie do większego okna | 4096 | 2059 | 14,14 s |
| Duże wejście z gotowym streszczeniem i danymi technicznymi, po kompakcji | 2048 | 789 | 9,52 s |

Ollama raportowała w obu rozmiarach pełne umieszczenie modelu w VRAM.
Rozmiar pamięci raportowany przez API spadł z 7503872000 do 7084179456 bajtów,
czyli o około 400 MiB przy przejściu z 4096 na 2048.

Krótszy plan Reżysera był identyczny w obu konfiguracjach. Po kompakcji większego
wejścia Archiwista zachował lęk Anny przed ogniem, profil mowy i informację,
że klucz pozostał w zamkniętym biurze. Nie obcinano wygenerowanych odpowiedzi.
We wszystkich pięciu wywołaniach rzeczywista liczba tokenów wejścia plus cały
limit odpowiedzi mieściły się w wybranym oknie. Lokalny licznik zawyżał
rzeczywiste wejście o około 78–79 tokenów, oprócz osobnego marginesu 128.

Wniosek z pomiaru: mniejsze okno oszczędza pamięć, ale samo przełączanie może
wydłużyć wykonanie. Nie ma podstaw do obiecywania ogólnego przyspieszenia
typowego generowania z domyślnym limitem odpowiedzi 2048.

## Pełny graf i testy

Jedno kompletne uruchomienie na zapisanym kontekście użytkownika, bez zapisów
do bazy: Archiwista → Reżyser → Scenarzysta → Krytyk. Parametry Scenarzysty:
temperatura 0,7 i limit 2048; pomocniczych: temperatura 0 i limit 1024.

| Agent | Budżet wejścia z narzutem | Wybrane okno | Przygotowanie lokalne | Cały etap |
| --- | ---: | ---: | ---: | ---: |
| Archiwista | 2138 | 4096 | 51,7 ms z pierwszym wczytaniem tokenizera | 13,78 s |
| Reżyser | 1240 | 4096 | 1,3 ms | 5,92 s |
| Scenarzysta | 1571 | 4096 | 1,4 ms | 15,96 s |
| Krytyk | 2237 | 4096 | 2,1 ms | 6,53 s |

Graf zakończył się w 42,19 s. Wariant miał 19 bloków edytora i został
zaakceptowany przez Krytyka z oceną 8, bez pętli poprawek. Każdy agent wykonał
jedno wywołanie modelu. Kontekst w tej próbie nie wymagał kompakcji.
Nie jest to pomiar przyspieszenia względem wcześniejszego pełnego przebiegu.
Akceptacja Krytyka nie gwarantuje idealnego scenariusza: np. model nadal użył
prefiksu `WN.` dla cmentarza. Budżetowanie nie jest korektorem treści i formatu.

Cały zestaw 219 testów backendu przeszedł. Nowe przypadki obejmują:

- granice pojemności, zapas na odpowiedź i wliczanie instrukcji systemowych;
- wybór okna i jego współdzielenie bez zmniejszania między agentami;
- zachowanie tekstów, celów, obaw, profili oraz niezmienność danych źródłowych;
- użycie istniejącego streszczenia i odrzucenie pustego streszczenia;
- brak inferencji po przekroczeniu limitu i zachowanie ustawień odpowiedzi;
- HTTP 422, brak częściowych wariantów, brak wpisu w historii udanych promptów
  i odblokowanie kolejnego generowania po takim błędzie.

Wyniki pochodzą z małej próby na jednej karcie. Przy zmianie modelu, szablonu
Ollamy lub sprzętu należy ponownie sprawdzić narzut i dostępne rozmiary okna.
