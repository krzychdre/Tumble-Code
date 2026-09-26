"""The web panel's rendering side: the Jinja environment and the presenters.

``templating`` owns the one ``templates`` object every page renders through;
``presenters`` turn task rows and service results into the view-models the
templates read. The routes themselves live in ``src/routers``.
"""
