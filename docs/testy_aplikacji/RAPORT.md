# AgentDraft — testy aplikacji

Data: **10.11.2026**. Lokalny Bielik 11B, RTX 3060 Ti 8 GB, temperatura 0.7.

Sprawdzono generowanie na zapisanych danych Django, stosowanie wariantów, anulowanie i trwałość danych. Wygenerowano **4 warianty w 3 zakończonych przebiegach**. Dodatkowo jeden przebieg anulowano, a niezrozumiałe polecenie odrzucono przed wywołaniem modelu. Testowy projekt: **Ostatni dyżur**, postacie: ANNA i OLEK.

## Wyniki

| Próba | Wynik | Czas |
| --- | --- | --- |
| Pusta scena, 1 wariant | OK | 79,4 s |
| Kontynuacja sceny, 1 wariant | OK | 116,7 s |
| Generowanie 2 wariantów | OK | 165,9 s |
| Anulowanie | Bez zapisanego wariantu | — |
| Polecenie „adada” | Odrzucone, HTTP 422 | — |
| Zamiana wariantu i cofanie | Bez duplikowania tekstu | — |
| Powrót / odświeżenie podczas generowania | Przywrócone polecenie i postęp | — |
| Ponowne logowanie | Sceny, warianty i historia zachowane | — |

Sprawdzono też przenoszenie scen między aktami i eksport do Fountain, FDX, PDF oraz JSON. **16 porównań zapisu danych przeszło.** To wybrane próby funkcjonalne, nie pełny zestaw testów aplikacji.

## Uwagi do tekstów

- Model zachowuje podział na akcję, postacie i dialogi oraz korzysta z celu sceny.
- Nadal zdarzają się powtórzenia, zbędne wskazówki aktorskie i błędy ciągłości, np. zmiana miejsca przechowywania klucza.
- Krytyk przyznał 8–9/10, mimo tych usterek. Jego ocena wymaga weryfikacji przez autora.
- Dwa warianty powstawały kolejno; Archiwista przygotował dla nich wspólny kontekst. W tych próbach nie uruchomiła się pętla poprawek Krytyka.

## Pliki

- [index.html](index.html) — prosta galeria 12 zrzutów i wyniki prób.
- [wyniki.json](wyniki.json) — polecenia, pełne odpowiedzi modelu, oceny i czasy agentów.
- [historia_z_api.json](historia_z_api.json) — zapisane sceny i historia pobrane z Django.
- [weryfikacja_po_logowaniu.json](weryfikacja_po_logowaniu.json) — porównanie danych po ponownym logowaniu.
- `screeny/` — zrzuty działającej aplikacji z testowymi danymi.
