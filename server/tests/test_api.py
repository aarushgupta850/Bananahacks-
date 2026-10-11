"""Smoke test for the live API. Needs no GPU and no running server."""

import api


def test_api_imports_and_health_says_ok():
    assert api.health() == {"ok": True}
    # The web app calls GET /health, so that exact route must exist.
    assert any(
        route.path == "/health" and "GET" in route.methods
        for route in api.app.routes
    )
