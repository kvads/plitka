from unittest.mock import MagicMock, patch

import psycopg
from fastapi.testclient import TestClient

from backend.database import check_database
from backend.main import app


def test_database_is_optional_outside_docker(monkeypatch):
    monkeypatch.delenv("PGHOST", raising=False)
    assert TestClient(app).get("/api/ready").json() == {
        "status": "ok", "database": "not_configured",
    }


def test_database_checks_query(monkeypatch):
    monkeypatch.setenv("PGHOST", "db")
    monkeypatch.setenv("PGOPTIONS", "-c search_path=plitka")
    connection = MagicMock()
    with patch("backend.database.psycopg.connect") as connect:
        connect.return_value.__enter__.return_value = connection
        assert check_database() == "ok"
        connect.assert_called_once_with(
            connect_timeout=3,
            options="-c search_path=plitka -c statement_timeout=3000",
        )
    connection.execute.assert_called_once_with("SELECT 1")


def test_readiness_hides_connection_details():
    with patch("backend.main.check_database", side_effect=psycopg.OperationalError("secret")):
        response = TestClient(app).get("/api/ready")
        assert response.status_code == 503
        assert response.json() == {"detail": "Database unavailable"}
        assert TestClient(app).get("/api/health").status_code == 200
