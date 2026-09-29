"""The bare origin redirects to the web panel.

The extension's Cloud view opens the configured cloudApiUrl without a path, so
``GET /`` has to land on the task list instead of a 404.
"""


def test_the_bare_origin_redirects_to_the_task_list(client):
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"] == "/app"


def test_the_redirect_leaves_the_login_check_to_the_task_list(client):
    """Followed without a session, the chain ends at the login page, as a
    direct visit to /app would."""
    resp = client.get("/", follow_redirects=False)
    follow = client.get(resp.headers["location"], follow_redirects=False)
    assert follow.status_code == 303 and follow.headers["location"] == "/app/login"
