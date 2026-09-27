"""The login limit behind the reverse proxy the manual tells people to run.

The limit is counted per client address, and behind a proxy that address is whatever
uvicorn's `ProxyHeadersMiddleware` makes of `X-Forwarded-For` — so whether a stranger can
guess forever, or lock the owner out, is decided by the deploy page's nginx snippet and
its `FORWARDED_ALLOW_IPS`, not by the code. These tests read both out of the manual and
drive the real app through them, the way the proxy and uvicorn would.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from backend.api.app import create_app
from backend.config import Settings
from backend.services import auth as auth_service
from tests.conftest import API_BASE_URL, OWNER_PASSWORD

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_PAGES = [ROOT / "manual" / lang / "operate" / "deploy.md" for lang in ("en", "de")]
WRONG = "not-the-password"
STRANGER = "203.0.113.66"
OWNER = "198.51.100.7"


def documented(page: Path) -> tuple[str, list[str]]:
    """The nginx `X-Forwarded-For` value and the trusted addresses the page's Docker
    examples give, in page order — the proxy on the host (the network's gateway) first,
    then the proxy in a container of its own."""
    text = page.read_text(encoding="utf-8")
    nginx = re.findall(r"proxy_set_header\s+X-Forwarded-For\s+(\S+);", text)
    trusted = list(dict.fromkeys(re.findall(r"FORWARDED_ALLOW_IPS:\s*(\S+)", text)))
    assert len(nginx) == 1, f"{page}: expected one nginx X-Forwarded-For line"
    assert trusted, f"{page}: no FORWARDED_ALLOW_IPS value in the Docker examples"
    return nginx[0], trusted


# Every (page, Docker example) pair, so each documented address is driven on a fresh app.
EXAMPLES = [(page, n) for page in DEPLOY_PAGES for n in range(len(documented(page)[1]))]


def example_id(value: object) -> str:
    return value.parts[-3] if isinstance(value, Path) else f"example{value}"


def forwarded_for(directive: str, sent: str | None, peer: str) -> str:
    """What nginx puts in `X-Forwarded-For` for a client at `peer` that sent `sent`."""
    if directive == "$remote_addr":
        return peer
    if directive == "$proxy_add_x_forwarded_for":
        return f"{sent}, {peer}" if sent else peer
    raise AssertionError(f"an nginx value this test does not model: {directive}")


@pytest.fixture()
def app(settings: Settings) -> Iterator[object]:
    settings.analysis_workers = False
    application = create_app(settings)
    with TestClient(application, base_url=API_BASE_URL) as setup:
        assert setup.post("/auth/setup", json={"password": OWNER_PASSWORD}).status_code == 200
    yield application


def through_the_proxy(app: object, trusted: str, gateway: str) -> TestClient:
    """The app as uvicorn serves it, reached from the address the proxy connects from."""
    wrapped = ProxyHeadersMiddleware(app, trusted_hosts=trusted)  # type: ignore[arg-type]
    return TestClient(wrapped, base_url=API_BASE_URL, client=(gateway, 40000))


@pytest.mark.parametrize("page", DEPLOY_PAGES, ids=lambda page: page.parts[-3])
def test_the_deploy_page_never_recommends_trusting_everyone(page: Path) -> None:
    text = page.read_text(encoding="utf-8")
    assert "`*` on a network" not in text
    assert "oder `*` in einem Netz" not in text
    directive, trusted = documented(page)
    assert directive == "$remote_addr"
    assert "*" not in trusted


def test_the_pages_give_the_same_addresses() -> None:
    assert documented(DEPLOY_PAGES[0]) == documented(DEPLOY_PAGES[1])


def test_the_compose_file_points_at_the_same_gateway() -> None:
    """The shipped compose file is the proxy-on-the-host case, the page's first example."""
    _, trusted = documented(DEPLOY_PAGES[0])
    compose = (ROOT / "docker" / "docker-compose.yml").read_text(encoding="utf-8")
    assert f"FORWARDED_ALLOW_IPS: {trusted[0]}" in compose
    assert f"gateway: {trusted[0]}" in compose


@pytest.mark.parametrize(("page", "example"), EXAMPLES, ids=example_id)
def test_forged_addresses_do_not_buy_fresh_guesses(app: object, page: Path, example: int) -> None:
    """A stranger writing a new `X-Forwarded-For` on every guess is still one address."""
    directive, addresses = documented(page)
    trusted = addresses[example]
    with through_the_proxy(app, trusted, gateway=trusted) as proxy:
        statuses = [
            proxy.post(
                "/auth/login",
                json={"password": WRONG},
                headers={"x-forwarded-for": forwarded_for(directive, f"10.9.{n}.1", STRANGER)},
            ).status_code
            for n in range(auth_service.LOCKOUT_THRESHOLD * 4)
        ]
    assert 429 in statuses
    assert statuses.index(429) <= auth_service.LOCKOUT_THRESHOLD


@pytest.mark.parametrize(("page", "example"), EXAMPLES, ids=example_id)
def test_the_owner_behind_the_same_proxy_keeps_a_limit_of_their_own(
    app: object, page: Path, example: int
) -> None:
    """The proxy's address is shared; the visitors behind it are not."""
    directive, addresses = documented(page)
    trusted = addresses[example]
    with through_the_proxy(app, trusted, gateway=trusted) as proxy:
        for _ in range(auth_service.LOCKOUT_THRESHOLD + 2):
            proxy.post(
                "/auth/login",
                json={"password": WRONG},
                headers={"x-forwarded-for": forwarded_for(directive, None, STRANGER)},
            )
        owner = proxy.post(
            "/auth/login",
            json={"password": OWNER_PASSWORD},
            headers={"x-forwarded-for": forwarded_for(directive, None, OWNER)},
        )
    assert owner.status_code == 200, owner.text


def test_the_nginx_snippet_holds_even_where_everyone_is_trusted(app: object) -> None:
    """Someone who set `*` anyway: nginx overwriting the header still leaves the stranger
    one address, because the only entry is the one nginx saw."""
    directive, trusted = documented(DEPLOY_PAGES[0])
    with through_the_proxy(app, "*", gateway=trusted[0]) as proxy:
        statuses = [
            proxy.post(
                "/auth/login",
                json={"password": WRONG},
                headers={"x-forwarded-for": forwarded_for(directive, f"10.9.{n}.1", STRANGER)},
            ).status_code
            for n in range(auth_service.LOCKOUT_THRESHOLD * 4)
        ]
    assert 429 in statuses
