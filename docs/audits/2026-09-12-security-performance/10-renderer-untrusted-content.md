# Renderer surfaces that display untrusted content

The renderer's markdown pipeline is genuinely hardened and I could not get a
payload through it. Every user-visible markdown surface — chat, reasoning bodies,
review comments, Linear issue descriptions and comments, file preview — funnels
through one component (`src/renderer/components/message.tsx`) whose rehype chain
is *derived from* Streamdown's default rather than rebuilt, so `rehype-raw` →
`rehype-sanitize` → `rehype-harden` still runs in order. 28 HTML/URL payloads and
10 KaTeX payloads were rendered in happy-dom and all were neutralised. There is
no `dangerouslySetInnerHTML` anywhere, Shiki is consumed as tokens rather than as
HTML, mermaid runs `securityLevel: 'strict'` and is behind an explicit render
click, `ansi-to-react` runs with `linkify` off, and the composer is Lexical
plain-text so a pasted `text/html` payload never becomes nodes.

The findings below are therefore one confirmed **performance denial-of-service**
(a single long line freezes the renderer for a minute), plus a set of Low
defence-in-depth gaps: markup injection through `<Trans>` interpolation, ten raw
`href` bindings from external data with no scheme allowlist, and two paths where
a repository-controlled string opens a file outside the workspace on a click.

## Rendering surface inventory

| Surface (component) | Content source(s) | Renderer / path | Raw HTML? | URL handling | Verdict |
| --- | --- | --- | --- | --- | --- |
| `src/renderer/components/message.tsx` (`MessageResponse`) | agent output (1), tool results (2), Linear (3), file contents (2), repo markdown | `streamdown` 2.6.0 + `MARKDOWN_REHYPE_PLUGINS` | `rehype-raw` **on**, then `rehype-sanitize` with `hast-util-sanitize` `defaultSchema`, then `rehype-harden` | `href`: schema protocols + `tel`, `streamdown`, `ensemblr`. `src`: `http`/`https` + `ensemblr-linear-asset`. Links render as a `<button>` behind streamdown's link-safety modal → `window.open` → `setWindowOpenHandler` → `openExternalUrl` (http/https only) | Sound |
| `src/renderer/components/chat-message-text.tsx` | agent prose | delegates to `MessageResponse`, no `components` override | inherited | inherited | Sound |
| `src/renderer/components/comment-markdown.tsx` | GitHub PR review comments (4), Concierge/agent diff comments (10) | delegates to `ChatMessageText` | inherited | inherited | Sound |
| `src/renderer/components/linear/issue-detail.tsx:150`, `issue-comments.tsx:89` | Linear description + comments (3) | delegates to `ChatMessageText` / `CommentMarkdown` | inherited | inherited | Sound |
| `src/renderer/components/tool-collapsible/tool-body.tsx:24` | MCP tool result text (12), reasoning | delegates to `MessageResponse` | inherited | inherited | Sound |
| `src/renderer/components/workbench-shell/conversation-panel/file-preview-body.tsx:158` | repository markdown (2) | `MessageResponse` inside `MarkdownDocumentScopeProvider` | inherited | relative paths captured before harden → `MarkdownFileLink` / `MarkdownImage` | Sound, see [XSS-05] |
| `src/renderer/components/markdown/markdown-image.tsx:67` | repo images, PR badge images, Linear assets | `<img src>` with `loading=lazy`, `referrerPolicy=no-referrer` | n/a | workspace paths read through the preview IPC and re-served as a `data:image/*` URL; `staysInsideWorkspace` refuses a climb before any fetch | Sound |
| `src/renderer/components/markdown/markdown-file-link.tsx:56` | repo markdown, PR comments | `<button onClick={openFilePreview(match.path)}>` | n/a | no scheme; path must resolve in the workspace tree | [XSS-05] |
| `src/renderer/components/code-surface/**`, `code-block.tsx` | file contents, tool output (2,5) | Shiki `codeToTokens` → React `<span>` per token | none — no `codeToHtml`, no `innerHTML` | n/a | Sound; see [PERF-01], [PERF-03] |
| `src/renderer/components/diff-viewer/**` | untrusted repo diffs (2,7) | `react-diff-view` `tokenize` + Shiki ranges | none | n/a | Sound; see [PERF-01] |
| `src/renderer/components/terminal-output.tsx` | any program's stdout (5) | `ansi-to-react` 6.2.6, `linkify` **unset → false** | none — plain `<span>` per bundle | no anchors emitted at all | Sound |
| `src/renderer/lib/terminal/xterm-adapter.ts` | any program's stdout (5) | `@xterm/xterm` 6 + `addon-web-links` + `addon-webgl` | n/a | `WebLinksAddon` regex is http(s); **OSC 8 `linkHandler` forwards any scheme** to `openExternal` | [XSS-04] |
| `@streamdown/mermaid` | agent-authored diagrams (1) | `mermaid` with `securityLevel: 'strict'`, `suppressErrorRendering: true` | DOMPurify inside mermaid | `click … "javascript:"` refused by strict | Sound |
| `@streamdown/math` (KaTeX) | agent output (1) | KaTeX, `trust` unset (false) | n/a | `\href`, `\url`, `\includegraphics`, `\html*` all render as literal error text | Sound |
| `file-preview-body.tsx:61` (`<embed>`) | repository PDFs (2) | blob URL, `type="application/pdf"`, `%PDF-` signature checked in main | n/a | blob, not `file:` | Sound; see [PERF-04] |
| SVG files in a repository | repository (2) | **not** in `PREVIEW_IMAGE_MIME_TYPE_BY_EXTENSION` — read as text/diff | n/a | never reaches `<img>`/`<object>` | Sound, deliberate |
| Composer (`composer/editor/**`) | user paste, `@`-mention file names | Lexical `PlainTextPlugin`; `TransferPlugin` intercepts `PASTE_COMMAND` | plain-text mode ignores `text/html` | n/a | Sound |
| `<Trans>` call sites | branch names (7), repo/workspace names, typed refs | `react-i18next` 17 with `interpolation.escapeValue: false` | re-parses interpolated values | n/a | [XSS-02] |
| 10 raw `href={…}` bindings | GitHub PR/check/comment URLs (4), Linear URLs (3), deployment URLs | `<a target="_blank" rel="noreferrer">` | n/a | **no scheme allowlist** | [XSS-03] |
| Architecture diagram (`architecture-diagram/**`) | `.ensemblr/architecture.json` (10) | SVG `<text>` / `<g>`, labels as text nodes | none | `sources[].path` → `openFilePreview` unchecked | [XSS-05] |
| `sonner` toasts | failure codes, conflict messages | string children only, no JSX from remote data | n/a | n/a | Sound |
| Tool presenters (`lib/agent-timeline/**`) | tool args/results (2,12) | produce label strings and body descriptors only | none — no HTML strings, no href/src built | n/a | Sound |

---

## Findings

### [PERF-01] Shiki tokenization is quadratic in line length and blocks the renderer main thread

- Severity: **High** (availability)
- Confidence: **Confirmed** (measured)
- Where: `src/renderer/lib/code/highlighter.ts:166`, reached from `src/renderer/components/diff-viewer/shiki-tokenize.tsx:121` and `src/renderer/hooks/code-surface/use-highlighted-code.ts`

```ts
// highlighter.ts:166
	const result = highlighter.codeToTokens(code, {
		lang: langToUse,
		themes: { dark: theme, light: theme },
	});
```

- Payload: any file or tool output containing one very long line — a `.min.js`
  bundle, minified CSS, a single-line `package-lock.json`, a base64 blob in a
  fence, an agent echoing a long string.

**What.** `tokenizeWithShiki` is `async`, but `codeToTokens` is a synchronous
oniguruma pass that runs to completion in one task. There is no length cap, no
chunking, no worker, and no line-count cap. Cost is roughly O(n²) in the length
of a *single line*; total file size barely matters.

Measured with the repo's own `highlightCode`, warm highlighter, `typescript`
grammar (`.context/xss-probe/shiki-curve.test.tsx`, since removed):

| Input | Wall time |
| --- | --- |
| 1,013 chars, one line | 61 ms |
| 2,013 chars, one line | 235 ms |
| 4,013 chars, one line | 923 ms |
| 8,013 chars, one line | 6,394 ms |
| 16,013 chars, one line | 15,415 ms |
| 32,013 chars, one line | **62,494 ms** |
| 417,779 chars over 20,000 short lines | 1,526 ms |
| 100,013 chars, one line | did not finish in 6 min (killed) |

**Scenario.** Source (2) untrusted repository → the user opens a workspace whose
diff touches a minified asset, or an agent runs `cat dist/bundle.min.js` and the
result lands on a `code` tool body. The diff viewer highlights *both* sides
(`useDiffTokens` calls `useSideTokens` twice), so the cost doubles. The window
stops painting and every pending IPC reply stalls behind it. No malice is
required — this is the normal state of any repository with a committed bundle.

**Existing guards checked.** `MAX_CACHED_SOURCES = 200` bounds the tokens cache
but only after the first pass has already run. `toBundledLanguage` guards the
grammar name, not the size. `PARSE_CACHE_LIMIT = 32` in
`src/renderer/lib/diff/parse.ts` caches parsed hunks, again post-hoc. Nothing in
`src/renderer/components/diff-viewer/` or `src/renderer/components/code-surface/`
caps line length or file size before highlighting.

**Fix.** Bail out of highlighting above a threshold and render the plain-text
fallback the surfaces already have: `CodeLineTokens` takes a `fallback` and
`useDiffTokens` already returns `null` to mean "render un-tokenized". A per-line
cap (a few thousand characters) plus a total-source cap, checked in
`highlightCode` before `startHighlight`, covers every caller at once. Moving the
tokenization into a worker would remove the freeze but not the cost.

---

### [XSS-02] `<Trans>` interpolation of branch and repository names re-materialises `br`/`strong`/`i`/`p` markup

- Severity: **Low**
- Confidence: **Confirmed** (rendered, `.context/xss-probe/trans-attrs.test.tsx`)
- Where: `src/renderer/lib/i18n/instance.ts:54`; worst call site
  `src/renderer/components/workbench-shell/review-actions/merge-confirmation-dialog.tsx:67`

```tsx
// merge-confirmation-dialog.tsx:62
<Trans
	components={{ mono: <span className='font-mono' /> }}
	defaults='Merges <mono>{{branch}}</mono> through <mono>{{command}}</mono>. …'
	i18nKey='git:merge-dialog.description'
	values={{ branch: workspace.branchName, command: 'gh pr merge' }}
/>
```

- Payload: a branch named `<br/><strong>Verified by Ensemblr</strong>` (valid
  git ref — no spaces, no empty path component), or `<mono>injected</mono>`.

**What.** `interpolation: { escapeValue: false }` is the correct React setting
for `t()`, but `<Trans>` parses the *translated, already-interpolated* string as
markup. react-i18next re-materialises any tag in `transKeepBasicHtmlNodesFor`
(default `['br','strong','i','p']`) and any tag matching a `components` key.
Observed output for the payloads above:

| Interpolated value | Rendered |
| --- | --- |
| `<img/src=x/onerror=window.__pwn=1>` | escaped — `&lt;img/…&gt;` |
| `<script>…</script>`, `<b>bold</b>` | escaped |
| `<i onclick="…">x</i>` | `<i>x</i>` — **tag kept, attribute dropped** |
| `<strong style="position:fixed;…">TAKEOVER</strong>` | `<strong>TAKEOVER</strong>` — attribute dropped |
| `<p>block</p>` | `<p>block</p>` |
| `<mono>injected</mono>` | `<span class="font-mono">injected</span>` |

No attribute survives, so this is **not** script injection. It is markup
injection into a security-relevant confirmation dialog: a branch name can insert
a line break and a bold run, which is enough to make the merge dialog read as
though it carries reassurance the app did not write. Other call sites carrying
external strings: `workspace-landing-card.tsx:69,78` (branch names),
`new-chat-empty-state.tsx:41` (workspace name), `quick-start-dialog.tsx:151`
(project name), `branch-picker.tsx:155` (typed ref, self-inflicted).

**Fix.** Set `transKeepBasicHtmlNodesFor: []` on the i18next instance (the
catalogues use named `components` keys, not bare `<b>`/`<i>`), or render the
untrusted value as a child element rather than an interpolated value:
`<Trans …><span className='font-mono'>{branchName}</span>…</Trans>`.

---

### [XSS-03] Ten `href` bindings take external URLs with no scheme allowlist

- Severity: **Low**
- Confidence: **Confirmed** (code) / Speculative (exploitability)
- Where:

| File:line | Value | Source |
| --- | --- | --- |
| `src/renderer/components/workbench-shell/checks-panel/pr-rows.tsx:198` | `check.url` | GitHub check-run `details_url` — set by any GitHub App on the repo |
| `src/renderer/components/workbench-shell/conversation-panel/comment-preview-panel.tsx:135` | `comment.url` | GitHub review comment |
| `src/renderer/components/workbench-shell/dashboard/issue-card.tsx:204` | `issue.url` | issue provider |
| `src/renderer/components/workbench-shell/right-sidebar-header/preview-deployment-button.tsx:89` | `deployment.url` | deployment provider via `gh` |
| `src/renderer/components/workbench-shell/right-sidebar-header/pull-request-number-button.tsx:41`, `pull-request-menu.tsx:71` | `url` | GitHub PR |
| `src/renderer/components/linear/linked-issue-status.tsx:333`, `issue-detail-header.tsx:105` | `issue.url` / `linkedIssue.url` | Linear API |
| `src/renderer/components/settings/software-update-rows.tsx:137` | `downloadUrl` | release feed |

**What.** Every one is `<a href={…} rel='noreferrer' target='_blank'>`. Nothing
validates the scheme in the renderer. `will-navigate` never fires for a
`javascript:` URL, so the only thing standing between these and script execution
is Chromium's refusal to run a `javascript:` URL in a new browsing context — a
browser behaviour, not an app guard. The app's own policy
(`src/main/app/external-links-policy.ts:8`, http/https only) is reached solely on
the `window.open` path.

**Scenario.** Source (4) GitHub — a check run whose `details_url` is not http(s),
on a repository the user contributes to. Whether the GitHub API accepts such a
value is unverified; I did not test against a live API.

**Existing guards checked.** `parseAllowedExternalUrl` exists and is correct, but
is not applied here. `tests/main/external-links-policy.test.ts` covers the main
side only.

**Fix.** Route these through `window.ensemblr.openExternal` (as
`dock-actions.ts:146`, `use-update-sync.ts:165` and `create-pull-request-menu.tsx:109`
already do), or share one `ExternalLink` component that validates the scheme
before binding `href` and renders plain text when it fails. The same allowlist
already exists in `src/main/app/external-links-policy.ts` and could move to
`src/shared/`.

---

### [XSS-04] The terminal forwards an OSC 8 hyperlink URI to `openExternal` without validating its scheme

- Severity: **Low** (defence in depth)
- Confidence: **Confirmed** (code)
- Where: `src/renderer/lib/terminal/xterm-adapter.ts:264`

```ts
function openTerminalLink(_event: MouseEvent, uri: string): void {
	window.ensemblr?.openExternal(uri).catch((error: unknown) => {
		console.error('[terminal] failed to open link', uri, error);
	});
}
```

- Payload: `printf '\e]8;;javascript:alert(1)\e\\click me\e]8;;\e\\\n'`, or the
  same with `file:///`, `smb://`, `vscode://`, `itms-services://`.

**What.** `WebLinksAddon` only matches http(s), but `linkHandler.activate`
(`xterm-adapter.ts:66`) is the **OSC 8** path, where the URI is entirely chosen
by whatever writes to the PTY — any command, any agent harness, any build script
in an untrusted repository. The display text is also attacker-chosen and
independent of the URI, so the link can read `https://docs.example` while
pointing anywhere.

`openExternalUrl` in main refuses anything but http/https, so this is currently
not exploitable — but the renderer is treating an attacker-controlled string as
a URL it may hand to the OS, and the refusal lives a process away.

**Existing guards checked.** `allowProposedApi` is not set (default `false`), so
the OSC 52 clipboard-write addon is not loaded and `\e]52;c;…\a` is inert.
`convertEol: false`, `allowTransparency: false`. No `windowOptions` are enabled.

**Fix.** Validate in `openTerminalLink` before the IPC call and show the URI in a
confirmation when it does not match the display text — the same shape streamdown
already gives markdown links. Sharing `parseAllowedExternalUrl` from
`src/shared/` would make the renderer and main agree by construction.

---

### [XSS-05] A repository-controlled path opens a file outside the workspace on one click

- Severity: **Low**
- Confidence: **Confirmed** (code)
- Where: `src/renderer/components/markdown/markdown-file-link.tsx:56`;
  `src/renderer/components/workbench-shell/conversation-panel/architecture-diagram/architecture-diagram-panel.tsx:75`

```tsx
// architecture-diagram-panel.tsx:71
const openFilePreview = useFilePreviewOpener();
…
			openFilePreview?.(sourcePath);
```

- Payload: in `.ensemblr/architecture.json`, a component with
  `"sources": [{ "path": "../../../../../.ssh/id_rsa" }]` and an innocuous
  `name`; or in a PR comment, `[see the contributing guide](~/.aws/credentials)`.

**What.** `staysInsideWorkspace` (`src/renderer/lib/markdown-references.ts:84`)
is applied to markdown *images*, which fetch on render, and the reasoning is
written out in the JSDoc — but deliberately not to *links*, because agents
legitimately write `~/.claude/` and `/tmp` paths. The architecture diagram's
`sources[].path` gets no check at all. The visible label is the node name or the
link text, so the click target is not what the user reads; the `title` attribute
does carry the real path on hover.

This sits close to the `SECURITY.md` line — `.ensemblr/architecture.json` is a
tracked file in a repository the user chose to open, and trusting the repository
is explicit. It is in scope because a *PR comment* and an *agent-written*
`architecture.json` both reach the same surface without the repository owner
having approved them, and because reading a file is not the same grant as running
its setup script.

**Fix.** Keep the escape hatch for links, but make it visible: when the resolved
path leaves the workspace, show the destination in the link text or behind a
confirmation instead of opening silently. For the diagram, run `sourcePath`
through the workspace path resolver the way `MarkdownFileLink` does, so a path
the tree cannot place renders as an inert label.

---

### [PERF-03] Code and diff surfaces render every line; nothing virtualises

- Severity: **Low**
- Confidence: **Confirmed** (code)
- Where: `src/renderer/components/code-surface/code-lines.tsx`,
  `src/renderer/components/code-surface/code-surface.tsx:55`

**What.** `CODE_SURFACE_MAX_HEIGHT` is a CSS `max-height` with `overflow-auto` —
it bounds the *box*, not the DOM. A 50,000-line file read by a tool produces
50,000 rows plus one `<span>` per Shiki token. `@tanstack/react-virtual` is a
dependency and is used elsewhere, but not here. This compounds [PERF-01]: the
tokenizer finishes and then React reconciles a six-figure node count.

**Fix.** Virtualise `CodeSurface` and the diff viewer's hunk list, or cap the
rendered line count with an explicit "show the rest" control.

---

### [PERF-04] PDF preview decodes base64 one byte at a time on the main thread

- Severity: **Low**
- Confidence: **Confirmed** (code)
- Where: `src/renderer/hooks/workbench-shell/conversation-panel/use-pdf-object-url.ts:10`

```ts
	const binary = atob(base64);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
```

**What.** Linear in size, but it runs inside a `useEffect` on the renderer main
thread; a 100 MB PDF in a repository is 100M iterations plus the `atob` string.
Not a security issue — the `%PDF-` signature check in main and the explicit
`type: 'application/pdf'` on both the Blob and the `<embed>` are correct.

**Fix.** Have the preview IPC return bytes rather than base64, or decode via
`fetch(`data:…`).then(r => r.blob())`, which does the work off the JS thread.

---

### [INFO-06] The agent's linked-directory grant is stored in renderer localStorage

- Severity: **Info**
- Confidence: **Confirmed** (code + JSDoc)
- Where: `src/renderer/state/preferences/atoms.ts:104`

> Directories outside the workspace this chat has been given access to … rides
> every `openAgentSession` call; **the main process keeps no copy of its own.**

**What.** The set of directories an agent may read outside its worktree is a
permission grant whose only durable record lives on the renderer side, and it is
re-asserted to main on every session open. Main validates the *shape* (absolute
path) but has nothing to compare the *authorisation* against. Any renderer-side
code execution — the thing the rest of this report is about — therefore widens
the agent's filesystem reach as a side effect, and so does anything else that can
write `localStorage`.

I am recording this as an origin rather than a finding: whether main should hold
its own copy is the IPC auditor's call. The other persisted values I traced
(`lastRunScriptAtomFamily`, `repoSettingsOverrideAtomFamily`,
`prDetailsDraftAtomFamily`, `favouriteModelsAtom`, the per-chat model/thinking/
plan/AFK atoms) are all re-validated against a live list or a schema on the main
side before use.

---

## Verified sound

Payloads rendered through `MessageResponse` in happy-dom; none set the sentinel
global, and each line records what the DOM actually contained.

**Raw HTML** — `rehype-sanitize` runs after `rehype-raw`, so the schema decides:

- `<script>…</script>` → removed, text kept
- `<img src=x onerror="…">` → `src` stripped by harden, rendered as the
  `image-unavailable` placeholder; no `onerror` attribute in the DOM
- `<svg onload="…">` → removed entirely
- `<p onclick="…">click</p>` → `<p>click</p>`, attribute gone
- `<iframe>`, `<embed>`, `<base href>`, `<meta http-equiv=refresh>`,
  `<link rel=stylesheet>` → removed, no node emitted
- `<object data>` → removed, empty `<p>` left
- `<form action>` → form removed; the `<input>` survives as a GFM task checkbox
- `<style>@import url(…)</style>` → contents rendered as **text**, no style element

**URL schemes** — sanitize strips the attribute, harden then draws its indicator:

- `[click](javascript:…)` → `<span class="text-gray-500">click [blocked]</span>`
- `<javascript:alert(1)>` (autolink) → blocked
- `![x](javascript:…)` → `[Image blocked: x]`
- `[x](file:///etc/passwd)` / `![x](file:///etc/passwd)` → blocked
- `[x](vscode://file/etc/passwd)` → blocked
- `![x](data:image/svg+xml;base64,…)` → blocked (sanitize's `protocols.src` is
  `http`/`https` + the Linear scheme; harden's `allowDataImages: true` never gets
  the chance)
- `<a href="https://evil.example" target="_blank">x</a>` → `<button
  data-streamdown="link">`, no `href` in the DOM; click opens streamdown's
  link-safety modal, confirm calls `window.open` → `setWindowOpenHandler` →
  `openExternalUrl` (http/https)
- `[x](ensemblr://reference/foo)` → survives sanitize (the app admits the scheme
  for Concierge references) but an href that does not parse as a reference stays
  a streamdown link button, so the click still ends at `openExternalUrl` and is
  refused there

**KaTeX** (`@streamdown/math`, `trust` unset) — every one renders as literal
muted error text rather than as a command:

- `$$\href{javascript:alert(1)}{click}$$`, `$$\url{javascript:alert(1)}$$`,
  `$$\includegraphics[width=1cm]{https://evil.example/x.png}$$`,
  `$$\htmlId{x}{y}$$`, `$$\htmlStyle{position:fixed;inset:0;background:red}{y}$$`,
  `$$\htmlData{foo=bar}{y}$$`
- `$…$`, `\[…\]` and `\(…\)` are not math delimiters in this configuration at
  all — they render as plain prose

**Mermaid** (`@streamdown/mermaid`, `securityLevel: 'strict'`, nothing overrides
it) — both payloads render as an inert syntax-highlighted code block behind an
explicit render control:

- ` ```mermaid … click A "javascript:alert(1)" `
- ` ```mermaid %%{init: {"securityLevel":"loose"}}%% … A["<img src=x onerror=alert(1)>"] `

**Fence language tags** — `toBundledLanguage`
(`src/renderer/lib/language-from-path.ts:79`) falls back to `text`, including for
prototype keys, so `createHighlighter` never sees an unknown grammar:

- ` ```<script>alert(1)</script> `, ` ```constructor `, ` ```__proto__ ` → all
  render as plain `text` code blocks

**Terminal output** — `ansi-to-react` 6.2.6 with `linkify` unset defaults to
`false`; `convertBundleIntoReact` then returns a bare `<span>` and emits no
anchor at all, so OSC/ANSI link text cannot become an `href`. Rendering
20,000 `a\b` pairs and a 500,000-character line each took under 20 ms.

**Composer** — `PlainTextPlugin` plus a `PASTE_COMMAND` handler at
`COMMAND_PRIORITY_CRITICAL` that routes the `DataTransfer` to the attachment
store; `text/html` from the clipboard is never converted to nodes.

**Shiki** — no `codeToHtml` and no `dangerouslySetInnerHTML` anywhere in `src/`.
Tokens become React elements in `CodeLineTokens` and `renderToken`.

---

## Coverage

Read and reasoned about: `message.tsx`, `markdown-rehype-plugins.ts`,
`markdown-references.ts`, `components/markdown/**`, `comment-markdown.tsx`,
`chat-message-text.tsx`, `tool-collapsible/tool-body.tsx`, `code-surface/**`,
`lib/code/highlighter.ts`, `language-from-path.ts`, `diff-viewer/shiki-tokenize.tsx`,
`terminal-output.tsx`, `lib/terminal/xterm-adapter.ts`, `shared/preview-media.ts`,
`file-preview-helpers.ts`, `file-preview-body.tsx`, `use-pdf-object-url.ts`,
`components/linear/**`, `checks-panel/pr-rows.tsx`, `lib/github/**`,
`architecture-diagram/**`, `composer/editor/**`, `lib/i18n/instance.ts`, every
`<Trans>` call site, every `openExternal`/`href=`/`src=` in `src/renderer`, and
the `atomWithStorage` inventory.

Probed by rendering: 28 markdown payloads, 10 KaTeX payloads, 12 `<Trans>`
payloads, 4 performance scenarios. Probe files lived in `.context/xss-probe/`
(gitignored) and were removed; nothing under `src/`, `tests/`, `resources/`,
`scripts/` or any config was touched.

## Open questions

1. **Does the GitHub Checks API accept a non-http `details_url`?** This decides
   whether [XSS-03] is a latent bug or a live one. Needs a live API call I did
   not make.
2. **Is `ensemblr:` registered as a privileged scheme in main?** `main.ts` calls
   `registerLinearAssetScheme()` for `ensemblr-linear-asset:`; I did not trace
   whether `ensemblr:` is registered. If it is, an `ensemblr://` markdown link
   that is not a valid Concierge reference is a navigable target rather than an
   inert one. The main-process auditor owns this.
3. **Chromium's `javascript:` + `target="_blank"` behaviour in Electron 44.**
   [XSS-03]'s "not currently exploitable" rests on it; confirming needs the app
   running, which this audit does not do.
4. **Should `staysInsideWorkspace` gate links as well as images?** [XSS-05] is a
   deliberate product decision with a written rationale. The question is only
   whether a *PR comment* deserves the same latitude as a repository document,
   since both render through the same component.
