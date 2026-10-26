"""Words for recall search: one normalization for session cards and queries.

Postgres indexes the words this module produces with its plain ``simple``
configuration, so the server needs no dictionary files and Polish and English
behave alike. What happens to a text, in order:

* split into words of letters and digits; ``_``, ``-``, ``.``, ``/`` separate;
* an identifier yields itself and its parts: ``resolveMaxInlineToolResultBytes``
  -> ``resolvemaxinlinetoolresultbytes``, ``resolve``, ``max``, ``inline``, ...;
* lower case, diacritics folded (``źródło`` -> ``zrodlo``, ``ł`` -> ``l``);
* Polish and English stop words and one-letter words dropped.

There is no stemming (``sesja`` does not find ``sesji``) and no prefix match:
a prefix makes Postgres read the whole list of every word it covers.
"""

import re
import unicodedata

from sqlalchemy import literal_column

_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)
# Boundaries inside an identifier: aB, ABc (acronym then word), a1, 1a.
_CAMEL_RE = re.compile(
    r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])"
)
# Letters NFKD does not decompose.
_FOLD = str.maketrans({"ł": "l", "Ł": "L", "ø": "o", "Ø": "O", "ß": "ss", "đ": "d"})

STOP_WORDS = frozenset(
    """
    a an and are as at be but by for from has have i if in into is it its of on or
    so that the then there these this to was we were what when which will with you
    your not no do does did can should would could all any
    aby albo ale bo by byc byl byla bylo czy do gdy go i ich im jak jako jest jego jej
    juz ktora ktore ktory lub ma mi mnie na nad nie niz o od oraz po pod przez przy sa
    sie ta tak tam te tego tej to tu ty w we z za ze zeby
    """.split()
)

# The text search configuration of every vector and query, as SQL: written
# into the statement so Postgres reads it as a regconfig, not a varchar.
SIMPLE = literal_column("'simple'::regconfig")


def _fold(word: str) -> str:
    decomposed = unicodedata.normalize("NFKD", word.translate(_FOLD))
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def words(text: str) -> list[str]:
    """The indexable words of ``text``, in order, with repeats."""
    out = []
    for raw in _WORD_RE.findall(text):
        parts = _CAMEL_RE.split(raw)
        candidates = [raw, *parts] if len(parts) > 1 else [raw]
        for candidate in candidates:
            word = _fold(candidate)
            if len(word) > 1 and word not in STOP_WORDS:
                out.append(word)
    return out


def document(text: str) -> str:
    """``text`` as the space-separated words ``to_tsvector('simple', ...)`` indexes."""
    return " ".join(words(text))


def query_words(query: str) -> list[str]:
    """The distinct words of a query, in order. A query names a whole
    identifier; its parts would only widen the match, so they are not added."""
    folded = (_fold(w) for w in _WORD_RE.findall(query))
    return list(dict.fromkeys(w for w in folded if len(w) > 1 and w not in STOP_WORDS))


def tsquery(query: str) -> str:
    """The ``to_tsquery('simple', ...)`` text: every word required. Empty when
    the query has no word left."""
    return " & ".join(query_words(query))
