"""Kanban workers must execute tasks in-process, never re-spawn Hermes.

The dispatcher already launched this process with ``HERMES_KANBAN_TASK`` set
and query ``work kanban task <id>``. The CLI must load the task from the
kanban DB and run the agent loop directly — spawning another
``hermes -p <profile> chat -q ...`` would recurse until the host runs out of
processes.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from hermes_cli import kanban_db as kb


@pytest.fixture
def kanban_home(tmp_path: Path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    kb.init_db()
    return home


def _create_task(*, title: str = "Fix the bug", body: str = "Do the work.") -> str:
    conn = kb.connect()
    try:
        return kb.create_task(
            conn,
            title=title,
            body=body,
            assignee="worker-a",
        )
    finally:
        conn.close()


class TestPrepareKanbanWorkerSingleQuery:
    def test_enriches_literal_worker_query_with_context(self, kanban_home):
        from cli import _prepare_kanban_worker_single_query

        tid = _create_task(title="Ship feature", body="Implement the API endpoint.")
        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setenv("HERMES_KANBAN_TASK", tid)
        try:
            query, images, urls = _prepare_kanban_worker_single_query(
                f"work kanban task {tid}",
            )
        finally:
            monkeypatch.undo()

        assert query.startswith(f"work kanban task {tid}\n\n")
        assert "Ship feature" in query
        assert "Implement the API endpoint." in query
        assert images == []
        assert urls == []

    def test_uses_env_task_id_when_worker_env_is_set(self, kanban_home):
        from cli import _prepare_kanban_worker_single_query

        tid = _create_task(title="Env wins", body="From env task.")
        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setenv("HERMES_KANBAN_TASK", tid)
        try:
            query, _, _ = _prepare_kanban_worker_single_query(
                f"work kanban task {tid}",
            )
        finally:
            monkeypatch.undo()

        assert f"work kanban task {tid}" in query
        assert "Env wins" in query

    def test_does_not_spawn_subprocess_for_worker_query(self, kanban_home, monkeypatch):
        from cli import _prepare_kanban_worker_single_query

        tid = _create_task()
        monkeypatch.setenv("HERMES_KANBAN_TASK", tid)

        popen = MagicMock(side_effect=AssertionError("must not spawn Hermes child"))
        monkeypatch.setattr(subprocess, "Popen", popen)

        query, _, _ = _prepare_kanban_worker_single_query(f"work kanban task {tid}")

        assert f"work kanban task {tid}" in query
        popen.assert_not_called()

    def test_non_kanban_query_is_unchanged(self, kanban_home):
        from cli import _prepare_kanban_worker_single_query

        query, images, urls = _prepare_kanban_worker_single_query("What is Python?")
        assert query == "What is Python?"
        assert images == []
        assert urls == []
