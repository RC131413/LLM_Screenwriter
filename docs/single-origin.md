# Django, React i WhiteNoise pod jednym adresem

Vite buduje Reacta do `frontend/dist`. Django udostępnia `index.html` pod `/`,
a WhiteNoise obsługuje zasoby pod `/static/frontend/`. API pozostaje pod `/api/`.
Nawigacja edytora nadal używa fragmentów adresu, np. `/#projects` i `/#project/1`.

Nie uruchamiamy Nginxa. Katalog `deployment/` zachowuje wyłącznie teoretyczne
przykłady do dokumentacji; bieżący Docker z nich nie korzysta.

## Lokalnie w Windows

Z katalogu głównego, po przygotowaniu `.env` i zainstalowaniu zależności frontendu:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
docker compose up -d db
docker compose run --rm db_setup
npm --prefix frontend run build
.\venv\Scripts\python.exe manage.py collectstatic --noinput
.\venv\Scripts\python.exe manage.py runserver
```

Otwórz **http://127.0.0.1:8000/**. Nie trzeba osobno uruchamiać Vite.
Po zmianach w Reactcie ponów build i `collectstatic`; podczas aktywnego tworzenia
interfejsu można nadal korzystać z `npm run dev` w `frontend/`. Vite przekazuje
zapytania `/api/` do lokalnego Django na porcie 8000.

## Cała aplikacja w Dockerze

Po przygotowaniu `.env` uruchom z katalogu głównego:

```powershell
docker compose up -d --build
docker compose logs -f app
```

Otwórz **http://127.0.0.1:8000/**. Jeśli na tym porcie działa lokalny `runserver`,
zatrzymaj go albo ustaw np. `APP_PORT=8001` w `.env` przed uruchomieniem Compose.
Używany adres API automatycznie podąża za adresem strony.

- `db` — PostgreSQL z dotychczasowym trwałym wolumenem.
- `db_setup` — czeka na bazę i wykonuje migracje; dane demonstracyjne dodaje tylko w DEBUG.
- `app` — czeka na zakończenie setupu, uruchamia Django przez Gunicorna i serwuje build Reacta.

Dockerfile ma dwa etapy: Node buduje frontend, a końcowy obraz Pythona dostaje
tylko gotowy `dist`, backend i zależności. `collectstatic` odbywa się podczas
budowania obrazu. Pliki `.env`, lokalny venv i `node_modules` nie trafiają do obrazu.

Ollama i model nadal działają na komputerze gospodarza, z dotychczasową obsługą GPU.
Kontener łączy się przez `http://host.docker.internal:11434`; adres można nadpisać
przez `OLLAMA_DOCKER_BASE_URL`. Samo uruchomienie aplikacji nie wywołuje inferencji.
Jeśli Ollama odrzuca połączenia z kontenera, sprawdź jej nasłuch i zaporę dla sieci
Dockera; nie wystawiaj jej portu publicznie. Lokalny Python domyślnie używa
`http://127.0.0.1:11434`, z opcjonalnym nadpisaniem `OLLAMA_BASE_URL`.

Gunicorn ma domyślnie jeden proces i cztery wątki: długie generowanie nie blokuje
odczytu postępu ani anulowania. Wspólna blokada PostgreSQL nadal dopuszcza jedno
generowanie naraz. Ustawienia procesu: `GUNICORN_WORKERS`, `GUNICORN_THREADS`,
`GUNICORN_TIMEOUT` (domyślnie 930 s).

Lokalne HTTP korzysta z `DJANGO_DEBUG=True` z `.env.example`. Dotychczasowe wymogi
HTTPS i bezpiecznych ciasteczek dla `DJANGO_DEBUG=False` pozostają w mocy.

## Wydzielone konta

- `backend/accounts/api.py` — endpointy logowania, rejestracji, wylogowania, konta,
  zmiany hasła, profilu i preferencji; router podpięty do wspólnego NinjaAPI.
- `backend/accounts/schemas.py` — kontrakty danych kont i preferencji.
- `backend/accounts/services.py` — profile, domyślne preferencje i walidacja awatarów.
- `backend/api/base_schemas.py` — wspólna walidacja kontraktów i bazowe odpowiedzi.

Adresy `/api/auth/*` i `/api/users/me*`, sesje, CSRF i limity nie zmieniają się.
Modele `User` i `UserProfile` zachowują obecne tabele oraz `AUTH_USER_MODEL=api.User`.
Wydzielenie obsługi kont nie wymaga migracji danych.

## Weryfikacja

Po integracji przeszło 278 testów backendu i 231 testów frontendu, build Vite oraz
kontrola typów. Dodano pięć testów serwowania frontendu i współdzielenia sesji/CSRF
oraz test domyślnego adresu API. Zbudowano oba obrazy Compose.

Chrome na tymczasowym kontenerze pod portem 18000 załadował HTML, JS, CSS i ikonę
z jednego adresu bez błędów JavaScript. Sprawdzono formularz rejestracji, wysłanie
CSRF przy logowaniu, odrzucenie błędnych danych logowania i ochronę prywatnego API.
Potwierdzono nagłówki ochronne oraz dostęp kontenera do listy modeli lokalnej
Ollamy. Nie uruchamiano inferencji. Kontener kontrolny został po sprawdzeniu usunięty.
