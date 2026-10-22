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
