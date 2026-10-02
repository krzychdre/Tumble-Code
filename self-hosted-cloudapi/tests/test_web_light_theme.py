"""A light theme for the web panel, chosen by the OS or by the reader (UI plan 3.1).

Every colour token in :root is a ``light-dark(light, dark)`` pair, so each
colour is written once; the color-scheme (the OS preference, or the reader's
forced choice) picks the side, and everything else in app.css reads the
tokens. The reader's choice (auto, dark, light) lives in
localStorage and is applied by a script in <head> before the first paint.
"""

import re
from pathlib import Path

import pytest

from src.auth.web_session import get_web_user_optional
from tests.test_web_a11y_csp import contrast
from tests.web_helpers import _override_web_user, _seed_user

_STATIC = Path(__file__).resolve().parent.parent / "src" / "web" / "static"
_CSS = (_STATIC / "app.css").read_text(encoding="utf-8")
_NO_COMMENTS = re.sub(r"/\*.*?\*/", "", _CSS, flags=re.DOTALL)


def _block(css: str, selector: str) -> str:
    start = css.index(selector)
    body = css[css.index("{", start) + 1:]
    depth, end = 1, 0
    for end, ch in enumerate(body):
        depth += {"{": 1, "}": -1}.get(ch, 0)
        if depth == 0:
            break
    return body[:end]


def _tokens(block: str) -> dict[str, str]:
    return {k: v.strip() for k, v in re.findall(r"(--[\w-]+):\s*([^;]+);", block)}


_PAIR = re.compile(r"^light-dark\((.+?),\s*((?:#|rgba?\().+)\)$")


def _side(value: str, theme: str) -> str:
    """One side of a ``light-dark(light, dark)`` token; other tokens as they are."""
    pair = _PAIR.match(value)
    if not pair:
        return value
    return pair.group(1).strip() if theme == "light" else pair.group(2).strip()


def _theme(theme: str) -> dict[str, str]:
    return {k: _side(v, theme) for k, v in _tokens(_block(_NO_COMMENTS, ":root {")).items()}


def _dark() -> dict[str, str]:
    return _theme("dark")


def _light() -> dict[str, str]:
    return _theme("light")


def test_every_colour_is_written_once_for_both_themes():
    raw = _tokens(_block(_NO_COMMENTS, ":root {"))
    colours = {k: v for k, v in raw.items() if re.search(r"#[0-9a-fA-F]{3,8}\b|rgba?\(", v)}
    assert colours
    # A colour token is a light-dark() pair whose two sides are colours.
    singles = sorted(k for k, v in colours.items() if not _PAIR.match(v))
    assert singles == [], singles
    # No second palette anywhere: the scheme picks the side.
    assert "prefers-color-scheme" not in _NO_COMMENTS
    assert "color-scheme: light dark" in _block(_NO_COMMENTS, ":root {")
    # The reader's forced choice pins the scheme, and the UA widgets
    # (scrollbars, date pickers) follow it.
    assert _block(_NO_COMMENTS, ':root[data-theme="light"]').strip() == "color-scheme: light;"
    assert _block(_NO_COMMENTS, ':root[data-theme="dark"]').strip() == "color-scheme: dark;"


def test_the_light_accent_is_the_darker_amber():
    assert _light()["--signal"].lower() == "#9a5b00"


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_text_and_data_hues_pass_aa_on_the_page_and_the_panels(theme):
    t = _dark() if theme == "dark" else _light()
    grounds = ("--bg", "--surface-1")
    for fg in ("--text", "--text-dim", "--text-faint", "--signal", "--d-in", "--d-out", "--d-cache",
               "--d-cost", "--d-error", "--d-you", "--status-run"):
        for bg in grounds:
            assert contrast(t[fg], t[bg]) >= 4.5, (theme, fg, bg, round(contrast(t[fg], t[bg]), 2))
    # The signed-in initial in the top bar: text on the highest surface.
    assert contrast(t["--text"], t["--surface-3"]) >= 4.5, (theme, "--text", "--surface-3")
    # Text set on a filled button.
    for ink, fill in (("--signal-ink", "--signal"), ("--d-error-ink", "--d-error"), ("--d-cache-ink", "--d-cache")):
        assert contrast(t[ink], t[fill]) >= 4.5, (theme, ink, fill)


def test_no_colour_literal_outside_the_token_blocks():
    """A literal would stay dark-theme in the light theme (the top bar's
    rgba(13, 17, 23, .85) did)."""
    rest = _NO_COMMENTS.replace(_block(_NO_COMMENTS, ":root {"), "")
    literals = re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)", rest)
    assert literals == []
    topbar = _block(_NO_COMMENTS, ".topbar {")
    assert "color-mix(in srgb, var(--bg) 85%, transparent)" in topbar


def test_chart_colours_come_from_the_css_variables():
    """The charts are server-rendered SVG (test_web_metrics_svg); their marks
    are coloured by classes that read the tokens, so they follow the theme."""
    for rule in (
        ".chart-line-tokens",
        ".chart-line-cost",
        ".chart-area-tokens",
        ".chart-area-cost",
        ".chart-dot-tokens",
        ".chart-dot-cost",
        ".chart-bar-rank",
    ):
        assert "var(--" in _block(_NO_COMMENTS, rule + " {"), rule


async def test_pages_declare_both_schemes_and_apply_the_theme_before_paint(client, db_session):
    await _seed_user(db_session)
    _override_web_user(client.app)
    try:
        html = client.get("/app").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    head = html[:html.index("</head>")]
    assert '<meta name="color-scheme" content="dark light">' in head
    # Blocking (no defer/async) and before the stylesheet: the attribute is on
    # <html> before anything is painted.
    script = re.search(r'<script src="/static/theme\.js\?v=\w+"></script>', head)
    assert script and head.index("theme.js") < head.index("app.css")
    toggle = re.search(r'<button type="button" id="theme-toggle"[^>]*>', html).group(0)
    assert "hidden" in toggle and "theme-toggle" in toggle
