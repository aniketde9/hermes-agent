"""Tests for multi-profile ``hermes gateway start [--all]`` expansion."""

from __future__ import annotations

from types import SimpleNamespace

import pytest


def test_should_expand_start_all_from_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    from hermes_cli import gateway as gw

    monkeypatch.delenv("_HERMES_GATEWAY_START_ONE", raising=False)
    monkeypatch.setattr(gw, "_config_wants_start_all_profiles", lambda: False)
    assert gw._should_expand_start_all(SimpleNamespace(all=True)) is True
    assert gw._should_expand_start_all(SimpleNamespace(all=False)) is False


def test_should_expand_start_all_from_config(monkeypatch: pytest.MonkeyPatch) -> None:
    from hermes_cli import gateway as gw

    monkeypatch.delenv("_HERMES_GATEWAY_START_ONE", raising=False)
    monkeypatch.setattr(gw, "_config_wants_start_all_profiles", lambda: True)
    assert gw._should_expand_start_all(SimpleNamespace(all=False)) is True


def test_should_expand_start_all_blocked_for_siblings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from hermes_cli import gateway as gw

    monkeypatch.setenv("_HERMES_GATEWAY_START_ONE", "1")
    monkeypatch.setattr(gw, "_config_wants_start_all_profiles", lambda: True)
    assert gw._should_expand_start_all(SimpleNamespace(all=True)) is False


def test_start_other_profile_gateways_skips_running(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    from hermes_cli import gateway as gw

    profiles = [
        SimpleNamespace(name="default", is_default=True, gateway_running=True),
        SimpleNamespace(name="bot_news", is_default=False, gateway_running=True),
        SimpleNamespace(name="bot_summary", is_default=False, gateway_running=False),
    ]
    monkeypatch.setattr(
        "hermes_cli.profiles.list_profiles", lambda: profiles,
    )
    monkeypatch.setattr(
        "hermes_cli.profiles.get_active_profile_name", lambda: "default",
    )
    monkeypatch.setattr(gw, "get_python_path", lambda: "python")
    monkeypatch.setattr(gw, "is_windows", lambda: False)

    calls: list[list[str]] = []

    class _Proc:
        returncode = 0
        stdout = "✓ Gateway started"
        stderr = ""

    def _run(argv, **_kwargs):
        calls.append(argv)
        return _Proc()

    monkeypatch.setattr(gw.subprocess, "run", _run)
    gw._start_other_profile_gateways()
    out = capsys.readouterr().out
    assert "bot_news: already running" in out
    assert calls == [
        ["python", "-m", "hermes_cli.main", "-p", "bot_summary", "gateway", "start"]
    ]
