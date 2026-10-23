"""Images a task's messages point to by path.

Implements:
- POST /api/tasks/{task_id}/images (the client uploads a referenced file)

and ``image_response``, which the task page (/app/tasks/{id}/images) and the
shared page (/shared/{id}/images) answer with. See
ai_plans/2026-10-12_18-00_cloud-web-task-images.md.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.task import TaskImage
from src.routers.events import capped_request
from src.services.task_access import task_owner
from src.services.task_images import (
    MAX_IMAGE_BYTES,
    MAX_PATH_BYTES,
    sniff_image_mime,
    store_task_image,
)

router = APIRouter(prefix="/api", tags=["task-images"])

# Room for the multipart framing and the two text fields around the file, so
# a file of exactly MAX_IMAGE_BYTES is not refused for its envelope.
_ENVELOPE_BYTES = 64 * 1024

# The bytes for one (task, ts, path) only change when the client re-uploads,
# which is rare; an hour keeps a reread page from fetching every image again.
IMAGE_CACHE_CONTROL = "private, max-age=3600"


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


@router.post("/tasks/{task_id}/images", status_code=status.HTTP_204_NO_CONTENT)
async def upload_task_image_endpoint(
    task_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store an image a message of the caller's task points to.

    Multipart form fields: ``messageTs`` (integer), ``path`` (the reference as
    written in the Markdown) and ``file``. 204 stored or replaced, 404 unknown
    or someone else's task (the same answer, so the id's owner is not
    disclosed), 413 over 10 MB, 415 not PNG, JPEG, GIF or WebP.
    """
    if await task_owner(db, task_id) != current_user["user_id"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    form = await capped_request(request, MAX_IMAGE_BYTES + _ENVELOPE_BYTES).form()

    raw_ts = form.get("messageTs")
    if not isinstance(raw_ts, str) or not raw_ts.strip().lstrip("-").isdigit():
        raise _bad_request("messageTs must be an integer")
    message_ts = int(raw_ts)

    path = form.get("path")
    if not isinstance(path, str) or not path:
        raise _bad_request("path is required")
    if len(path.encode("utf-8")) > MAX_PATH_BYTES:
        raise _bad_request(f"path longer than {MAX_PATH_BYTES} bytes")

    upload = form.get("file")
    if upload is None or isinstance(upload, str):
        raise _bad_request("file is required")
    # One byte past the cap is enough to know it is too large.
    data = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Image larger than {MAX_IMAGE_BYTES} bytes",
        )

    mime = sniff_image_mime(data[:16])
    if mime is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PNG, JPEG, GIF and WebP images are accepted",
        )

    await store_task_image(db, task_id, message_ts, path, mime, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def image_response(image: Optional[TaskImage]) -> Response:
    """The stored image as a response, or a bare 404 when there is none.

    ``nosniff`` keeps the browser to the stored (sniffed) type; the bytes were
    already checked to be a raster image, so nothing here can run as a page.
    """
    if image is None:
        return Response(status_code=status.HTTP_404_NOT_FOUND)
    return Response(
        content=image.data,
        media_type=image.mime,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": IMAGE_CACHE_CONTROL,
        },
    )
