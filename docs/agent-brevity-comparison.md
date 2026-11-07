# Zwięzłe odpowiedzi agentów — porównanie z 7 listopada 2026

Zmieniono instrukcje i opisy pól wyjściowych Archiwisty oraz Krytyka.
Archiwista ma pisać krótkie notatki, zachowując istotne cele, obawy, głos
postaci, zaprzeczenia oraz fakty o ciągłości. Krytyk ma krótko oceniać
realizację celu, a konkretne problemy i poprawki umieszczać w `findings`.
Długości są wskazówkami dla modelu: nie wprowadzono obcinania tekstu ani
nowych limitów walidacji. Cel bieżącej sceny jest dodatkowo wyeksponowany
w danych wejściowych Krytyka jako `scene_goal`, z tych samych metadanych.

## Warunki porównania

- Rzeczywista lokalna Ollama, Bielik 11B Q4_K_M, RTX 3060 Ti 8 GB.
- Ollama zgłaszała `100% GPU` i kontekst 4096 tokenów.
- Wywołania kolejno, temperatura 0, limit 1024 tokenów, batch 64.
- Ten sam transport co w aplikacji; osobne rozgrzanie modelu przed pomiarem.
- Dane rzeczywiste: zapisany kontekst przebiegu 42 i wariant 43.
- Dane kontrolne: dwie karty postaci, dwa wcześniejsze zdarzenia, plan
  późniejszej sceny oraz poprawna i celowo sprzeczna scena ucieczki.
- Krytyk otrzymał te same teksty i kontekst przed/po. Do obu wersji jego
  rzeczywistej próby przekazano ten sam wcześniejszy wynik Archiwisty.
- Wywołano samych agentów; nie utworzono nowych przebiegów ani wariantów
  w bazie i nie zmieniono scen użytkownika.

## Wyniki końcowej wersji

| Próba | Tokeny przed → po | Czas przed → po |
| --- | ---: | ---: |
| Archiwista: rzeczywisty kontekst | 379 → 267 | 20,6 s → 12,5 s* |
| Archiwista: dwie karty i historia | 317 → 258 | 20,6 s → 14,1 s |
| Krytyk: zapisany wariant | 553 → 199 | 28,9 s → 11,0 s |
| Krytyk: scena z błędami | 762 → 328 | 43,8 s → 19,8 s |
| Krytyk: poprawna scena niema | 616 → 155 | 36,2 s → 8,6 s |

Łącznie trzy odpowiedzi Krytyka: 1931 → 682 tokeny (około 65% mniej)
oraz 108,9 → 39,4 s. Dwie odpowiedzi Archiwisty: 696 → 525 tokenów
(około 25% mniej).

\* Pierwsza próba końcowego promptu Archiwisty trwała 270,8 s, w tym
108,5 s przetwarzania wejścia i 162,1 s generowania 249 tokenów.
W tabeli podano jej powtórzenie: 12,5 s i 267 tokenów. Powtórzenie
skorzystało z pamięci podręcznej wejścia (około 0,04 s wobec 1,93 s
w pomiarze bazowym). Nie ustalono przyczyny tak dużego odchylenia.
Nie należy traktować tej tabeli jako gwarantowanego przyspieszenia aplikacji.

## Ocena treści

- W próbie z kartami zachowano imiona, cele, obawy, sposób mówienia,
  brak klucza oraz brak wiedzy Olka o liście. Profile mają formę notatek.
- Krytyk utrzymał decyzję o potrzebie poprawek zapisanego wariantu.
  Końcowa wersja ponownie zauważyła, że cel wymaga odkrycia na cmentarzu,
  a oceniany tekst prowadzi do biblioteki.
- Scena z celowymi sprzecznościami nadal wymaga poprawek. Krytyk wskazuje
  lęk Anny i brak ucieczki, ale nie wykrywa wszystkich błędów posiadania
  klucza i wiedzy o liście. Podobne pominięcia występowały przed zmianą.
- Poprawna scena bez dialogów nadal przechodzi bez wymaganych poprawek.
  Krótsza recenzja nie dopisuje już długiej listy porad o dodaniu dialogów.
- Recenzje nie są identyczne: zmieniają się oceny, liczba uwag i ich
  kategoryzacja. Np. brak cmentarza błędnie trafił do `character`.
- Rzeczywisty Archiwista nadal potrafi uznać planowane odkrycie
  szlacheckiego pochodzenia za już znany fakt. Było to widoczne również
  przed zmianą; krótszy prompt nie stanowi gwarancji poprawności faktów.

Wcześniejsze, zbyt agresywnie skrócone wersje Krytyka powodowały fałszywe
odrzucenie poprawnej sceny albo pominięcie warunku cmentarza. Odrzucono je
po porównaniu; pozostawiono krótkie uzasadnienie realizacji konkretnego celu.

To mała próba porównawcza, nie statystyczny test jakości. Nie oceniano
nowego pełnego przebiegu z generowaniem tekstu przez Scenarzystę.
