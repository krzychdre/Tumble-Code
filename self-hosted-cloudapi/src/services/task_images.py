"""Images a task's messages point to by path: storing and reading them.

A conversation can reference a file in the user's workspace
(``![chart](monitoring/x.png)``). The cloud only receives the text, so the
client uploads the file (POST /api/tasks/{id}/images) and the task page asks
for it by the message's ts and the path as written. See
ai_plans/2026-10-12_18-00_cloud-web-task-images.md.

Only raster formats are kept, recognised from their first bytes: the declared
type is the client's word, and an SVG opened directly is a document that can
run script.
"""

import hashlib
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import dialect_insert
from src.models.task import TaskImage

MAX_IMAGE_BYTES = 10 * 1024 * 1024
# In UTF-8 bytes. The path is part of a unique btree index, whose entries
# Postgres caps at roughly 2.7 kB.
MAX_PATH_BYTES = 1024


def sniff_image_mime(head: bytes) -> Optional[str]:
    """The MIME type of a PNG, JPEG, GIF or WebP from its first bytes, else None."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


async def store_task_image(
    db: AsyncSession, task_id: str, message_ts: int, path: str, mime: str, data: bytes
) -> None:
    """Insert the image, or replace the one stored for the same (task, ts, path)."""
    values = {
        "task_id": task_id,
        "message_ts": message_ts,
        "path": path,
        "mime": mime,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "data": data,
    }
    insert = dialect_insert(db)
    if insert is not None:
        statement = insert(TaskImage).values(**values)
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=["task_id", "message_ts", "path"],
                set_={
                    "mime": statement.excluded.mime,
                    "size": statement.excluded.size,
                    "sha256": statement.excluded.sha256,
                    "data": statement.excluded.data,
                },
            )
        )
        return
    existing = await _find(db, task_id, message_ts, path)
    if existing is None:
        db.add(TaskImage(**values))
    else:
        for name, value in values.items():
            setattr(existing, name, value)
    await db.flush()


async def load_task_image(
    db: AsyncSession, task_id: str, message_ts: int, path: str
) -> Optional[TaskImage]:
    """The stored image, or None when nothing was uploaded for it."""
    return await _find(db, task_id, message_ts, path)


async def _find(db: AsyncSession, task_id: str, message_ts: int, path: str) -> Optional[TaskImage]:
    result = await db.execute(
        select(TaskImage).where(
            TaskImage.task_id == task_id,
            TaskImage.message_ts == message_ts,
            TaskImage.path == path,
        )
    )
    return result.scalar_one_or_none()
