# AgentDraft

## Layout

- `frontend/`: React, TypeScript and Vite application.
- `backend/`: Django settings, URLs, ASGI and WSGI entry points.
- `backend/api/`: Django application registered as `backend.api.apps.ApiConfig`;
  contains models corresponding to the database ERD.
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

Run the backend with `.\venv\Scripts\python.exe manage.py runserver` from the
repository root. Interactive documentation is at
<http://127.0.0.1:8000/api/docs>; OpenAPI is at
<http://127.0.0.1:8000/api/openapi.json>.

Implementation:

- `backend/api/api.py`: routes, session authentication and HTTP responses.
- `backend/api/scheams.py`: typed request/response contracts (requested filename).
- `backend/api/services.py`: ownership checks, validated saves and context snapshots.
- `backend/api/test_api.py`: HTTP, CSRF, authorization and workflow tests.
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

The frontend still uses its existing mocks; it has not been connected to these
routes. For future integration, use a same-origin development proxy or explicitly
configure allowed CORS/CSRF origins; permissive cross-origin access is not enabled.
No database model changes or new migrations are needed for this API.

Tests (Django creates and removes a separate PostgreSQL test database):

```powershell
.\venv\Scripts\python.exe manage.py test backend.api
```

Rebuild the Docker setup image after installing these new dependencies:
`docker compose build db_setup`.
