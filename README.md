# AgentDraft

## Layout

- `frontend/`: React, TypeScript and Vite application.
- `backend/core/`: Django settings, URLs, ASGI and WSGI entry points.
- `manage.py`, `venv/`, `requirements.txt`: kept in the repository root.
- `compose.yaml`: PostgreSQL service and persistent `agentdraft_postgres_data` volume.
- `.env`: local credentials, already excluded by `.gitignore`.
- `.env.example`: configuration template without real secrets.

## Local Backend

Run commands from the repository root in PowerShell:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
docker compose up -d --wait db
.\venv\Scripts\python.exe manage.py check --database default
.\venv\Scripts\python.exe manage.py runserver
```

On a fresh checkout, first create `.env` using `.env.example` and replace its
secret values. Existing shell environment variables take precedence over `.env`.
The database and database user are both named `agentdraft`; its password is in
`.env`. Django connects to `127.0.0.1:5432` (port `5432` inside the container).
Changing `POSTGRES_PORT` updates both
Django's connection and Docker's published host port.

PostgreSQL 18 stores data in a named volume mounted at `/var/lib/postgresql`,
following the [official image documentation](https://hub.docker.com/_/postgres).
`docker compose down` preserves this volume. Do not use `docker compose down -v`
unless you intend to delete the database. Changing database credentials in `.env`
does not update a database that has already been initialized.

This setup only prepares PostgreSQL and Django connectivity. ERD models and
database migrations have not been added or applied yet.
