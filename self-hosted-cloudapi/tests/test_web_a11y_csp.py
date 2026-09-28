"""Accessibility and a Content Security Policy for the web panel (UI plan 3.5).

A keyboard reader can skip the top bar; small text passes WCAG AA contrast;
data tables are labelled; the live status is announced; decorative emoji are
hidden from screen readers; every font size comes from the type scale. And no
page needs inline script or inline handlers any more, which is what lets the
panel send a CSP whose script-src is only 'self'.
"""

import json
import re
from pathlib import Path

import pytest

from src.auth.web_session import get_web_user_optional
from src.models.task import Task, TaskShare
from tests.web_helpers import _add_message, _llm_event, _msgs, _override_web_user, _seed_user, _summarize

_WEB = Path(__file__).resolve().parent.parent / "src" / "web"
_CSS = (_WEB / "static" / "app.css").read_text(encoding="utf-8")
_TEMPLATES = sorted((_WEB / "templates").glob("*.html"))
# The two sign-in pages hand a browser back to VS Code and are served outside
# the panel (routers/browser.py); they keep their own inline style and script.
_STANDALONE = {"auth_success.html", "auth_error.html"}


async def _seed_everything(session_factory):
    async with session_factory() as s:
        await _seed_user(s)
        s.add(Task(id="run", user_id="user_test", workspace_path="/home/a/proj"))
        await s.flush()
        for m in _msgs():
            await _add_message(s, "run", m)
        await _add_message(
            s,
            "run",
            {"ts": 9, "type": "say", "say": "api_req_started", "text": json.dumps({"tokensIn": 10, "cost": 0.1})},
        )
        s.add(_llm_event(task_id="run"))
        s.add(TaskShare(task_id="run", visibility="public", share_url="http://testserver/shared/run"))
        await _summarize(s, "run")
        await s.commit()


def _pages(client, *paths):
    _override_web_user(client.app)
    try:
        return {p: client.get(p) for p in paths}
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)


_PANEL = ("/app", "/app/tasks/run", "/app/metrics", "/app/settings", "/app/tasks/missing")


@pytest.fixture
async def rendered(client, session_factory, monkeypatch):
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)
    await _seed_everything(session_factory)
    pages = _pages(client, *_PANEL)
    pages["/shared/run"] = client.get("/shared/run")
    return pages


# --- skip link, landmarks -----------------------------------------------------


async def test_every_page_starts_with_a_skip_link(rendered):
    for path, resp in rendered.items():
        body = resp.text[resp.text.index("<body"):]
        first_link = re.search(r"<a\b[^>]*>", body).group(0)
        assert 'href="#main"' in first_link and "skip-link" in first_link, path
        assert re.search(r'<main id="main"[^>]*tabindex="-1"', resp.text), path


# --- contrast and type scale --------------------------------------------------


def _root_tokens(css: str) -> dict[str, str]:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    root = css[css.index(":root {"):]
    root = root[:root.index("\n}")]
    return dict(re.findall(r"(--[\w-]+):\s*([^;]+);", root))


def _luminance(hex_color: str) -> float:
    h = hex_color.lstrip("#")
    channels = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a: str, b: str) -> float:
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def test_faint_text_passes_aa_on_every_surface_it_sits_on():
    tokens = _root_tokens(_CSS)
    faint = tokens["--text-faint"]
    for surface in ("--bg", "--surface-1"):
        assert contrast(faint, tokens[surface]) >= 4.5, (faint, surface, contrast(faint, tokens[surface]))


def test_every_font_size_comes_from_the_type_scale():
    sizes = re.findall(r"(?<![\w-])font-size:\s*([^;]+);", _CSS)
    stray = [s for s in sizes if not s.strip().startswith("var(--t-")]
    assert stray == []
    tokens = _root_tokens(_CSS)
    assert tokens["--t-h1"] == "clamp(1.25rem, 1rem + 1vw, 1.5rem)"
    page_title = _CSS[_CSS.index(".page-title {"):]
    assert "font-size: var(--t-h1);" in page_title[:page_title.index("}")]


# --- tables, live status, emoji -----------------------------------------------


async def test_data_tables_have_captions_and_column_scopes(rendered):
    seen = 0
    for path in ("/app/tasks/run", "/app/metrics"):
        html = rendered[path].text
        for table in re.findall(r"<table\b.*?</table>", html, re.DOTALL):
            seen += 1
            assert "<caption" in table, path
            head = table[table.index("<thead"):table.index("</thead>")]
            ths = re.findall(r"<th\b[^>]*>", head)
            assert ths and all('scope="col"' in th for th in ths), (path, ths)
    assert seen >= 4  # the spend table and three breakdowns


async def test_live_status_is_announced(rendered):
    html = rendered["/app/tasks/run"].text
    status = re.search(r'<span id="live-status"[^>]*>', html).group(0)
    assert 'role="status"' in status and 'aria-live="polite"' in status


async def test_decorative_emoji_are_hidden_from_screen_readers(rendered):
    emoji = re.compile("[\U0001F300-\U0001FAFF]")
    for path, resp in rendered.items():
        for match in emoji.finditer(resp.text):
            before = resp.text[:match.start()]
            opening = before[before.rindex("<"):]
            assert 'aria-hidden="true"' in opening, (path, match.group(0), opening)


async def test_the_task_list_announces_its_count_after_a_filter(rendered):
    html = rendered["/app"].text
    status = re.search(r'<p id="list-status"[^>]*>', html).group(0)
    assert 'role="status"' in status and "sr-only" in status
    # Outside the swapped region, so the same live region stays in the page.
    assert html.index('id="list-status"') < html.index('id="task-results"')


# --- no inline script, no inline handlers -------------------------------------


_HANDLER = re.compile(r"\son[a-z]+\s*=", re.IGNORECASE)


@pytest.mark.parametrize("template", [t for t in _TEMPLATES if t.name not in _STANDALONE], ids=lambda p: p.name)
def test_templates_have_no_inline_handlers_or_display_none(template):
    source = template.read_text(encoding="utf-8")
    assert not _HANDLER.search(source)
    assert "display:none" not in source.replace(" ", "")
    # A <style> element would need 'unsafe-inline' (the no-script tree style
    # became a stylesheet link).
    assert "<style" not in source


async def test_pages_run_no_inline_script(rendered):
    for path, resp in rendered.items():
        for tag, body in re.findall(r"(<script\b[^>]*>)(.*?)</script>", resp.text, re.DOTALL):
            if 'src="' in tag:
                assert not body.strip(), path
            else:
                # Data islands only: a type the browser never executes.
                assert 'type="application/json"' in tag, (path, tag)
        assert not _HANDLER.search(re.sub(r"<script\b.*?</script>", "", resp.text, flags=re.DOTALL)), path


async def test_confirmations_are_data_attributes(rendered):
    detail = rendered["/app/tasks/run"].text
    form = re.search(r'<form class="task-delete-detail"[^>]*>', detail).group(0)
    assert "data-confirm=" in form and "permanently" in form
    settings_page = rendered["/app/settings"].text
    run = re.search(r'<form method="post" action="/app/settings/run"[^>]*>', settings_page).group(0)
    assert "data-confirm=" in run
    # The handler lives in a script every page loads.
    for resp in rendered.values():
        assert re.search(r'<script src="/static/app\.js\?v=\w+" defer></script>', resp.text)


async def test_live_controls_start_hidden_with_the_attribute(rendered):
    html = rendered["/app/tasks/run"].text
    assert re.search(r'<span id="live-activity"[^>]*\shidden>', html)
    assert re.search(r'<button id="btn-stop"[^>]*\shidden>', html)


# --- the header ---------------------------------------------------------------


def _csp(resp) -> dict[str, list[str]]:
    header = resp.headers.get("content-security-policy")
    assert header, "no Content-Security-Policy header"
    out = {}
    for part in header.split(";"):
        words = part.split()
        if words:
            out[words[0]] = words[1:]
    return out


async def test_panel_pages_carry_a_strict_csp(rendered):
    for path, resp in rendered.items():
        policy = _csp(resp)
        assert policy["default-src"] == ["'self'"], path
        assert policy["script-src"] == ["'self'"], path
        assert policy["object-src"] == ["'none'"], path
        assert policy["base-uri"] == ["'self'"], path
        assert policy["form-action"] == ["'self'"], path
        assert policy["frame-ancestors"] == ["'none'"], path
        assert policy["style-src"] == ["'self'"], path
        # The bridge's socket.io connection, polling and websocket.
        assert "'self'" in policy["connect-src"] and "ws://testserver" in policy["connect-src"], path
        # Attachments are data: URLs.
        assert "data:" in policy["img-src"], path
        for directive, sources in policy.items():
            assert "'unsafe-eval'" not in sources, (path, directive)
            if directive != "style-src-attr":
                assert "'unsafe-inline'" not in sources, (path, directive)


async def test_the_login_page_and_api_are_left_alone(client):
    """The sign-in pages keep their inline script; JSON needs no policy."""
    assert "content-security-policy" not in client.get("/health").headers
    resp = client.get("/auth/error", params={"message": "nope"})
    assert "content-security-policy" not in resp.headers


# --- empty states -------------------------------------------------------------


async def test_an_empty_list_explains_how_to_connect(client, db_session):
    from config.settings import settings as app_settings

    await _seed_user(db_session)
    html = _pages(client, "/app")["/app"].text
    panel = html[html.index('class="connect'):]
    assert "tumble-code.cloudApiUrl" in panel
    assert f'<code id="api-url">{app_settings.api_base_url}</code>' in panel
    assert re.search(r'<button type="button" class="btn ghost copy-btn" data-copy="#api-url" hidden>', panel)
    assert "Share" in panel
