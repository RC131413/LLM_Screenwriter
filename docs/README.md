# Dokumentacja AgentDraft

Główny [README projektu](../README.md) opisuje aplikację, uruchamianie, architekturę,
API i wyniki weryfikacji. Poniższe dokumenty zachowują szczegółowe dane oraz
warunki wcześniejszych prób; ich datowane wyniki odnoszą się do opisanego etapu.

- [Audyt bezpieczeństwa](SECURITY_AUDIT.md) — zabezpieczenia, wyniki kontroli i wymagania wdrożenia.
- [Porównanie zwięzłych odpowiedzi agentów](agent-brevity-comparison.md) — pomiary czasu i ocena wyników.
- [Diagram ERD](ERD/DB_diagram_ERD.png) — źródłowy schemat bazy danych.
- [Courier Prime](courier-prime.md) — pochodzenie i zastosowanie czcionki w eksporcie PDF.
- [Django + React + WhiteNoise](single-origin.md) — wspólny adres, Docker i wydzielona obsługa kont.
- [Zrzuty aplikacji](screenshots/) — dziewięć oryginalnych obrazów wykorzystanych w galerii README.
- [Testy aplikacji](testy_aplikacji/RAPORT.md) — krótki raport, galeria zrzutów i zapisane wyniki.

Teoretyczne przykłady w [deployment/](../deployment/) nie są używane do uruchamiania aplikacji.
Licencje pozostają w katalogu
głównym oraz przy dostarczanych zasobach. Lokalne pliki robocze i surowe wyniki
diagnostyczne w `.local-tools/` nie stanowią dokumentacji projektu.

## Kod bezpieczeństwa

Pakiet [backend/api/security/](../backend/api/security/) zawiera:

- `middleware.py` — obsługa zaufanego proxy, CSRF, ograniczeń żądań i nagłówków API.
- `input_validation.py` — kontrola rozmiaru i struktury danych wejściowych.
- `rate_limits.py` — atomowe limity PostgreSQL i identyfikacja klienta.
- `locks.py` — blokady identyfikatorów kont i jednoczesnego użycia LLM.
- `exceptions.py` — wspólne wyjątki zabezpieczeń.
- `__init__.py` — publiczne funkcje i wyjątki importowane przez API.

Model techniczny `RequestRateLimit` pozostaje w `backend/api/models.py`,
a jego migracja w `backend/api/migrations/`.

## Testy backendu

Wszystkie pakiety znajdują się w [backend/test/](../backend/test/):

| Pakiet | Zakres |
| --- | --- |
| `api/` | Endpointy zasobów, kontrakty, eksport, statystyki i przebiegi pracy |
| `security/` | Logowanie, uprawnienia, CORS, limity i współbieżność |
| `models/` | Modele, relacje ERD i dane początkowe |
| `agents/` | Agenci, orkiestrator i zapis wyników |
| `screenplay/` | Formatowanie, kontynuacja i składanie scen |
| `llm/` | Transport Ollamy, generowanie i anulowanie |
| `support/` | Wspólne dane testowe i symulowany transport modelu |

Uruchamiaj z katalogu głównego projektu. Cały zestaw:

```powershell
.\venv\Scripts\python.exe manage.py test backend.test
```

Wybrany obszar lub pojedynczy moduł:

```powershell
.\venv\Scripts\python.exe manage.py test backend.test.security
.\venv\Scripts\python.exe manage.py test backend.test.security.test_auth
```
