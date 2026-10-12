# CLI inline images: limit what gets decoded

Status: done on `fix/cli-image-decode-limits`

## Problem (evidence)

Review of the inline images change (#856) said: `imageFileSize` reads only the header, but `rasterizeSvg`
hands the whole file to resvg, which decodes the bitmap at its full size before scaling it down to the
placement. The `src` comes from the model's answer (or from text planted in a file or page it read), and
drawing it needs no approval, unlike `read_file`.

Measured with `@resvg/resvg-js` from `apps/cli`: a 380 KB PNG with a 10000 x 10000 header (all zeros),
wrapped exactly as `wrapBitmapInSvg` does and rendered at 600 px, took 1.0 s and a peak RSS of 468 MB.
The decode is synchronous and runs inside `useMemo` of `InlineImage`, on the render path. 20000 x 20000
scales that to about 1.9 GB. `readImageBytes` also read any regular file whole, whatever its size.

## Fix

- `imageEncoding.ts`: `MAX_IMAGE_PIXELS = 4096 * 4096` (a 12 MP phone photo still fits).
- `InlineImage.tsx`: `prepareImage` returns undefined (text fallback) when the header's width x height is
  over the limit, before resvg sees the bytes. Applies to files and `data:` URLs alike.
- `InlineImage.tsx`: `readImageBytes` stats the file first and skips files over 32 MB.

Mermaid diagrams are vector SVG rendered straight at the placement width, so they are not affected.

## Not changed

Paths outside the workspace stay allowed: the image is only shown to the user, nothing goes back to the
model, and a legitimate answer often points at a file a command wrote to `/tmp`. With the limits above,
pointing at an arbitrary file costs at most one 32 MB read and a bounded decode.

## Tests

`InlineImage.test.tsx`: a valid 64 x 64 PNG is drawn, a valid 4097 x 4097 PNG (1 bit a pixel, so the test
stays cheap) falls back to the placeholder. With the gate disabled the new test fails.
