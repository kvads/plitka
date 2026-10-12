"""PostgreSQL connectivity; project persistence is still browser-local."""

import os

import psycopg


def check_database() -> str:
    if not os.environ.get("PGHOST"):
        return "not_configured"
    # libpq reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE.
    with psycopg.connect(connect_timeout=3, options="-c statement_timeout=3000") as connection:
        connection.execute("SELECT 1")
    return "ok"
