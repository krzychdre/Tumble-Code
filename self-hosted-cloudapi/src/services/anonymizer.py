"""Anonymization of an exported dataset.

Raw exchanges are stored as received (a full reconstruction needs them); a
dataset leaves anonymized. One ``Anonymizer`` serves one export, so a value
gets the same pseudonym in every sample: a path in a tool call and in the
result that answers it stay consistent, and so does a project name across a
whole trajectory. Pseudonyms are numbered in order of first appearance, so two
exports cannot be joined on them.

The rules, applied to every string in this order:

1. secrets: private key blocks, JWTs, bearer tokens, provider key shapes,
   ``key=value`` pairs whose key names a secret (the value must look like one,
   so ``password: string`` in code survives), ``.env`` lines, URL credentials
   and key parameters -> ``[REDACTED_SECRET]``;
2. the workspace: every known workspace root (from the exchange and the system
   prompt's "Current Workspace Directory:") -> ``/workspace/projectN``, in its
   POSIX, Windows and JSON-escaped spellings; its folder name -> ``projectN``;
3. home folders: ``/home/<name>``, ``/Users/<name>``, ``C:\\Users\\<name>`` ->
   the name ``user``, and every learned user name elsewhere -> ``user``;
4. identity and terms: the account's e-mail, its local part, first and last
   name, and the user's own terms -> case-preserving pseudonyms (``Person1``,
   ``acme1``);
5. e-mail addresses -> ``userN@example.com`` (example.* kept, ``git@`` kept);
6. IP addresses (IPv4 except loopback and 0.0.0.0, IPv6 with a hex letter or
   ``::``) -> ``192.0.2.N`` / ``2001:db8::N``;
7. numbers with a checksum: PESEL, IBAN, payment cards (with a card prefix) ->
   ``[PESEL]``, ``[IBAN]``, ``[CARD]``;
8. international phone numbers -> ``+00 000 000 000``.

Not covered, and said so on the page: source code is not anonymized, and a
name that is neither in the account, the term list nor a home path is not
found. Excluding a workspace is the tool for a client's code.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Callable, Iterable, Optional

SECRET = "[REDACTED_SECRET]"
PRIVATE_KEY = "[REDACTED_PRIVATE_KEY]"

# Names that are not anybody's: never learned as a user name.
_GENERIC_USERS = {
    "user", "users", "root", "runner", "ubuntu", "admin", "administrator", "public", "shared", "default",
    "node", "vscode", "app", "guest", "workspace", "home", "linuxbrew",
}
# Words too common to replace everywhere even when they are someone's user
# name or a project folder (they are still replaced inside paths).
_COMMON_WORDS = {
    "dev", "test", "tests", "src", "lib", "data", "work", "code", "main", "master", "app", "api", "web", "docs",
    "project", "projects", "repo", "temp", "tmp", "build", "dist", "server", "client", "backend", "frontend",
}

# Account names that are placeholders, not a person (a "Test User" account).
# A user name or an e-mail local part shorter than this is too likely to be an
# ordinary identifier (max, dev, sam) to replace outside a path.
_MIN_WORD_TOKEN = 5

# The most text the per-export cache keeps (characters of input).
_CACHE_CHARS = 20_000_000

_NOT_NAMES = _GENERIC_USERS | {"test", "tester", "owner", "dev", "developer", "unknown", "none", "null"}

_PRIVATE_KEY_RE = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----")
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
_BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}")
_KEY_SHAPES = [
    re.compile(r"\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),
    re.compile(r"\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bhf_[A-Za-z0-9]{30,}"),
]
_SECRET_KEY_NAME = (
    r"(?:authorization|x-api-key|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|auth[-_]?token|"
    r"secret[-_]?key|client[-_]?secret|secret|password|passwd|pwd|token|private[-_]?key|access[-_]?key)"
)
# key: "value" / key = 'value' / "key": "value"
_QUOTED_PAIR_RE = re.compile(
    rf"""(["']?\b{_SECRET_KEY_NAME}["']?\s*[:=]\s*)(["'])([^"'\s]{{6,}})(\2)""", re.IGNORECASE
)
# key: value / key=value without quotes: only a value that looks like a secret.
_BARE_PAIR_RE = re.compile(rf"""(\b{_SECRET_KEY_NAME}\s*[:=]\s*)([A-Za-z0-9_\-+/=.~]{{8,}})""", re.IGNORECASE)
# .env and shell lines: FOO_TOKEN=..., export DB_PASSWORD="..."
# Upper-case names only (the .env convention), and a literal value: an
# expression such as $(cat f), os.environ[...] or ${X} is code, not a secret.
_ENV_LINE_RE = re.compile(
    r"""(?m)^(\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)"""
    r"""[A-Z0-9_]*\s*=\s*)(["']?)([^\s"'#()\[\]{}$]+)(\2)(?=\s|$)"""
)
_URL_CREDENTIALS_RE = re.compile(r"\b([a-z][a-z0-9+.-]*://)([^/\s:@\"']+):([^/\s@\"']+)@", re.IGNORECASE)
_URL_KEY_PARAM_RE = re.compile(
    r"([?&](?:key|api[-_]?key|token|access_token|auth|sig|signature|password)=)[^&\s\"'#]+", re.IGNORECASE
)
_PLACEHOLDER_RE = re.compile(r"^(?:<.*>|\$\{.*\}|\{\{.*\}\}|x+|\*+|your[-_].*|changeme|example.*|test.*|\[.*\])$", re.I)

_HOME_RE = re.compile(r"(?<![\w.-])(/home/|/Users/|[A-Za-z]:(?:\\\\|\\|/)Users(?:\\\\|\\|/))([A-Za-z0-9._-]+)")
_EMAIL_RE = re.compile(r"(?<![\w.+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b")
_IPV4_RE = re.compile(r"(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.])")
_IPV6_RE = re.compile(r"(?<![\w:])((?:[0-9A-Fa-f]{1,4}:){1,7}:?(?:[0-9A-Fa-f]{1,4})?(?::[0-9A-Fa-f]{1,4}){0,6})(?![\w:])")
_PESEL_RE = re.compile(r"(?<!\d)(\d{11})(?!\d)")
_IBAN_RE = re.compile(r"\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?)\b")
_CARD_RE = re.compile(r"(?<![\d-])((?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|6011|65\d{2}|3[47]\d{2})(?:[ -]?\d{2,4}){3,4})(?![\d-])")
_PHONE_RE = re.compile(r"(?<![\w+])\+\d{1,3}[ -]?\(?\d{1,4}\)?(?:[ -]?\d{2,4}){2,4}(?!\d)")


def _looks_secret(value: str) -> bool:
    if _PLACEHOLDER_RE.match(value):
        return False
    return bool(re.search(r"\d", value)) and bool(re.search(r"[A-Za-z]", value)) and len(value) >= 8


def _pesel_valid(digits: str) -> bool:
    month = int(digits[2:4])
    if month % 20 == 0 or month % 20 > 12:
        return False
    day = int(digits[4:6])
    if not 1 <= day <= 31:
        return False
    weights = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
    check = (10 - sum(int(d) * w for d, w in zip(digits, weights)) % 10) % 10
    return check == int(digits[10])


def _iban_valid(text: str) -> bool:
    compact = text.replace(" ", "")
    if not 15 <= len(compact) <= 34:
        return False
    rearranged = compact[4:] + compact[:4]
    try:
        number = int("".join(str(int(ch, 36)) for ch in rearranged))
    except ValueError:
        return False
    return number % 97 == 1


def _luhn_valid(digits: str) -> bool:
    total = 0
    for index, ch in enumerate(reversed(digits)):
        d = int(ch)
        if index % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _bounded(term: str, proper_noun: bool = False, word: bool = False) -> re.Pattern:
    """``term`` as a whole token: not inside a longer word (letters or digits), any case.

    Underscores, dots and dashes are boundaries, so ``acme`` is found in
    ``acme_client`` and ``@acme/pkg``. A term made of several parts matches
    with any of those separators or none between them: ``QUB-IT`` also finds
    ``QUB_IT``, ``qub it`` and ``qubit``.
    """
    if proper_noun:
        # A person's name: only as a name is written (Alice), as a whole word,
        # so "Will" or "Max" in an account rewrites neither "will", "Math.max"
        # nor MAX_RETRIES.
        forms = sorted({term, term.title()}, key=len, reverse=True)
        return re.compile(rf"(?<!\w)(?:{'|'.join(re.escape(f) for f in forms)})(?!\w)")
    if word:
        # A user name or an e-mail's local part: a whole word in any case,
        # underscores included in the word, so "max" leaves max_tokens alone.
        return re.compile(rf"(?<!\w){re.escape(term)}(?!\w)", re.IGNORECASE)
    parts = [re.escape(part) for part in re.split(r"[-_. ]+", term) if part]
    body = r"[-_. ]?".join(parts) if parts else re.escape(term)
    return re.compile(rf"(?<![^\W_]){body}(?![^\W_])", re.IGNORECASE)


def _like_case(original: str, pseudonym: str) -> str:
    if original.isupper():
        return pseudonym.upper()
    if original[:1].isupper():
        return pseudonym[:1].upper() + pseudonym[1:]
    return pseudonym.lower()


def _path_spellings(path: str) -> list[str]:
    """A path as it can appear in text: as given, POSIX, Windows and JSON-escaped."""
    path = path.rstrip("/\\")
    variants = {path, path.replace("\\", "/"), path.replace("/", "\\")}
    variants |= {v.replace("\\", "\\\\") for v in list(variants) if "\\" in v}
    if re.match(r"^[A-Za-z]:", path):
        variants |= {v[0].swapcase() + v[1:] for v in list(variants)}
    return sorted((v for v in variants if len(v) > 3), key=len, reverse=True)


class Anonymizer:
    """Consistent pseudonyms for one export; see the module docstring."""

    def __init__(self, identity: Iterable[tuple[str, str]] = (), terms: Iterable[str] = ()):
        """``identity``: (kind, value) pairs, kind "email" or "name". ``terms``: the user's own list."""
        self._maps: dict[str, dict[str, str]] = {}
        self.audit: Counter = Counter()
        self._workspaces: dict[str, str] = {}
        self._workspace_spellings: list[tuple[str, str]] = []
        self._users: set[str] = set()
        self._token_rules: list[tuple[re.Pattern, str, str]] = []  # (pattern, category, pseudonym base)
        self._cache: dict[str, str] = {}
        self._cache_chars = 0
        # Every identity value is the same person: one pseudonym for all of them.
        for kind, value in identity:
            value = (value or "").strip()
            if kind == "email" and "@" in value:
                self._remember("email", value.lower(), self._email_pseudonym(value.lower()))
                local = value.split("@", 1)[0]
                if len(local) >= _MIN_WORD_TOKEN and local.lower() not in _COMMON_WORDS:
                    self._add_token(local, "identity", "person", fixed="person1", word=True)
            elif kind == "name" and len(value) >= 3 and value.lower() not in _NOT_NAMES:
                self._add_token(value, "identity", "person", fixed="person1", proper_noun=True)
        for term in terms:
            term = term.strip()
            if len(term) >= 3:
                self._add_token(term, "term", "acme")

    # --- bookkeeping -------------------------------------------------------------

    def _remember(self, category: str, original: str, pseudonym: str) -> str:
        self._maps.setdefault(category, {})[original] = pseudonym
        return pseudonym

    def _pseudonym(self, category: str, key: str, make: Callable[[int], str]) -> str:
        table = self._maps.setdefault(category, {})
        if key not in table:
            table[key] = make(len(table) + 1)
        return table[key]

    def _count(self, category: str, original: str, replacement: str) -> None:
        self.audit[(category, original, replacement)] += 1

    def _add_token(
        self,
        value: str,
        category: str,
        base: str,
        fixed: Optional[str] = None,
        proper_noun: bool = False,
        word: bool = False,
    ) -> None:
        key = value.lower()
        pattern = _bounded(value, proper_noun, word)
        if any(existing.pattern == pattern.pattern for existing, _, _ in self._token_rules):
            return
        if fixed:
            pseudonym = self._remember(category, key, fixed)
        else:
            pseudonym = self._pseudonym(category, key, lambda n: f"{base}{n}")
        self._token_rules.append((pattern, category, pseudonym))
        # Longest first, so "Acme Corp" goes before "Acme".
        self._token_rules.sort(key=lambda rule: len(rule[0].pattern), reverse=True)
        self.forget_texts()

    def _email_pseudonym(self, email: str) -> str:
        return self._pseudonym("email", email, lambda n: f"user{n}@example.com")

    # --- learning from the data ------------------------------------------------------

    def learn(self, system: Optional[str] = None, workspace_path: Optional[str] = None) -> None:
        """Pick up the workspace and home folder of an exchange before its text is processed."""
        paths = [workspace_path] if workspace_path else []
        if system:
            for line in system.splitlines():
                if line.startswith("Current Workspace Directory:"):
                    paths.append(line.split(":", 1)[1].strip())
                elif line.startswith("Home Directory:"):
                    home = line.split(":", 1)[1].strip()
                    match = _HOME_RE.match(home if home.endswith(("/", "\\")) else home + "/")
                    if match:
                        self._learn_user(match.group(2))
        for path in paths:
            self._learn_workspace(path)
            match = _HOME_RE.search(path)
            if match:
                self._learn_user(match.group(2))

    def _learn_workspace(self, path: str) -> None:
        path = (path or "").strip().rstrip("/\\")
        if len(path) < 4 or path.replace("\\", "/") in self._workspaces:
            return
        alias = f"/workspace/project{len(self._workspaces) + 1}"
        self._workspaces[path.replace("\\", "/")] = alias
        for spelling in _path_spellings(path):
            self._workspace_spellings.append((spelling, alias))
        self._workspace_spellings.sort(key=lambda item: len(item[0]), reverse=True)
        name = re.split(r"[\\/]", path)[-1]
        if len(name) >= 4 and name.lower() not in _COMMON_WORDS:
            self._add_token(name, "project", "project")
        self.forget_texts()

    def _learn_user(self, name: str) -> None:
        if len(name) >= 3 and name.lower() not in _GENERIC_USERS and name not in self._users:
            self._users.add(name)
            if len(name) >= _MIN_WORD_TOKEN and name.lower() not in _COMMON_WORDS:
                self._token_rules.append((_bounded(name, word=True), "username", "user"))
                self._remember("username", name.lower(), "user")
            self.forget_texts()

    # --- the rules -------------------------------------------------------------------

    def _secrets(self, text: str) -> str:
        def counted(category: str, replacement: str):
            def apply(match: re.Match) -> str:
                self._count(category, match.group(0), replacement)
                return replacement
            return apply

        text = _PRIVATE_KEY_RE.sub(counted("private_key", PRIVATE_KEY), text)
        text = _JWT_RE.sub(counted("secret", SECRET), text)
        text = _BEARER_RE.sub(lambda m: (self._count("secret", m.group(0), f"Bearer {SECRET}"), f"Bearer {SECRET}")[1], text)
        for pattern in _KEY_SHAPES:
            text = pattern.sub(counted("secret", SECRET), text)

        def env_line(m: re.Match) -> str:
            if _PLACEHOLDER_RE.match(m.group(3)):
                return m.group(0)
            self._count("secret", m.group(3), SECRET)
            return f"{m.group(1)}{m.group(2)}{SECRET}{m.group(4)}"

        def quoted(m: re.Match) -> str:
            if _PLACEHOLDER_RE.match(m.group(3)) or not _looks_secret(m.group(3)) and len(m.group(3)) < 16:
                return m.group(0)
            self._count("secret", m.group(3), SECRET)
            return f"{m.group(1)}{m.group(2)}{SECRET}{m.group(4)}"

        def bare(m: re.Match) -> str:
            if not _looks_secret(m.group(2)):
                return m.group(0)
            self._count("secret", m.group(2), SECRET)
            return f"{m.group(1)}{SECRET}"

        def url_credentials(m: re.Match) -> str:
            self._count("secret", m.group(0), f"{m.group(1)}user:{SECRET}@")
            return f"{m.group(1)}user:{SECRET}@"

        def url_param(m: re.Match) -> str:
            self._count("secret", m.group(0), f"{m.group(1)}{SECRET}")
            return f"{m.group(1)}{SECRET}"

        text = _ENV_LINE_RE.sub(env_line, text)
        text = _QUOTED_PAIR_RE.sub(quoted, text)
        text = _BARE_PAIR_RE.sub(bare, text)
        text = _URL_CREDENTIALS_RE.sub(url_credentials, text)
        text = _URL_KEY_PARAM_RE.sub(url_param, text)
        return text

    def _paths(self, text: str) -> str:
        for spelling, alias in self._workspace_spellings:
            if spelling in text:
                # Keep the spelling's separator style for what follows the root.
                replacement = alias.replace("/", "\\\\") if "\\\\" in spelling else (
                    alias.replace("/", "\\") if "\\" in spelling else alias)
                self._count("workspace", spelling, replacement)
                text = text.replace(spelling, replacement)

        def home(m: re.Match) -> str:
            name = m.group(2)
            if name.lower() in _GENERIC_USERS:
                return m.group(0)
            self._learn_user_late(name)
            self._count("home", m.group(0), f"{m.group(1)}user")
            return f"{m.group(1)}user"

        return _HOME_RE.sub(home, text)

    def _learn_user_late(self, name: str) -> None:
        # A home path met in the text (not in the system prompt): learn the name
        # without dropping the cache mid-string.
        if len(name) >= 3 and name.lower() not in _GENERIC_USERS and name not in self._users:
            self._users.add(name)
            if len(name) >= _MIN_WORD_TOKEN and name.lower() not in _COMMON_WORDS:
                self._token_rules.append((_bounded(name, word=True), "username", "user"))
                self._remember("username", name.lower(), "user")

    def _tokens(self, text: str) -> str:
        # E-mail addresses first, so an identity token inside one is not split.
        def email(m: re.Match) -> str:
            local, domain = m.group(1), m.group(2).lower()
            if local.lower() == "git" or re.match(r"^example\.(?:com|org|net)$", domain) or domain.endswith(".example"):
                return m.group(0)
            pseudonym = self._email_pseudonym(m.group(0).lower())
            self._count("email", m.group(0), pseudonym)
            return pseudonym

        text = _EMAIL_RE.sub(email, text)
        for pattern, category, pseudonym in self._token_rules:
            def token(m: re.Match, category=category, pseudonym=pseudonym) -> str:
                replacement = _like_case(m.group(0), pseudonym)
                self._count(category, m.group(0), replacement)
                return replacement
            text = pattern.sub(token, text)
        return text

    def _numbers(self, text: str) -> str:
        def ipv4(m: re.Match) -> str:
            octets = [int(g) for g in m.groups()]
            original = m.group(0)
            if any(o > 255 for o in octets) or octets[0] in (0, 127) or octets == [255, 255, 255, 255]:
                return original
            before = text[max(0, m.start() - 8):m.start()].lower()
            if re.search(r"(?:\bv|version\s?)$", before):
                return original
            pseudonym = self._pseudonym("ip", original, lambda n: f"192.0.2.{n}" if n < 255 else f"198.51.100.{n % 254 + 1}")
            self._count("ip", original, pseudonym)
            return pseudonym

        def ipv6(m: re.Match) -> str:
            original = m.group(1)
            groups = [g for g in original.split(":") if g]
            if original in ("::1", "::") or ("::" not in original and len(groups) < 8) or (
                "::" in original and len(groups) < 2
            ) or not re.search(r"[A-Fa-f]|::", original):
                return original
            pseudonym = self._pseudonym("ip", original.lower(), lambda n: f"2001:db8::{n:x}")
            self._count("ip", original, pseudonym)
            return pseudonym

        def pesel(m: re.Match) -> str:
            if not _pesel_valid(m.group(1)):
                return m.group(0)
            self._count("pesel", m.group(1), "[PESEL]")
            return "[PESEL]"

        def iban(m: re.Match) -> str:
            if not _iban_valid(m.group(1)):
                return m.group(0)
            self._count("iban", m.group(1), "[IBAN]")
            return "[IBAN]"

        def card(m: re.Match) -> str:
            digits = re.sub(r"\D", "", m.group(1))
            if len(digits) not in (15, 16) or not _luhn_valid(digits):
                return m.group(0)
            self._count("card", m.group(1), "[CARD]")
            return "[CARD]"

        def phone(m: re.Match) -> str:
            self._count("phone", m.group(0), "+00 000 000 000")
            return "+00 000 000 000"

        text = _IPV4_RE.sub(ipv4, text)
        text = _IPV6_RE.sub(ipv6, text)
        text = _IBAN_RE.sub(iban, text)
        text = _CARD_RE.sub(card, text)
        text = _PESEL_RE.sub(pesel, text)
        text = _PHONE_RE.sub(phone, text)
        return text

    # --- the public surface ----------------------------------------------------------

    def text(self, value: str) -> str:
        """One string, anonymized. Repeated strings (a long history) are cached."""
        if not value:
            return value
        cached = self._cache.get(value)
        if cached is not None:
            return cached
        result = self._numbers(self._tokens(self._paths(self._secrets(value))))
        # Bounded by text held, not by entries: tool results are whole files.
        if self._cache_chars + len(value) > _CACHE_CHARS:
            self._cache.clear()
            self._cache_chars = 0
        self._cache[value] = result
        self._cache_chars += len(value)
        return result

    def forget_texts(self) -> None:
        """Drop the cached texts (the export calls it between tasks; pseudonyms stay)."""
        self._cache.clear()
        self._cache_chars = 0

    def value(self, value: Any) -> Any:
        """Every string value in a JSON-like value anonymized; a new value.

        Keys are structure (schema property names, argument names), not
        content, and stay as they are: a tool's parameter and the argument a
        call passes for it must keep matching.
        """
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, list):
            return [self.value(item) for item in value]
        if isinstance(value, dict):
            return {k: self.value(v) for k, v in value.items()}
        return value

    def tools(self, tools: Any) -> Any:
        """Tool definitions anonymized, every tool name kept.

        The calls in the samples name the tools as the model called them; a
        renamed definition would teach the student to call a tool that is not
        offered. A term inside an MCP tool name therefore stays visible.
        """
        cleaned = self.value(tools)
        if isinstance(tools, list) and isinstance(cleaned, list):
            for original, copy in zip(tools, cleaned):
                if not isinstance(original, dict):
                    continue
                if isinstance(original.get("function"), dict) and "name" in original["function"]:
                    copy["function"]["name"] = original["function"]["name"]
                if "name" in original:
                    copy["name"] = original["name"]
        return cleaned

    def arguments(self, raw: str) -> str:
        """Tool call arguments: parsed and re-serialized only when something changed.

        A JSON escape in the raw text (a Windows path as ``C:\\\\Users``) is matched
        on the decoded value, so it is found whatever the escaping.
        """
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError, RecursionError):
            return self.text(raw)
        cleaned = self.value(parsed)
        if cleaned == parsed:
            return raw
        return json.dumps(cleaned, ensure_ascii=False, separators=(",", ":"))

    def report(self) -> list[dict]:
        """Every replacement made: category, original, replacement, count (most frequent first)."""
        rows = [
            {"category": category, "original": original, "replacement": replacement, "count": count}
            for (category, original, replacement), count in self.audit.items()
        ]
        rows.sort(key=lambda row: (row["category"], -row["count"], row["original"]))
        return rows
