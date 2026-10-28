# AgentDraft

## Layout

- `frontend/`: React, TypeScript and Vite application.
- `backend/`: Django settings, URLs, ASGI and WSGI entry points.
- `backend/ollama.py`: minimal HTTP client for the local Bielik model in Ollama.
- `backend/api/`: Django application registered as `backend.api.apps.ApiConfig`;
  contains models corresponding to the database ERD.
- `backend/test/`: tests grouped by authentication, account, projects, structure,
  characters, generation, permissions, models, seeding, CORS and workspace flows.
- `frontend/tests/`: API transport, hooks, services, component and application integration tests.
- `ERD/DB_diagram_ERD.png`: original database diagram.
- `manage.py`, `venv/`, `requirements.txt`: kept in the repository root.
- `compose.yaml`: PostgreSQL, its persistent volume, and the one-off `db_setup` service.
- `Dockerfile`: Python environment for migrations and demo seeding, built from the repository root.
- `.env`: local credentials, already excluded by `.gitignore`.
- `.env.example`: configuration template without real secrets.

## Local Backend

Run commands from the repository root in PowerShell:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
docker compose up -d --build
docker compose wait db_setup
docker compose logs db_setup
.\venv\Scripts\python.exe manage.py check --database default
.\venv\Scripts\python.exe manage.py runserver
```

On a fresh checkout, first create `.env` using `.env.example` and replace its
secret values. Existing shell environment variables take precedence over `.env`.
The database and database user are both named `agentdraft`; its password is in
`.env`. Django connects to `127.0.0.1:55432` (port `5432` inside the container).
Changing `POSTGRES_PORT` updates both
Django's connection and Docker's published host port.

PostgreSQL 18 stores data in a named volume mounted at `/var/lib/postgresql`,
following the [official image documentation](https://hub.docker.com/_/postgres).
Its default `PGDATA` is `/var/lib/postgresql/18/docker`; do not append `/data`
to this volume mount. The `/var/lib/postgresql/data` mount applies to PostgreSQL
17 and earlier with their default configuration.
`docker compose down` preserves this volume. Do not use `docker compose down -v`
unless you intend to delete the database. Changing database credentials in `.env`
does not update a database that has already been initialized.

## Database Models and Migrations

`backend/api/models.py` defines all 11 ERD models. JSON fields use callable
`default=dict` values so each record gets its own empty object. The Django user
inherits `AbstractUser`, preserves Django's authentication fields and permissions,
and stores its hashed `password` field in the `password_hash` database column.
`AUTH_USER_MODEL` is set to `api.User`.

Create and apply migrations from the repository root:

```powershell
.\venv\Scripts\python.exe manage.py makemigrations api
.\venv\Scripts\python.exe manage.py migrate
```

The initial migration `backend/api/migrations/0001_initial.py` is already present.
`db_setup` applies existing migration files; it never runs `makemigrations`.
The custom user must be part of the initial application migration.
If the database already contains migrations for Django's
default `auth.User`, stop and plan a user-model migration before running these
commands; do not delete existing data or the Docker volume.
See [Django's custom user documentation](https://docs.djangoproject.com/en/6.1/topics/auth/customizing/).

The ERD does not specify string lengths or decimal precision. Text labels use
bounded character fields, and `critic_score` uses five digits with two decimal
places. Act, scene and variant numbers start at 1; sort order starts at 0.
Scene numbers are unique within a project, act
numbers within a project, and variant numbers within a run. A generation request
has at most one run, matching the diagram's one-to-one relation. A character can
appear only once in a scene's cast table.

`clean()` validates that scenes, cast members and generated variants belong to
the correct project/scene. Django does not automatically call `full_clean()` on
`save()`; future API write operations must perform this validation explicitly.

## Demo Data and Automatic Setup

The command is located at `backend/api/management/commands/seed_db.py`.
`management` is the standard Django directory name.

`db_setup` uses `depends_on: condition: service_healthy` to wait for PostgreSQL,
then runs `migrate --noinput` followed by `seed_db`. A migration failure prevents
seeding. The service exits after setup; PostgreSQL remains running.
This follows [Compose's startup-order mechanism](https://docs.docker.com/compose/how-tos/startup-order/).
Inside Compose, Django connects to `db:5432`; local Django uses `127.0.0.1:55432`.
The image contains only backend sources, migrations, `manage.py` and dependencies;
`.env`, `venv`, frontend files and local media are excluded from its build context.

Seed data covers all 11 ERD models:

- 2 regular users and profiles: `demo_writer` and `demo_editor`.
- 2 projects, 6 acts, 4 characters, 6 scenes and 10 scene-character links.
- 6 requests, 6 generation runs, 24 agent executions and 12 variants.

Both initial account passwords come from `SEED_DEMO_PASSWORD` in `.env` and must
have at least 12 characters. Only password hashes are stored in the database;
passwords are not logged. The seed requires `DJANGO_DEBUG=True` and is intended
for local development, not production.

Seeding is transactional, validates model relations and is safe to repeat.
Existing rows and passwords are not overwritten, unrelated data is not deleted,
and PostgreSQL serializes concurrent seeds using a transaction-scoped advisory
lock. Reserved demo usernames associated with other emails cause a rollback.

To run only the seed after migrations, from the host:

```powershell
.\venv\Scripts\python.exe manage.py seed_db
```

Or use the container environment:

```powershell
docker compose run --rm db_setup python manage.py seed_db
```

After changing backend sources or dependencies, rebuild the setup service before
running it again: `docker compose up -d --build db_setup`.

## HTTP API (Django Ninja)

### Local LLM connection (MVP)

`backend/ollama.py` exposes `generate(prompt: str) -> str`. It sends UTF-8 JSON to
`http://127.0.0.1:11434/api/generate` using Python's standard library, with
`stream: false`, a 120-second timeout and a 128-token output limit for this MVP.
The model is fixed to `SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M`, the concrete
Ollama identifier for [SpeakLeash's Bielik 11B model](https://ollama.com/SpeakLeash/bielik-11b-v2.3-instruct/tags).
The request follows [Ollama's generate API](https://docs.ollama.com/api/generate).

With Ollama installed and running, download the model once:

```powershell
ollama pull SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M
```

Start Django normally and test in a browser or PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/llm/ping
```

`GET /api/llm/ping` sends a fixed Polish test prompt and returns
`{ "model": "SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M", "response": "..." }`.
This temporary diagnostic endpoint requires `DJANGO_DEBUG=True` and does not
require login. With DEBUG disabled it returns 404 without contacting Ollama.
Each request generates fresh text; responses have `Cache-Control: no-store`.
Unavailable Ollama returns 503, a timeout 504, and a missing model or invalid
upstream response 502 with a descriptive `detail`. The client never downloads
models or substitutes another model automatically. For a different local host
or port, `generate` accepts optional `base_url` and `timeout` keyword arguments.
This probe does not save prompts, runs or variants and does not change the editor's
generation workflow. No additional dependency or database migration is needed.

### Application API

Run the backend with `.\venv\Scripts\python.exe manage.py runserver` from the
repository root. Interactive documentation is at
<http://127.0.0.1:8000/api/docs>; OpenAPI is at
<http://127.0.0.1:8000/api/openapi.json>.

Implementation:

- `backend/api/api.py`: routes, session authentication and HTTP responses.
- `backend/api/scheams.py`: typed request/response contracts (requested filename).
- `backend/api/services.py`: ownership checks, validated saves and context snapshots.
- `backend/test/test_*.py`: HTTP, CSRF, authorization, model and workflow tests,
  with shared API fixtures in `_api_base.py`.
- `backend/urls.py`: mounts the API at `/api/`.

Paths below are relative to `/api` and do not have trailing slashes:

| Resource | Endpoints |
| --- | --- |
| Authentication | `GET /auth/csrf`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout` |
| Account | `GET/PATCH /users/me`, `POST /users/me/password` |
| Profile | `GET/PATCH /users/me/profile` |
| AI preferences | `GET/PUT /users/me/preferences` |
| Statistics | `GET /users/me/statistics` |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}`, `GET /projects/{id}/workspace` |
| Dashboard actions | `POST /projects/{id}/actions/{action}` |
| Acts | `GET/POST /projects/{id}/acts`, `GET/PATCH/DELETE /acts/{id}` |
| Characters | `GET/POST /projects/{id}/characters`, `GET/PATCH/DELETE /characters/{id}` |
| Scenes | `GET/POST /projects/{id}/scenes`, `GET/PATCH/DELETE /scenes/{id}` |
| Cast | `GET/POST /scenes/{id}/cast`, `GET/PATCH/DELETE /cast/{id}` |
| Prompt history | `GET/POST /scenes/{id}/prompts`, `GET /prompts/{id}`, `GET /prompts/{id}/run` |
| Generation runs | `GET /scenes/{id}/runs`, `GET /runs/{id}` |
| Agent logs | `GET /runs/{id}/agents`, `GET /agent-executions/{id}` |
| Variants | `GET /runs/{id}/variants`, `GET /scenes/{id}/variants`, `GET /variants/{id}`, `POST /variants/{id}/select` |

All list endpoints use `?limit=20&offset=0` and return `{ "items": [...], "count": n }`.
The maximum limit is 100. Projects support `search` (title) and `collection`:
`all`, `recent`, `favorites`, `archive`, `trash`. The default collection excludes
archived/trashed projects. Actions are `favorite`, `unfavorite`, `archive`,
`unarchive`, `trash`, `restore`, `open`; they preserve existing project metadata.
`restore` removes the trash marker; an archived project stays archived.
`workspace` returns the project, acts, characters and scenes with their cast.

Create acts with `act_number`, scenes with `act_id` and `scene_number`, cast
members with `character_id`. Numbers must be unique within their project.
Update only supplied fields with `PATCH`; omitted values are preserved.
JSON objects supplied in a patch replace that JSON field, rather than merging it.
Changing a scene's `act_id` moves it within its existing project. Scene lists
accept `?act_id=...`; GET requests never move scenes.
Deleting a nonempty act returns 409: move or delete its scenes first.
Deleting a project or scene permanently cascades to related records according
to the ERD; moving a project to trash does not delete any records.

Prompt creation accepts `user_prompt` and optional `generation_parameters`
(`temperature`, `max_tokens`). The server fixes the model to Bielik 11B and
captures project/act/scene/cast/preferences in `context_snapshot`. Without explicit
parameters it uses the user's preferences. Prompt history is immutable and scoped
to a scene. This endpoint only saves the request: no LLM worker is connected yet,
so it does not fabricate a run. A prompt without a run returns 404 at `/prompts/{id}/run`.
Runs, agent executions and generated variants are server-managed read-only data.
Existing seeded examples are available through their GET endpoints.
Select a variant with `{ "apply_to_scene": false }` or explicitly apply its text
with `{ "apply_to_scene": true }`. Selection deselects other variants across all
runs for that scene. Applying replaces `content_text` and clears stale editor blocks
unless the variant includes replacement blocks in `critic_metadata.blocks`.

### Session and CSRF

Authentication uses Django's session cookie, not a token in local storage.
First request `GET /api/auth/csrf`, then send the returned `csrf_token` in the
`X-CSRFToken` header on every POST/PUT/PATCH/DELETE, including login/registration.
Preserve cookies (use `credentials: 'include'` with browser fetch). Login and
registration rotate the CSRF token: obtain a fresh one afterwards.
Login body: `{ "identifier": "username or email", "password": "..." }`.
Registration body: `{ "username": "...", "email": "...", "password": "...", "password_confirm": "..." }`.
Password change body: `{ "old_password": "...", "new_password": "...", "new_password_confirm": "..." }`.
Successful registration also logs the user in. Email is read-only after registration;
passwords are hashed with Django's password API and are never returned.
Login and registration are throttled to 10 anonymous requests per minute per IP.
The default local cache is process-local; a production multi-worker deployment
requires a shared cache and proxy/security configuration before exposure.

Preference PUT replaces both preference objects; `{}` resets them to defaults.
The model is fixed to `Bielik 11B (Lokalny)`, temperature is 0-1 in 0.1 steps,
and max tokens is 1-32768 (default 2048). Profile language currently accepts only
`pl`; avatar URLs must be absolute HTTP/HTTPS URLs, or empty to clear the avatar.

All business resources are scoped to their owner. Foreign resources return 404
and ownership cannot be overridden in payloads. Validation uses 422, uniqueness
race conflicts 409, missing session 401 and invalid CSRF 403. Model validation
errors return `detail` plus a `fields` dictionary. Schema errors use Ninja's
standard `detail` list. Unknown input fields are rejected.
See [Ninja authentication](https://django-ninja.dev/guide/authentication/) and
[CSRF](https://django-ninja.dev/guide/csrf/).

The frontend uses these routes for sessions, profiles, preferences, projects,
acts, scenes, cast, characters, prompt history, variants and statistics. No
browser-local project/profile/preference fallback is used. Cross-origin requests
are configured as described below.
No database model changes or new migrations are needed for this API.

### Frontend Integration

`frontend/src/hooks/useSession.ts` restores the Django session on mount and handles
real login, registration, password change and logout. The profile and AI settings
come from the account endpoints. Avatar editing uses the HTTP/HTTPS URL supported
by the backend; there is no file-upload endpoint yet.

`useWorkspace.ts` loads all project collections with pagination and bounded
workspace hydration. Project/act/character operations wait for API confirmation;
scene edits are debounced for 600 ms and serialized, including cast changes.
Failures retain unsaved scene drafts in memory, show a retry action and do not
report success. A before-unload warning protects pending writes. Undo/redo applies
only to scene editing and is persisted through the same save path; permanent
record deletion cannot be undone. Nonempty acts cannot be deleted before their
scenes are moved or removed. No domain data is loaded from or saved to localStorage.

`frontend/src/services/workspaceData.ts` maps API DTOs to editor view models,
preserving JSON metadata and server IDs. Editor blocks live in `editor_metadata`,
scene goals/notes in `ai_metadata`, and cast membership in `SceneCharacter`.
The editor's labeled heading field displays a complete heading such as
`WN. DOM - RANO`. `sceneHeading.ts` separates recognized Polish/English time labels
from the location when saving (`location_heading: "WN. DOM"`, `time_of_day: "RANO"`)
and joins them when loading. Hyphens in locations are preserved, and removing the
time or the entire heading clears the corresponding saved fields. Legacy records
with the full heading in `location_heading` are supported without duplicating the
time; existing custom time labels from the API are preserved. Records are normalized
through ordinary editor saves, without a bulk data rewrite or schema migration.
`usePromptHistory.ts` reads and saves scene-specific history through the API.
The assistant reads actual stored runs, agent executions and variants. Saving a
prompt does not claim to generate text: no LLM worker is connected yet. Choosing
or applying a stored variant uses the selection endpoint. Statistics include
server-provided prompt activity and generation totals.

The old static project data and AI simulator files have been removed. Existing
database records, including data created by the optional seed command, remain
ordinary persistent backend data; the frontend does not supply example records.

### Tests

Backend tests use Django's HTTP client, real session/CSRF middleware and PostgreSQL.
Django creates and removes a separate test database; the configured database user
must have permission to create it. Start PostgreSQL first; the Django and Vite
development servers do not need to be running. Existing application records are
not used or changed by these tests.

```powershell
.\venv\Scripts\python.exe manage.py test backend.test
```

The backend suite is divided into:

- `test_auth.py`, `test_account.py`: sessions, registration, passwords, profile and preferences.
- `test_projects.py`, `test_structure.py`, `test_characters.py`: project CRUD,
  collections, acts, scenes, characters and cast relationships.
- `test_generation.py`: prompts, context snapshots, runs and variants.
- `test_permissions.py`, `test_api_contract.py`, `test_cors.py`: ownership,
  validation, OpenAPI, cross-origin credentials and CSRF protection.
- `test_models.py`, `test_seed.py`: ERD constraints, JSON defaults, cascades and seeding.
- `test_workspace_flow.py`: complete editor payloads, dashboard actions, cast,
  scene moves and prompt snapshots surviving logout and a fresh login.
- `test_ollama.py`: fixed-model HTTP requests, response validation, connection and
  timeout failures, and the development-only ping endpoint (without a live LLM).

Frontend tests use Vitest, React Testing Library and jsdom. They run the actual
components/hooks/API client and intercept fetch at the HTTP boundary with
test-only DTOs. They do not require a running backend and do not contact the
application database. These are automated frontend integration tests; testing
cross-origin cookies in a real browser remains a separate end-to-end check.

From `frontend/`:

```powershell
npm ci
npm test
npm run test:typecheck
npm run build
```

`npm run test:watch` runs Vitest in watch mode. Test organization:

- `tests/api/`: CSRF, transport failures, request options and all 51 API operations.
- `tests/hooks/`: session restoration/expiry/logout, account preferences, profile,
  project loading, debounced scene saves, cast, undo/redo, structure and prompt history.
- `tests/services/`: DTO mapping, pagination, metadata preservation and error messages.
- `tests/components/`: authentication/project/preferences forms and prompt history UI.
- `tests/integration/`: complete App flows, including failed autosave blocking logout.
- `tests/support/`: isolated HTTP interception, test DTOs and deferred responses.

To run only one area: `npm test -- tests/hooks/useWorkspace.test.ts`, or from the
repository root: `.\venv\Scripts\python.exe manage.py test backend.test.test_auth`.

Rebuild the Docker setup image after installing these new dependencies:
`docker compose build db_setup`.

## React, CORS and Cookies

`django-cors-headers` is installed and registered. `CorsMiddleware` runs before
response-generating middleware and adds CORS headers only for `/api` paths.
Credentials are enabled, but only exact allowed origins are accepted; wildcard
access is disabled. Default request headers include `Content-Type` and
`X-CSRFToken`, and OPTIONS preflight allows GET/POST/PUT/PATCH/DELETE.
See the [package documentation](https://pypi.org/project/django-cors-headers/).

Local `.env` and `.env.example` configure both `CORS_ALLOWED_ORIGINS` and
`CSRF_TRUSTED_ORIGINS` for HTTP on `127.0.0.1` and `localhost`, ports 5173, 5174
and 4173 (Vite dev, fallback dev port and preview). Lists are comma-separated
origins with scheme and port, without paths or trailing slashes. Add an exact
origin to these lists if using another port, then restart Django.
When these environment variables are absent, DEBUG mode supplies the local list;
non-DEBUG mode defaults to no allowed origins. CSRF trust defaults to the CORS
list, but can be configured separately. An empty variable explicitly clears its list.

Use **the same hostname** on both sides, for example:

- Frontend: `http://127.0.0.1:5173`, API: `http://127.0.0.1:8000/api`.
- Or frontend: `http://localhost:5173`, API: `http://localhost:8000/api`.

Do not mix `localhost` and `127.0.0.1` for local HTTP session authentication:
they are different sites, and allowing CORS cannot override cookie SameSite rules.
Local cookies use `SameSite=Lax`; different ports on the same host work with this.
Session cookies stay HttpOnly and host-only. CSRF tokens can be read from the
existing `/api/auth/csrf` JSON response, so React need not read a different host's
cookies. The CSRF bootstrap response is marked `Cache-Control: no-store`.

Minimal browser fetch sequence (the React client handles this in `src/services/api.ts`):

```javascript
const api = 'http://127.0.0.1:8000/api';

async function csrfToken() {
  const response = await fetch(`${api}/auth/csrf`, {
    credentials: 'include', cache: 'no-store',
  });
  if (!response.ok) throw new Error(`CSRF request failed: ${response.status}`);
  return (await response.json()).csrf_token;
}

let token = await csrfToken();
const login = await fetch(`${api}/auth/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
  body: JSON.stringify({ identifier: 'your username or email', password: 'your password' }),
});
if (!login.ok) throw new Error(`Login failed: ${login.status}`);

token = await csrfToken(); // Login/register rotates the token; use this for subsequent writes.
const account = await fetch(`${api}/users/me`, { credentials: 'include' });
if (!account.ok) throw new Error(`Account request failed: ${account.status}`);
```

Every POST/PUT/PATCH/DELETE must use the current `X-CSRFToken` and
`credentials: 'include'`; GETs and the CSRF bootstrap must include credentials
too. Do not use `mode: 'no-cors'`, disable CSRF, or try to read `Set-Cookie` in JS.
CORS permission does not bypass login or CSRF validation.

For HTTPS deployment, replace the local allowlists with actual trusted frontend
origins. `SESSION_COOKIE_SECURE` and `CSRF_COOKIE_SECURE` default to True when
`DJANGO_DEBUG=False`, and False during local debug; explicit environment values
override these defaults. Prefer serving frontend/API on the same site. If they
must use different sites, set both `SESSION_COOKIE_SAMESITE=None` and
`CSRF_COOKIE_SAMESITE=None`, with both secure flags True and HTTPS. Invalid
SameSite values and SameSite=None without Secure fail at startup. Browsers may
still block third-party cookies independently of CORS, so a same-site deployment
or reverse proxy is more reliable. See [Django cookie settings](https://docs.djangoproject.com/en/6.1/ref/settings/#session-cookie-samesite).

CORS integration and credential tests are in `backend/test/test_cors.py` and run
with the rest of the backend test suite. No migrations are required.
