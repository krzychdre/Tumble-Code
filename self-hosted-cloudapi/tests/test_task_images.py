"""Images a task's messages point to by path: upload, serve, and removal.

Plan: ai_plans/2026-10-12_18-00_cloud-web-task-images.md. The client uploads
``![x](monitoring/x.png)`` targets to POST /api/tasks/{id}/images; the task
page and the shared page serve them back by message ts and path as written.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text

from src.auth.web_session import get_web_user_optional
from src.dependencies import get_current_user
from src.models.retention import RetentionPolicy
from src.models.task import Task, TaskImage, TaskShare
from src.services.retention_service import apply_sweep, plan_sweep
from src.services.share_service import delete_tasks
from src.services.task_images import MAX_IMAGE_BYTES

from tests.web_helpers import _override_current_user, _override_web_user, _seed_user

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 32
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


async def _seed_task(db_session, task_id="t-img", user_id="user_test"):
    await _seed_user(db_session, user_id=user_id, email=f"{user_id}@example.com")
    db_session.add(Task(id=task_id, user_id=user_id))
    await db_session.commit()


def _upload(
    client, task_id="t-img", ts="5", path="monitoring/x.png", data=PNG, mime="image/png"
):
    return client.post(
        f"/api/tasks/{task_id}/images",
        data={"messageTs": ts, "path": path},
        files={"file": ("x", data, mime)},
    )


async def _images(db_session):
    db_session.expire_all()
    return (await db_session.execute(select(TaskImage))).scalars().all()


def _signed_in(client, user_id="user_test"):
    from src.main import app

    _override_current_user(app, user_id)
    _override_web_user(app, user_id, f"{user_id}@example.com")


# --- upload -----------------------------------------------------------------


async def test_upload_stores_the_image_and_a_reupload_replaces_it(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)

    assert _upload(client).status_code == 204
    resp = _upload(client, data=JPEG, mime="image/png")
    assert resp.status_code == 204

    rows = await _images(db_session)
    assert len(rows) == 1
    # The type comes from the bytes, not from what the client declared.
    assert rows[0].mime == "image/jpeg"
    assert rows[0].data == JPEG
    assert rows[0].size == len(JPEG)
    assert rows[0].message_ts == 5 and rows[0].path == "monitoring/x.png"


async def test_upload_accepts_gif_and_webp(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    assert _upload(client, path="a.gif", data=GIF).status_code == 204
    assert _upload(client, path="a.webp", data=WEBP).status_code == 204
    assert sorted(r.mime for r in await _images(db_session)) == [
        "image/gif",
        "image/webp",
    ]


async def test_upload_to_someone_elses_or_an_unknown_task_is_404(client, db_session):
    await _seed_task(db_session, user_id="owner")
    _signed_in(client, "intruder")
    await _seed_user(db_session, user_id="intruder", email="i@example.com")

    assert _upload(client).status_code == 404
    assert _upload(client, task_id="no-such-task").status_code == 404
    assert await _images(db_session) == []


async def test_upload_over_ten_megabytes_is_413(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    resp = _upload(client, data=PNG + b"\x00" * MAX_IMAGE_BYTES)
    assert resp.status_code == 413
    assert await _images(db_session) == []


async def test_svg_and_other_bytes_are_415(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    assert _upload(client, data=SVG, mime="image/svg+xml").status_code == 415
    assert (
        _upload(client, data=b"not an image at all", mime="image/png").status_code
        == 415
    )
    assert await _images(db_session) == []


async def test_bad_fields_are_400(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    assert _upload(client, ts="abc").status_code == 400
    assert _upload(client, path="").status_code == 400
    assert _upload(client, path="x" * 1025).status_code == 400


def test_upload_needs_a_bearer_token(client):
    from src.main import app

    app.dependency_overrides.pop(get_current_user, None)
    assert _upload(client).status_code == 401


# --- serve: the task page ---------------------------------------------------


async def test_the_owner_gets_the_image_with_safe_headers(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    _upload(client, path="./a b.png")

    resp = client.get("/app/tasks/t-img/images", params={"ts": 5, "path": "./a b.png"})
    assert resp.status_code == 200
    assert resp.content == PNG
    assert resp.headers["content-type"] == "image/png"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["cache-control"].startswith("private")


async def test_an_image_never_uploaded_is_404(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    _upload(client)
    assert (
        client.get(
            "/app/tasks/t-img/images", params={"ts": 6, "path": "monitoring/x.png"}
        ).status_code
        == 404
    )
    assert (
        client.get(
            "/app/tasks/t-img/images", params={"ts": 5, "path": "other.png"}
        ).status_code
        == 404
    )


async def test_another_users_image_is_404(client, db_session):
    await _seed_task(db_session, user_id="owner")
    from src.main import app

    _override_current_user(app, "owner")
    assert _upload(client).status_code == 204
    await _seed_user(db_session, user_id="reader", email="r@example.com")
    _override_web_user(app, "reader", "r@example.com")
    resp = client.get(
        "/app/tasks/t-img/images", params={"ts": 5, "path": "monitoring/x.png"}
    )
    assert resp.status_code == 404
    assert resp.content == b""


async def test_the_task_page_tells_render_js_where_images_are(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    resp = client.get("/app/tasks/t-img")
    assert 'data-image-base="/app/tasks/t-img/images"' in resp.text


# --- serve: the shared page -------------------------------------------------


async def _share(db_session, visibility):
    db_session.add(
        TaskShare(
            task_id="t-img",
            visibility=visibility,
            share_url="http://testserver/shared/t-img",
        )
    )
    await db_session.commit()


async def test_a_public_share_serves_its_images_to_anybody(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    _upload(client)
    await _share(db_session, "public")

    from src.main import app

    app.dependency_overrides.pop(get_web_user_optional, None)
    resp = client.get(
        "/shared/t-img/images", params={"ts": 5, "path": "monitoring/x.png"}
    )
    assert resp.status_code == 200
    assert resp.content == PNG
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert 'data-image-base="/shared/t-img/images"' in client.get("/shared/t-img").text


async def test_a_private_share_follows_the_page_rules(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    _upload(client)
    await _share(db_session, "private")

    from src.main import app

    # The owner may look.
    assert (
        client.get(
            "/shared/t-img/images", params={"ts": 5, "path": "monitoring/x.png"}
        ).status_code
        == 200
    )
    # Anonymous: sign in first, like the page.
    app.dependency_overrides.pop(get_web_user_optional, None)
    resp = client.get(
        "/shared/t-img/images",
        params={"ts": 5, "path": "monitoring/x.png"},
        follow_redirects=False,
    )
    assert resp.status_code == 303
    # A stranger: not found.
    await _seed_user(db_session, user_id="stranger", email="s@example.com")
    _override_web_user(app, "stranger", "s@example.com")
    assert (
        client.get(
            "/shared/t-img/images", params={"ts": 5, "path": "monitoring/x.png"}
        ).status_code
        == 404
    )


async def test_an_unshared_task_serves_no_images_under_shared(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    _upload(client)
    assert (
        client.get(
            "/shared/t-img/images", params={"ts": 5, "path": "monitoring/x.png"}
        ).status_code
        == 404
    )


# --- removal ----------------------------------------------------------------


async def test_deleting_the_task_removes_its_images(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    _upload(client)

    assert await delete_tasks(db_session, ["t-img"], "user_test") == 1
    await db_session.commit()
    assert await _images(db_session) == []


async def test_the_foreign_key_cascades_on_a_plain_delete(client, db_session):
    await _seed_task(db_session)
    _signed_in(client)
    _upload(client)

    await db_session.execute(text("DELETE FROM tasks WHERE id = 't-img'"))
    await db_session.commit()
    assert await _images(db_session) == []


async def test_the_retention_sweep_removes_images_and_counts_their_bytes(
    client, db_session
):
    await _seed_task(db_session)
    _signed_in(client)
    _upload(client)

    policy = RetentionPolicy(
        user_id="user_test", enabled=True, keep_shared=True, max_age_days=1
    )
    later = datetime.now(timezone.utc) + timedelta(days=10)
    plan = await plan_sweep(db_session, "user_test", policy, now=later)
    assert plan.task_ids == ["t-img"]
    assert plan.message_bytes >= len(PNG)

    await apply_sweep(db_session, "user_test", policy, plan=plan, now=later)
    await db_session.commit()
    assert await db_session.scalar(select(func.count(TaskImage.id))) == 0
