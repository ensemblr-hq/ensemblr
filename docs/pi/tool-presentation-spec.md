# Pi extension-owned tool presentation (v1)

This is the public, data-only contract for an ordinary Pi extension to provide native Ensemblr timeline presentation. It is tested against Pi `0.85.1`; this does **not** change Ensemblr's supported Pi minimum. The payload is data, never executable UI.

The JSON Schema is [`schemas/tool-presentation.v1.schema.json`](../../schemas/tool-presentation.v1.schema.json). Portable TypeScript consumers should model the same JSON shape; do not import React, Shiki, or Ensemblr renderer types.

## Transport

Put the descriptor in the ordinary Pi tool result or partial result under the reserved key `details.ensemblr.presentation`. Keep the tool's existing `content` and every other `details` key unchanged:

```ts
return {
  content: [{ type: "text", text: "Found 3 files" }],
  details: {
    ...details,
    ensemblr: {
      ...details?.ensemblr,
      presentation: snapshot,
    },
  },
};
```

A presentation-only update should use `content: []` so it does not duplicate accumulated tool output. The Pi RPC protocol is JSONL and has a 1 MiB frame limit: the limit below does not protect a frame that is already too large to reach Ensemblr. Keep snapshots small and throttle updates.

## Descriptor

```json
{
  "version": 1,
  "title": { "en": "Search results", "ru": "Результаты поиска", "el": "Αποτελέσματα αναζήτησης" },
  "glyph": "search",
  "preview": { "font": "mono", "text": "src/main" },
  "body": { "kind": "code", "language": "text", "code": "src/main/example.ts:12", "startLine": null }
}
```

`version: 1` and a nonempty `title` are required. `glyph`, `preview`, and `body` are optional. If `body` is omitted, Ensemblr uses the ordinary tool output presentation.

Display prose (`title`, preview text, labels, and body prose) is either a plain string or a locale map with required `en` and optional `ru` and `el`. Ensemblr resolves the current app language, then English. Code, paths, and raw tool output are literal and are not localized.

### Glyphs

`glyph` accepts any valid lowercase kebab-case icon id from the installed `lucide-react` `1.40.0` icon set, such as `arrow-up-right` or `audio-lines`. The existing host glyph names remain supported: `bell`, `biceps-flexed`, `bot`, `brain`, `circle-stop`, `circle-x`, `clipboard-list`, `crosshair`, `eye`, `file-diff`, `file-pen`, `file-plus`, `file-text`, `folder-tree`, `git-branch-plus`, `hourglass`, `image`, `kanban`, `keyboard`, `list`, `message-circle-question`, `message-square-check`, `message-square-plus`, `message-square-text`, `network`, `panels-top-left`, `play`, `puzzle`, `scroll-text`, `search`, `send`, `square-terminal`, `square-x`, `stethoscope`, `terminal`, `ticket`, `ticket-check`, `ticket-plus`, and `wrench`. Names outside the installed set are rejected before the metadata is accepted. The renderer loads extension glyphs on demand; it does not eagerly import the full icon set.

### Bodies

Bodies are native primitives, not layouts. Supported `kind` values and fields:

- `markdown`: `text`.
- `code`: `language`, `code`, optional `startLine`.
- `labeled`: `sections`, each `{ label, text, muted? }`.
- `terminal`: `text`.
- `diff`: `language`, `patch`, optional `showFileNames`.
- `diagnostics`: `entries`, each `{ severity, message, line?, column?, source? }`; severity is `error`, `warning`, `info`, or `hint`.
- `checklist`: `items`, each `{ id, subject, status, detail?, number? }`; `id` is nonempty and unique within the snapshot, and status is `pending`, `in-progress`, `completed`, or `unknown`.

There is no HTML, CSS, callback, recursive layout, custom icon, or action descriptor. Unsupported code-language tags use Ensemblr's existing plain-text fallback.

## Limits and fallback

These limits include every translation. The serialized presentation is at most **64 KiB**; titles are at most **160 characters**; previews at most **512 characters**; each individual body string at most **32 KiB**; lists at most **100 entries**; and labeled bodies at most **16 sections**. Unknown versions, body kinds, glyph ids, malformed fields, and oversized descriptors are rejected safely and use the normal presenter. A missing or invalid presentation clears the current custom snapshot.

Presentation data is advisory. It cannot claim extension identity, set completion or error state, change permissions, grant capabilities, or replace host-owned failure and permission handling.

## Snapshot semantics and precedence

Every partial update is a **complete replacement snapshot**, not a patch. Do not send a fragment expecting Ensemblr to merge it. A final result is authoritative: repeat the presentation in the final result if it should remain; a final result without one uses the existing presenter. Historical results continue to render from stored data even if the extension is later updated or removed.

Host authority is explicit:

1. Host failure and permission handling.
2. Protected core-tool and Ensemblr Control presentation.
3. A valid extension presentation.
4. Existing third-party/name-based presenter.
5. Generic input/output fallback.

Thus a thrown tool error or `isError` result remains a host error even when a custom snapshot was supplied. Extension presentation can override hardcoded third-party presenters, but not core tools, Ensemblr Control, permissions, or failures.

## Example

See [`examples/extension-owned-presenter/`](./examples/extension-owned-presenter/) for a runnable extension with a separate presenter module, localized labels, initial/running/final snapshots, preserved text output, and a throwing failure path.

Run it directly while developing:

```bash
pi -e ./docs/pi/examples/extension-owned-presenter/extension.ts
```

Pi loads TypeScript extensions through its normal loader. There is no Ensemblr-specific install or discovery step.
