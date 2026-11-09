# Audyt bezpieczeństwa AgentDraft — 9 listopada 2026

Zakres: kod Django/Ninja, React, agentów i transportu Ollamy, testy oraz zależności.
Nie przeprowadzono testu publicznego serwera ani konfiguracji rzeczywistej domeny/TLS.

Kod zabezpieczeń znajduje się w [backend/api/security/](../backend/api/security/),
a jego testy w [backend/test/security/](../backend/test/security/).
Komendy w raporcie uruchamiaj z katalogu głównego projektu.

## Sesje i uprawnienia

- API korzysta z sesji Django w ciasteczku HttpOnly, nie z JWT w localStorage.
- Zapis wymaga CSRF; sprawdzenie obejmuje również logowanie i rejestrację.
- Wszystkie prywatne operacje API objęto testem wymagania sesji; operacje zapisu
  objęto testem wymagania CSRF. Istniejące testy sprawdzają cudze zasoby i relacje
  między projektami; dodatkowo sprawdzono cudze generowania i anulowanie.
- Dane wejściowe nie pozwalają nadpisać właściciela, uprawnień użytkownika,
  identyfikatorów modelu, adresu Ollamy ani kontekstu pobieranego z bazy.
- Zmiana hasła korzysta z walidatorów i hashowania Django oraz unieważnia inne sesje.
  Wylogowanie i zmiana hasła anulują aktywne generowania danego konta.
- Rejestracja i zmiana nazwy sprawdzają również kolizję nazwy z e-mailem innego
  konta; nazwy są normalizowane przed kontrolą zajętości. Niepojednoznaczny
  identyfikator logowania nie wybiera przypadkowego konta.
  Kolizyjne operacje rejestracji/zmiany nazwy są serializowane blokadami transakcyjnymi.
- Po wylogowaniu/wygaśnięciu sesji frontend usuwa szkice promptów z sessionStorage;
  spóźnione odczyty profilu nie przywracają użytkownika po wylogowaniu.
- API odpowiada z `Cache-Control: no-store`; nowe sesje mają domyślnie 24 godziny.
  Istniejące sesje deweloperskie zachowują wcześniejszy termin wygaśnięcia.

## Limity i zasoby

Liczniki są atomowe w PostgreSQL, wspólne dla procesów backendu. Tabela operacyjna
`RequestRateLimit` przechowuje hash klucza, licznik i koniec okna, bez treści promptów,
surowych loginów i adresów IP. To dodatkowa tabela techniczna, poza encjami ERD.

| Operacja | Limit |
| --- | --- |
| API — zalogowane konto | 1200/min |
| API — anonimowy adres IP | 120/min |
| Zapisy | 300/min na konto/IP |
| Logowanie | 10/min na IP oraz 10/5 min na rozpoznane konto/identyfikator |
| Rejestracja | 5/h na IP |
| Zmiana hasła | 5/15 min na konto |
| Eksport | 10/min na konto |
| Generowanie | 3/min i 30/h na konto |
| Logowanie do panelu admina | 10/min na IP |

Odrzucenie zwraca HTTP 429 i `Retry-After`. Nieudane zmiany hasła i rejestracje
nie cofają liczników razem z transakcją endpointu. Awaria magazynu limitów
zatrzymuje obsługę żądania, zamiast przepuszczać ruch bez ograniczeń.

Lokalny model obsługuje **jedno generowanie na raz dla całej instancji bazy**.
Blokadę utrzymuje osobna sesja PostgreSQL; nie trzymamy transakcji DB przez czas
inferencji. Inne konto dostaje 503 z czytelnym komunikatem i `Retry-After: 10`.
Anulowanie zwalnia blokadę po wyjściu z transportu, a zakończenie procesu zamyka
sesję blokady. To nie jest kolejka zadań ani system sprawiedliwego kolejkowania.
Połączenie blokady wymaga bezpośredniego PostgreSQL lub session poolingu;
PgBouncer w trybie transaction poolingu nie jest tu wspierany.

Całe generowanie ma limit 900 s, zachowane są wcześniejsze limity czasu wywołań,
liczby wariantów (1–3), poprawek Krytyka i ponowień odpowiedzi strukturalnej.
Nie zmieniono doboru GPU ani mechaniki okna kontekstu. Domyślne 2048 tokenów
pozostaje; bezpośrednie API przyjmuje do 8192. Transport ogranicza strumień Ollamy
do 2 MiB i pojedynczą linię do 256 KiB oraz zamyka połączenie po przekroczeniu.

Po wdrożeniu migracji uruchamiaj codziennie:

```powershell
python manage.py prune_security_limits
```

## Dane wejściowe, XSS i prompt injection

- Payload API: JSON do 2 MiB, ograniczona głębokość i liczba węzłów. NUL,
  niepoprawne pary Unicode i niedozwolone znaki sterujące są odrzucane.
  Kontrola obejmuje również PATCH, którego Ninja nie waliduje jako pełnego modelu.
- Pola tekstowe mają limity długości w backendzie i najważniejszych formularzach;
  identyfikatory muszą mieścić się w bezpiecznym zakresie liczb JavaScript.
- Błędy walidacji nie zwracają surowych haseł, promptów ani kontekstu Pydantic.
- React wyświetla tekst przez zwykłe właściwości/children, bez wykonywania HTML.
  Nie blokujemy cytatów kodu ani słów SQL w scenariuszu; ORM używa parametrów.
- Awatary dopuszczają tylko bezwzględne HTTP/HTTPS bez poświadczeń w URL.
  Backend nie pobiera obrazów. Frontend odrzuca również niebezpieczne stare URL-e
  i nie wysyła adresu bieżącej strony jako Referer do serwera zdjęcia.
- Wersja produkcyjna frontendu ma CSP bez `unsafe-inline`/`unsafe-eval` dla skryptów.
  Style inline pozostają dozwolone ze względu na zoom i wykresy. Backend ustawia
  osobną restrykcyjną CSP dla odpowiedzi API; dokumentacja API jest wyłączona poza DEBUG.
- Agenci dostają oddzielną instrukcję systemową o niezaufanym kontekście i wyjście
  walidowane przez Pydantic. Nie dostają narzędzi do shella, SQL, odczytu plików
  ani dowolnych URL-i. Kontekst buduje backend z zasobów właściciela, bez sekretów
  środowiska. Śledzenie LangSmith pozostaje wyłączone w przepływie agentowym.

**Prompt injection nie ma gwarantowanego filtra.** Model nadal może podążyć za
szkodliwym tekstem i wygenerować niepożądaną treść lub nierzetelną ocenę. Tej treści
nie traktujemy jako kodu, uprawnienia, zapytania SQL ani polecenia dla systemu.
Sam dodatkowy prompt i walidacja JSON nie dowodzą odporności semantycznej modelu.

## Przed rzeczywistym wdrożeniem

1. Ustaw `DJANGO_DEBUG=False`, losowy silny klucz, własne hasła i konkretne
   `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` (HTTPS).
   Silny klucz jest sprawdzany przy starcie. HTTPS redirect, Secure cookies,
   HSTS (rok), nosniff i ochrona przed osadzaniem są domyślnie włączone.
2. Uruchom migracje; migracja `api.0002_requestratelimit` została już wykonana lokalnie.
   Compose pomija demo seed w trybie produkcyjnym; istniejące konta demo wymagają
   świadomego przeglądu/wyłączenia przed upublicznieniem usługi.
3. Ustaw frontendowe `VITE_API_BASE_URL` (np. `/api/` za wspólnym reverse proxy)
   przed buildem. W [frontend/.env.production.example](../frontend/.env.production.example)
   jest przykład; nie umieszczaj tam sekretów.
4. Zastosuj ograniczenia na reverse proxy: rozmiar body 2 MiB, tempo/połączenia,
   HTTPS i nagłówki frontendu. Przykład: [deployment/nginx.conf.example](../deployment/nginx.conf.example).
   Do internetu wystaw tylko proxy; PostgreSQL i Ollama mają pozostać prywatne.
   `runserver` i Vite dev server nie są serwerami produkcyjnymi.
5. Nagłówki proxy są ignorowane domyślnie. Ustaw `DJANGO_TRUSTED_PROXY_IPS`
   wyłącznie na rzeczywiste, dokładne adresy prywatnego proxy. Proxy musi nadpisywać
   `X-Forwarded-For` jednym IP i `X-Forwarded-Proto`, a backend musi być niedostępny
   bezpośrednio z internetu. Bez tego różni klienci proxy mogą dzielić jeden limit IP.
6. HSTS `includeSubDomains`/preload wymagają decyzji dla docelowej domeny i pełnego
   HTTPS subdomen; nie włączono ich tylko po to, żeby ukryć ostrzeżenia kontrolne.
   Służą do tego `DJANGO_HSTS_INCLUDE_SUBDOMAINS` i `DJANGO_HSTS_PRELOAD`.
7. Poczta używa konsoli tylko w DEBUG; produkcyjny backend SMTP wymaga ustawienia
   `DJANGO_SMTP_HOST`, `DJANGO_SMTP_PORT`, `DJANGO_SMTP_USER`, `DJANGO_SMTP_PASSWORD`.
   SMTP wymaga TLS. Nie konfigurowano prawdziwego dostawcy ani nie wysyłano wiadomości.
8. Lokalnie potwierdzono, że rola bazy ma uprawnienia superuser/create database/create role,
   jak domyślny użytkownik startowy obrazu Postgresa. Przed publikacją utwórz rolę
   runtime według [deployment/create_runtime_role.sql.example](../deployment/create_runtime_role.sql.example) i ustaw
   `DJANGO_DB_USER` / `DJANGO_DB_PASSWORD`. Migracje uruchamiaj osobnym kontem
   administratora/migratora. Lokalnych haseł i uprawnień nie zmieniano.
   Przykład ograniczonego środowiska: [deployment/django.production.env.example](../deployment/django.production.env.example).
   W procesie/kontenerze runtime nie umieszczaj hasła bootstrap/migratora ani
   deweloperskiego pliku `.env`; ograniczenie samego połączenia nie wystarczy,
   jeżeli aplikacja nadal może odczytać sekret administratora.

Nie wdrożono w tym etapie: weryfikacji e-maili, resetowania hasła, MFA,
biznesowych limitów pojemności kont i retencji historii, backupów, monitoringu
zewnętrznego ani ochrony infrastruktury przed rozproszonym DDoS. Publiczna
rejestracja i zasady zużycia GPU/dysku wymagają świadomej polityki przed otwartym SaaS.
Limity aplikacyjne nie zastępują tych zabezpieczeń ani testu docelowego wdrożenia.

## Kontrola zależności

Na dzień audytu `npm audit` nie zgłosił znanych podatności, a `pip-audit`
sprawdził 82 zainstalowane pakiety bez zgłoszeń i bez pominiętych pakietów.
To sprawdzenie publicznych baz znanych podatności, nie dowód braku nieznanych luk.
Należy ponawiać je po zmianach i przed wydaniem.

Weryfikacja końcowa: 273 testy backendu i 230 testów frontendu przeszło; build,
kontrola typów, migracje i `pip check` są poprawne. Test współbieżności potwierdził
dokładnie 5 dopuszczonych żądań przy 20 równoległych próbach i limicie 5.
Chrome załadował build produkcyjny, wyświetlił próbkę HTML jako tekst i zablokował
skrypt inline. Nie uruchamiano prawdziwej inferencji ani nie obciążano GPU.
`check --deploy` dla izolowanego profilu produkcyjnego nie zgłasza błędów;
pozostają jawne W005/W021 dotyczące opcji HSTS dla docelowej domeny.

Źródła: [Django security](https://docs.djangoproject.com/en/6.1/topics/security/),
[deployment checklist](https://docs.djangoproject.com/en/6.1/howto/deployment/checklist/),
[Ninja throttling](https://django-ninja.dev/guide/throttling/),
[OWASP prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).
