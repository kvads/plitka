from unittest.mock import MagicMock, patch

import psycopg
from fastapi.testclient import TestClient

from backend.database import ProjectConflict, check_database, save_project
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


def test_projects_are_listed_from_database():
    document = {"schemaVersion": 6, "id": "p-1", "documentRevision": 3}
    with patch("backend.main.list_projects", return_value=[document]):
        response = TestClient(app).get("/api/projects")
    assert response.status_code == 200
    assert response.json() == {"projects": [document]}


def test_project_save_uses_expected_revision():
    document = {"schemaVersion": 6, "id": "p-1", "documentRevision": 4}
    saved = {**document, "documentRevision": 5}
    with patch("backend.main.save_project", return_value=saved) as save:
        response = TestClient(app).put(
            "/api/projects/p-1",
            json={"document": document, "expectedRevision": 4},
        )
    assert response.status_code == 200
    assert response.json() == {"document": saved}
    save.assert_called_once_with("p-1", document, 4)


def test_project_save_rejects_mismatched_path_and_document():
    response = TestClient(app).put(
        "/api/projects/p-1",
        json={
            "document": {"schemaVersion": 6, "id": "other", "documentRevision": 0},
            "expectedRevision": None,
        },
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid project document"}


def test_project_save_reports_revision_conflict_without_overwriting():
    document = {"schemaVersion": 6, "id": "p-1", "documentRevision": 2}
    current = {**document, "documentRevision": 3}
    with patch("backend.main.save_project", side_effect=ProjectConflict(current)):
        response = TestClient(app).put(
            "/api/projects/p-1",
            json={"document": document, "expectedRevision": 2},
        )
    assert response.status_code == 409
    assert response.json() == {
        "detail": {"message": "Project revision conflict", "current": current}
    }


def test_project_delete_returns_repository_status():
    with patch("backend.main.delete_project", return_value="deleted") as delete:
        response = TestClient(app).delete(
            "/api/projects/p-1?expectedRevision=7"
        )
    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}
    delete.assert_called_once_with("p-1", 7)


def test_repository_update_is_guarded_by_revision(monkeypatch):
    monkeypatch.setenv("PGHOST", "db")
    connection = MagicMock()
    schema_result = MagicMock()
    update_result = MagicMock()
    update_result.fetchone.return_value = [
        {"schemaVersion": 6, "id": "p-1", "documentRevision": 5}
    ]
    connection.execute.side_effect = [schema_result, update_result]
    with patch("backend.database.psycopg.connect") as connect:
        connect.return_value.__enter__.return_value = connection
        saved = save_project(
            "p-1",
            {"schemaVersion": 6, "id": "p-1", "documentRevision": 4},
            4,
        )
    assert saved["documentRevision"] == 5
    update_sql, update_parameters = connection.execute.call_args_list[1].args
    assert "WHERE id = %s AND document_revision = %s" in update_sql
    assert update_parameters[0] == 5
    assert update_parameters[2:] == ("p-1", 4)


def test_password_gate_protects_project_api(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "R7m4Q2x9")
    client = TestClient(app)
    with patch("backend.main.list_projects", return_value=[]):
        assert client.get("/api/projects").status_code == 401
        assert client.post(
            "/api/auth/login", json={"password": "wrong123"}
        ).status_code == 401
        login = client.post("/api/auth/login", json={"password": "R7m4Q2x9"})
        assert login.status_code == 200
        assert login.json() == {"authenticated": True}
        assert client.get("/api/projects").json() == {"projects": []}


def test_password_gate_can_end_session(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "R7m4Q2x9")
    client = TestClient(app)
    assert client.post(
        "/api/auth/login", json={"password": "R7m4Q2x9"}
    ).status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    with patch("backend.main.list_projects", return_value=[]):
        assert client.get("/api/projects").status_code == 401


def test_password_must_contain_exactly_eight_characters(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "too-short")
    response = TestClient(app).get("/api/auth/status")
    assert response.status_code == 503
    assert response.json() == {"detail": "Application password is misconfigured"}
