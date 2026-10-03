"""Which client sent a record: the VS Code extension or the CLI.

The CLI runs the extension's own bundle on a fake ``vscode`` module, so its
telemetry, error reports and LLM exchanges look exactly like the extension's.
Since the client-kind change both clients name themselves in ``clientKind``
(``"vscode"`` or ``"cli"``); older builds do not, and for them the editor name
decides: the CLI's fake module reports ``vscode.env.appName`` as
``wrapper|cli|cli|<version>`` (packages/vscode-shim), and anything else is a
real VS Code (or a fork of it).

Every ingest path stamps ``client_kind`` through ``client_kind_from``, and the
migration that added the column (e7f8a9b0c1d2) applies the same rule to the
rows that were already stored, so a filter on the column means the same thing
for old and new rows.
"""

from __future__ import annotations

from typing import Any, Optional

CLIENT_VSCODE = "vscode"
CLIENT_CLI = "cli"
CLIENT_KINDS = (CLIENT_VSCODE, CLIENT_CLI)

# How each client reads on a page.
CLIENT_LABELS: dict[str, str] = {
    CLIENT_VSCODE: "VS Code",
    CLIENT_CLI: "CLI",
}

# The start of the editor name the CLI's fake vscode module reports.
CLI_EDITOR_PREFIX = "wrapper|cli"


def client_kind_from(fields: Any) -> str:
    """The client a record came from, read from its camelCase fields.

    ``fields`` is a telemetry event's ``properties``, an error report or an LLM
    exchange body. A known ``clientKind`` wins; an unknown or missing one falls
    back to the editor name, and a record that says nothing at all is from VS
    Code (every record from before the CLI could sign in is).
    """
    if not isinstance(fields, dict):
        return CLIENT_VSCODE
    kind = fields.get("clientKind")
    if isinstance(kind, str) and kind.strip().lower() in CLIENT_KINDS:
        return kind.strip().lower()
    editor = fields.get("editorName")
    if isinstance(editor, str) and editor.startswith(CLI_EDITOR_PREFIX):
        return CLIENT_CLI
    return CLIENT_VSCODE


def parse_client(value: Optional[str]) -> Optional[str]:
    """A ``?client=`` query value as a client kind, or None for "both".

    Anything that is not a known kind reads as no filter, like an unknown
    period on the metrics page.
    """
    return value if value in CLIENT_KINDS else None
