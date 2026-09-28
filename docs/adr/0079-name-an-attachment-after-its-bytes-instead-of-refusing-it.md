# 0079. Name an Attachment After Its Bytes Instead of Refusing It

Date: 2026-09-28

## Status

Accepted

Amends [0047](0047-model-composer-attachments-as-one-ordered-list-in-a-lexical-draft.md)
and [0036](0036-store-composer-attachments-in-context-dir.md). Both record that a
pasted image is validated by magic bytes against its declared type and refused
when they disagree. That refusal is gone. The goal it served stays: the store
never names a payload as an image format its bytes disprove.

## Context

Dropping a GIF onto the composer could fail, and so could plenty of other files.

- **Mislabeled images were refused.** The renderer sends any `image/*` file under
  10 MB down the image write path, with the MIME type the browser derived from
  the file's extension. Main refused the payload when the bytes did not match
  that type. A "GIF" saved from a site that serves WebP, a `.png` that is really
  a JPEG, or a clip saved as `.gif` that is really an MP4 was answered with
  "Pasted attachment must be a valid image."
- **Unknown image types were refused.** Main maps only eight MIME types to an
  extension. `image/apng`, `image/heic`, a Photoshop file, and the many
  `image/x-*` types the Linux shared-mime-info database reports were all
  refused, although the user only asked to attach a file.
- **Empty files were refused.** The request schema required a non-empty body,
  and the decoder turned an empty body into `null`. The Zod failure text reached
  the composer word for word as JSON.
- **Dropped folders failed.** A folder arrives as a `File` whose bytes cannot be
  read, so the drop ended in a raw `FileReader` error.
- **Large GIFs never previewed.** The preview capped embedded images at the same
  10 MB as the paste cap. A larger file is attached by absolute path, and the
  composer treated that chip as not previewable. That rule predates `8dbb33a2`
  (#281), which let the preview read outside the workspace. An animated GIF over
  10 MB could not be seen at any point.

## Decision

**A payload is stored under the format its bytes really carry, and nothing is
refused for its format.**

`resolveAttachmentExtension` in
`src/main/workspace-files/context-attachments.ts` names every stored copy, on
both write paths:

- A declared extension that the bytes confirm is kept.
- A declared raster extension (from the name, or from the MIME type on the image
  path) that the bytes disprove is replaced by the format `sniffImageSignature`
  finds. When nothing is found, the extension is dropped for `txt` or `bin`.
- An extension with no known signature (`.pdf`, `.heic`, `.md`) is kept as
  written. Sniffing it could rename a text file that starts with `BM` to `.bmp`.
- Sniffing runs only on binary payloads, for the same reason.

An empty payload is stored like any other file. The image path still refuses a
payload over its 10 MB cap. The renderer never sends one that large, and it sends
empty files down the file path.

The attachment handlers no longer echo the Zod message. The composer shows the
failure code's translated headline through `failureText`. Main's own words follow
only when `failureDetail` finds runtime detail in them, such as the OS error
behind a failed write.

`getTransferItems` separates dropped folders by their `webkitGetAsEntry()`
entry. A folder inside the workspace becomes the same folder chip an @-mention
gives. A folder outside the workspace is named in a message that points at
**Link directory**.

The preview embeds images and PDFs up to `MAX_PREVIEW_EMBED_BYTES` (50 MB). This
is the attachment store's hard ceiling, so the preview can show any file the
composer can hold. An image whose bytes are a different browser-renderable
format is embedded under its real MIME type rather than reported as invalid.
An `external-file` chip now previews at its absolute path, as its sent-message
chip already did.

## Alternatives considered

- **Retry on the file path when the image path refuses.** This is renderer-only
  and costs a second IPC round trip. It would also keep the lie on disk: a WebP
  saved as `.gif` would still preview as broken, and an agent reading it would
  be told it holds a GIF.
- **Stream previews through a custom protocol** instead of base64 over IPC. This
  removes the size ceiling but adds a new file-reading scheme to the renderer's
  trust surface. A 41.6 MB GIF was measured to load from a `data:` URL in
  Chromium 150, and a 70 MB base64 reply crossed `ipcMain.handle` intact, so the
  existing path was widened instead.

## Consequences

- An attachment's extension can differ from the name the user dropped: `reaction.gif`
  that holds WebP bytes is stored as `reaction.webp`. The chip label is the
  stored name.
- Previewing a 50 MB image holds about 67 MB of base64 in main and in the
  renderer's query cache until it is evicted.
