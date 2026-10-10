import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DATABASE_PATH = Path(__file__).resolve().parent / "storage" / "jobs.sqlite3"


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def initialize_job_store() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(_connect()) as connection, connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS render_jobs (
                id TEXT PRIMARY KEY,
                upload_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                parameters_json TEXT NOT NULL,
                status TEXT NOT NULL,
                result_text TEXT,
                output_url TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS render_jobs_status_created "
            "ON render_jobs(status, created_at)"
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(render_jobs)")}
        if "result_text" not in columns:
            connection.execute("ALTER TABLE render_jobs ADD COLUMN result_text TEXT")
        connection.execute(
            "UPDATE render_jobs SET status = 'queued', error = NULL, updated_at = ? "
            "WHERE status = 'running'",
            (_timestamp(),),
        )


def create_job(
    job_id: str,
    upload_id: str,
    operation: str,
    parameters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    timestamp = _timestamp()
    with closing(_connect()) as connection, connection:
        connection.execute(
            """
            INSERT INTO render_jobs (
                id, upload_id, operation, parameters_json, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'queued', ?, ?)
            """,
            (job_id, upload_id, operation, json.dumps(parameters or {}), timestamp, timestamp),
        )
    job = get_job(job_id)
    if job is None:
        raise RuntimeError("New render job was not persisted.")
    return job


def claim_next_job() -> dict[str, Any] | None:
    with closing(_connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM render_jobs WHERE status = 'queued' "
            "ORDER BY created_at, id LIMIT 1"
        ).fetchone()
        if row is None:
            connection.commit()
            return None

        changed = connection.execute(
            "UPDATE render_jobs SET status = 'running', updated_at = ? "
            "WHERE id = ? AND status = 'queued'",
            (_timestamp(), row["id"]),
        ).rowcount
        connection.commit()
        if changed != 1:
            return None

    job = dict(row)
    job["status"] = "running"
    job["parameters"] = json.loads(job.pop("parameters_json"))
    return job


def update_job(
    job_id: str,
    *,
    status: str,
    output_url: str | None = None,
    error: str | None = None,
    result_text: str | None = None,
) -> None:
    with closing(_connect()) as connection, connection:
        connection.execute(
            "UPDATE render_jobs SET status = ?, output_url = ?, error = ?, "
            "result_text = COALESCE(?, result_text), updated_at = ? "
            "WHERE id = ?",
            (status, output_url, error, result_text, _timestamp(), job_id),
        )


def get_job(job_id: str) -> dict[str, Any] | None:
    with closing(_connect()) as connection:
        row = connection.execute(
            "SELECT * FROM render_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if row is None:
        return None

    job = dict(row)
    job["parameters"] = json.loads(job.pop("parameters_json"))
    return job


def public_job(job: dict[str, Any]) -> dict[str, str | None]:
    return {
        "id": job["id"],
        "operation": job["operation"],
        "status": job["status"],
        "result_text": job["result_text"],
        "output_url": job["output_url"],
        "error": job["error"],
    }
