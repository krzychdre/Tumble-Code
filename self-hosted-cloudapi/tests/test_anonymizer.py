"""services/anonymizer: what an exported dataset must not carry, and what it must keep intact."""

import json
import re

import pytest

from src.services.anonymizer import Anonymizer

SYSTEM = (
    "Operating System: Linux\n"
    "Home Directory: /home/jsmith\n"
    "Current Workspace Directory: /home/jsmith/work/acme-portal\n"
)


@pytest.fixture
def anon():
    a = Anonymizer(
        identity=[
            ("email", "alice.smith@corp.io"),
            ("name", "Alice Smith"),
            ("name", "Alice"),
            ("name", "Smith"),
        ],
        terms=["QUB-IT", "Globex Corp"],
    )
    a.learn(SYSTEM, "/home/jsmith/work/acme-portal")
    return a


def test_the_workspace_home_and_user_name(anon):
    assert anon.text(SYSTEM) == (
        "Operating System: Linux\nHome Directory: /home/user\nCurrent Workspace Directory: /workspace/project1\n"
    )
    assert anon.text(
        "cat /home/jsmith/work/acme-portal/src/a.ts ~/x /home/jsmith/.bashrc"
    ) == ("cat /workspace/project1/src/a.ts ~/x /home/user/.bashrc")
    assert anon.text("jsmith@laptop:~$ whoami\njsmith") == "user@laptop:~$ whoami\nuser"
    # The project folder's name, wherever it appears.
    assert (
        anon.text('"name": "acme-portal", import "@acme-portal/ui"')
        == '"name": "project1", import "@project1/ui"'
    )


def test_windows_and_json_escaped_paths():
    a = Anonymizer()
    a.learn(
        "Home Directory: C:/Users/Bob\nCurrent Workspace Directory: C:/Users/Bob/src/shop",
        None,
    )
    assert (
        a.text("C:\\Users\\Bob\\src\\shop\\main.py") == "\\workspace\\project1\\main.py"
    )
    assert (
        a.text('{"path": "C:\\\\Users\\\\Bob\\\\src\\\\shop\\\\a.py"}')
        == '{"path": "\\\\workspace\\\\project1\\\\a.py"}'
    )
    assert (
        a.text("c:/Users/Bob/Desktop/notes.txt and D:\\Users\\Carol\\x")
        == "c:/Users/user/Desktop/notes.txt and D:\\Users\\user\\x"
    )


def test_identity_and_terms_share_a_pseudonym_and_keep_the_case(anon):
    assert (
        anon.text("Author: Alice Smith <alice.smith@corp.io>")
        == "Author: Person1 <user1@example.com>"
    )
    # Only as a name is written: an upper-case word is more likely a constant.
    assert anon.text("thanks Alice, SMITH said") == "thanks Person1, SMITH said"
    assert anon.text("QUB-IT, qub_it, QubIt and qub it; Globex Corp / GLOBEX-CORP") == (
        "ACME1, acme1, Acme1 and acme1; Acme2 / ACME2"
    )
    # Not inside a longer word, and a name only as a name is written.
    assert (
        anon.text("Alicetown and smithy, the smith")
        == "Alicetown and smithy, the smith"
    )


def test_a_placeholder_account_name_rewrites_nothing():
    a = Anonymizer(
        identity=[
            ("name", "Test User"),
            ("name", "Test"),
            ("name", "User"),
            ("name", "Will"),
        ]
    )
    assert (
        a.text("Test the User-Agent; you will see")
        == "Test the User-Agent; you will see"
    )
    assert a.text("Will wrote it") == "Person1 wrote it"


def test_secrets(anon):
    cases = {
        "export OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234567890": "export OPENAI_API_KEY=[REDACTED_SECRET]",
        "DB_PASSWORD='hunter2hunter2'": "DB_PASSWORD='[REDACTED_SECRET]'",
        'api_key = "AbC123dEf456gHi789"': 'api_key = "[REDACTED_SECRET]"',
        "Authorization: Bearer abcdef0123456789xyz": "Authorization: Bearer [REDACTED_SECRET]",
        "postgres://admin:s3cr3t@db.internal:5432/app": "postgres://user:[REDACTED_SECRET]@db.internal:5432/app",
        "https://api.example/v1?key=AIzaSyA1234567890abcdefghijklmnopqrstu": "https://api.example/v1?key=[REDACTED_SECRET]",
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789": "[REDACTED_SECRET]",
        "AKIAABCDEFGHIJKLMNOP": "[REDACTED_SECRET]",
        "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N": "jwt [REDACTED_SECRET]",
        "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----": "[REDACTED_PRIVATE_KEY]",
    }
    for original, expected in cases.items():
        assert anon.text(original) == expected, original


def test_code_that_only_names_a_secret_survives(anon):
    for code in (
        "const password: string = form.password",
        "token: getToken()",
        "api_key=os.environ['API_KEY']",
        'password = "<your-password>"',
        "SECRET_KEY=changeme",
        "if (token === undefined) return",
    ):
        assert anon.text(code) == code, code


def test_contact_and_network_data(anon):
    assert anon.text("mail bob@globex.com, bob@globex.com and carol@x.org") == (
        "mail user2@example.com, user2@example.com and user3@example.com"
    )
    assert anon.text("someone@example.com and git@github.com:org/repo.git") == (
        "someone@example.com and git@github.com:org/repo.git"
    )
    assert anon.text(
        "hosts 10.0.0.5, 192.168.1.20, 10.0.0.5; local 127.0.0.1, 0.0.0.0"
    ) == ("hosts 192.0.2.1, 192.0.2.2, 192.0.2.1; local 127.0.0.1, 0.0.0.0")
    # One numbering for every address of the export (two IPv4 addresses came first).
    assert anon.text("fe80::1ff:fe23:4567:890a and ::1") == "2001:db8::3 and ::1"
    assert anon.text("call +48 600 700 800") == "call +00 000 000 000"


def test_checksummed_numbers_only_when_the_checksum_holds(anon):
    assert anon.text("PESEL 44051401359 / 44051401358") == "PESEL [PESEL] / 44051401358"
    assert anon.text("PL61 1090 1014 0000 0712 1981 2874") == "[IBAN]"
    assert (
        anon.text("card 4111 1111 1111 1111, 4111 1111 1111 1112")
        == "card [CARD], 4111 1111 1111 1112"
    )


def test_what_looks_similar_but_is_not_personal_survives(anon):
    for text in (
        "ts 1790577835940 and 1790577835",
        "version 1.2.3.4 and v10.0.0.5",
        "at 12:34:56 on 2026-10-02",
        "npm i react@19.3.0",
        "sha 3f2a9c4e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39",
    ):
        assert anon.text(text) == text, text


def test_tool_arguments_stay_byte_exact_unless_something_changed(anon):
    untouched = '{"path": "src/a.ts",  "mode": null}'
    assert anon.arguments(untouched) == untouched
    changed = anon.arguments('{"path": "/home/jsmith/work/acme-portal/src/a.ts"}')
    assert json.loads(changed) == {"path": "/workspace/project1/src/a.ts"}
    assert anon.arguments('{"path": "/home/jsmith/x"') == '{"path": "/home/user/x"'


def test_values_and_the_report(anon):
    value = {"jsmith": ["/home/jsmith/work/acme-portal", 3, None]}
    # Keys are structure (schema properties, argument names) and stay as they are.
    assert anon.value(value) == {"jsmith": ["/workspace/project1", 3, None]}
    categories = {row["category"] for row in anon.report()}
    assert "workspace" in categories
    row = next(r for r in anon.report() if r["category"] == "workspace")
    assert (
        row["original"] == "/home/jsmith/work/acme-portal"
        and row["replacement"] == "/workspace/project1"
    )


def test_short_user_names_and_names_leave_code_alone():
    a = Anonymizer(identity=[("email", "max@corp.io"), ("name", "Max")])
    a.learn(
        "Home Directory: /home/max\nCurrent Workspace Directory: /home/max/x/shop", None
    )
    code = "Math.max(a, b); params.max_tokens = MAX_RETRIES; max = 3"
    assert a.text(code) == code
    assert a.text("Max wrote /home/max/notes") == "Person1 wrote /home/user/notes"


def test_tool_names_and_keys_are_never_renamed():
    a = Anonymizer(terms=["file", "acme"])
    tools = [
        {
            "type": "function",
            "function": {
                "name": "mcp--acme_server--read_file",
                "description": "Reads a file from acme",
                "parameters": {
                    "type": "object",
                    "properties": {"acme_id": {"type": "string"}},
                },
            },
        }
    ]
    cleaned = a.tools(tools)
    assert cleaned[0]["function"]["name"] == "mcp--acme_server--read_file"
    assert cleaned[0]["function"]["description"] == "Reads a acme1 from acme2"
    assert list(cleaned[0]["function"]["parameters"]["properties"]) == ["acme_id"]
    assert a.arguments('{"acme_id": "acme"}') == '{"acme_id":"acme2"}'


# --- the secret patterns run in linear time ---------------------------------------

# The patterns as they were, kept as the reference the linear ones must agree with.
_OLD_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----"
)
_OLD_ENV_LINE_RE = re.compile(
    r"""(?m)^(\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)"""
    r"""[A-Z0-9_]*\s*=\s*)(["']?)([^\s"'#()\[\]{}$]+)(\2)(?=\s|$)"""
)

_KEY = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----"
_KEY_CORPUS = [
    "",
    "no key here",
    _KEY,
    f"before {_KEY} after",
    f"{_KEY}\n\n{_KEY.replace('RSA ', 'EC ')}",
    "-----BEGIN PRIVATE KEY-----\nMIIx\n-----END PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3Bl\n-----END OPENSSH PRIVATE KEY-----",
    # A truncated key, then a whole one: both go, as one block.
    f"-----BEGIN PRIVATE KEY-----\nAAA\n{_KEY}",
    # A key with no END line, before and after a whole one.
    f"{_KEY}\n-----BEGIN PRIVATE KEY-----\nAAA",
    "-----BEGIN PRIVATE KEY-----\nAAA",
    "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----",
    "-----BEGIN PRIVATE KEY----------END PRIVATE KEY-----",
    "-----END PRIVATE KEY----- -----BEGIN PRIVATE KEY----- x",
    "-----BEGIN A1 PRIVATE KEY-----x-----END B2 PRIVATE KEY-----y-----END PRIVATE KEY-----",
]

_ENV_CORPUS = [
    "export OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234567890",
    "DB_PASSWORD='hunter2hunter2'",
    '  GITHUB_TOKEN="ghp_x1234567"  # comment',
    "\n\n   \n  AWS_SECRET_ACCESS_KEY=abc123\nOTHER=1\nMY_CREDENTIAL=x",
    "API_KEY=$(cat key)",
    "NOT_A_KEY=value\nPASSWDFILE=/etc/x",
    "export\nSECRET=abc",
    "SECRET_SECRET_TOKEN = value",
    "lower_token=abc",
    "TOKEN=",
]


@pytest.mark.parametrize("text", _KEY_CORPUS)
def test_private_keys_are_found_exactly_as_before(text):
    from src.services.anonymizer import _replace_private_keys

    assert _replace_private_keys(text, lambda key: f"<{len(key)}>") == (
        _OLD_PRIVATE_KEY_RE.sub(lambda m: f"<{len(m.group(0))}>", text)
    )


@pytest.mark.parametrize("text", _ENV_CORPUS)
def test_env_lines_are_found_exactly_as_before(text):
    from src.services.anonymizer import _ENV_LINE_RE

    def mark(m):
        return f"{m.group(1)}{m.group(2)}<{m.group(3)}>{m.group(4)}"

    assert _ENV_LINE_RE.sub(mark, text) == _OLD_ENV_LINE_RE.sub(mark, text)


@pytest.mark.parametrize(
    "text",
    [
        # Many BEGIN lines and no END: each one scanned to the end of the text.
        "-----BEGIN RSA PRIVATE KEY-----\n" * 4000,
        # A long run of blank lines: indentation matched across all of them.
        "\n" * 16000,
        # A long name made of the keyword: two greedy runs around it.
        "SECRET" * 8000,
    ],
    ids=["begin-lines", "blank-lines", "long-name"],
)
def test_redacting_secrets_takes_linear_time(text):
    """Each of these took seconds before (quadratic); milliseconds now."""
    import time

    from src.services.anonymizer import redact_secrets

    started = time.perf_counter()
    redact_secrets(text)
    assert time.perf_counter() - started < 0.5
