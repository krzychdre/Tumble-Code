"""The problem report's pipeline, split into the seams the audit named:
collect (the three sources, into one ``Occurrence`` shape) -> filter (one
query-string state, never failing to parse) -> group (signature groups and the
model fit) -> render (the page's row and drill-down views).

The catalogue that classifies each group lives in
``services/problem_catalogue``, the agent brief in ``services/problem_brief``.
The old flat module ``services/diagnostics_service`` re-exports this package;
the routes and presenters import from there and are unchanged.
"""
