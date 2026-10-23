"""PostgreSQL connectivity and durable project storage."""

import os
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.types.json import Jsonb


PROJECTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY,
    document_revision integer NOT NULL CHECK (document_revision >= 0),
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
)
"""


def _connect_options() -> dict[str, Any]:
    # libpq reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE.
    options = os.environ.get("PGOPTIONS", "") + " -c statement_timeout=3000"
    return {"connect_timeout": 3, "options": options.strip()}


def _require_database() -> None:
    if not os.environ.get("PGHOST"):
        raise RuntimeError("Database is not configured")


@dataclass
class ProjectConflict(Exception):
    current: dict[str, Any]


def _ensure_schema(connection: psycopg.Connection[Any]) -> None:
    connection.execute(PROJECTS_SCHEMA)


def check_database() -> str:
    if not os.environ.get("PGHOST"):
        return "not_configured"
    with psycopg.connect(**_connect_options()) as connection:
        connection.execute("SELECT 1")
    return "ok"


def list_projects() -> list[dict[str, Any]]:
    _require_database()
    with psycopg.connect(**_connect_options()) as connection:
        _ensure_schema(connection)
        rows = connection.execute(
            "SELECT document FROM projects ORDER BY created_at, id"
        ).fetchall()
    return [row[0] for row in rows]


def save_project(
    project_id: str,
    document: dict[str, Any],
    expected_revision: int | None,
) -> dict[str, Any]:
    """Insert or update a document, atomically enforcing its revision."""
    next_revision = 0 if expected_revision is None else expected_revision + 1
    saved = {**document, "documentRevision": next_revision}
    _require_database()
    with psycopg.connect(**_connect_options()) as connection:
        _ensure_schema(connection)
        if expected_revision is None:
            row = connection.execute(
                """
                INSERT INTO projects (id, document_revision, document)
                VALUES (%s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                RETURNING document
                """,
                (project_id, next_revision, Jsonb(saved)),
            ).fetchone()
        else:
            row = connection.execute(
                """
                UPDATE projects
                   SET document_revision = %s, document = %s, updated_at = now()
                 WHERE id = %s AND document_revision = %s
                RETURNING document
                """,
                (next_revision, Jsonb(saved), project_id, expected_revision),
            ).fetchone()
        if row is not None:
            return row[0]
        current = connection.execute(
            "SELECT document FROM projects WHERE id = %s", (project_id,)
        ).fetchone()
        raise ProjectConflict(current[0] if current else {})


def delete_project(project_id: str, expected_revision: int) -> str:
    """Delete a project at a known revision without racing another writer."""
    _require_database()
    with psycopg.connect(**_connect_options()) as connection:
        _ensure_schema(connection)
        deleted = connection.execute(
            "DELETE FROM projects WHERE id = %s AND document_revision = %s RETURNING id",
            (project_id, expected_revision),
        ).fetchone()
        if deleted is not None:
            return "deleted"
        current = connection.execute(
            "SELECT document FROM projects WHERE id = %s", (project_id,)
        ).fetchone()
        if current is None:
            return "alreadyMissing"
        raise ProjectConflict(current[0])
