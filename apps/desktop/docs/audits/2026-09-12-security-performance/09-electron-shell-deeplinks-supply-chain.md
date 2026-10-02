# Electron shell, deep links, custom protocols and the app's own supply chain

The Electron shell is in good shape on the items that matter most: `contextIsolation` is on,
`nodeIntegration` is off, the preload touches nothing outside the `electron` module (so the
renderer really is sandboxed under Electron ≥20's default), session permissions are denied by
allowlist, and six fuses are flipped including asar integrity validation. The production
dependency tree has **zero** advisories and every one of the 620 lockfile entries carries an
integrity hash resolved from `registry.npmjs.org`.

Four items are worth acting on. The pinned Electron is **44.1.1 against an upstream 44.3.0**, so
two patch releases of Chromium fixes are missing. There is **no Content-Security-Policy** on any
surface, and the **`GrantFileProtocolExtraPrivileges` fuse is left at its permissive default**
while the production renderer runs on a `file://` origin — together those are the two missing
layers underneath a renderer compromise (which the renderer-XSS sibling assesses on its own
terms). And the Linux native-module preflight silently pulls an **unpinned container image** and
bind-mounts the repository into it read-write.

No deep-link attack surface exists today: `src/shared/deep-link.ts` has no consumer, `second-instance`
logs argv and never interprets it, and macOS never registers the scheme at all. The Linux AppImage
*does* register it, which is a small drive-by-launch nuisance rather than a vulnerability.

---

## Electron hardening checklist

Walking the official checklist (https://www.electronjs.org/docs/latest/tutorial/security).

| # | Checklist item | Status | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Only load secure content | ✅ | `src/main/app/main-window.ts:104-110` — dev loads the Vite `http://localhost` origin, prod `loadFile`s the bundled `index.html`. No remote origin is ever loaded. | Pass |
| 2 | Disable Node.js integration for remote content | ✅ | `src/main/app/main-window.ts:56` `nodeIntegration: false`. `nodeIntegrationInSubFrames`/`InWorker` never set (default off). | Pass |
| 3 | Enable context isolation | ✅ | `src/main/app/main-window.ts:55` `contextIsolation: true`. Preload exposes a typed surface via `contextBridge` (`src/preload/preload.ts:1`, `src/preload/bridge/ensemblr-api.ts:407`). | Pass |
| 4 | Enable process sandboxing | ✅ (implicit) | `sandbox` is not set, but Electron ≥20 defaults it to `true` for every renderer whose `nodeIntegration` is `false`. The preload imports only `electron` (`contextBridge`, `ipcRenderer`, `webUtils`) — all available to a sandboxed preload — so nothing forces `sandbox: false`. No `app.enableSandbox()` and no `--no-sandbox` anywhere in `src/`. | Pass — see SH-13 for making it explicit |
| 5 | Handle session permission requests | ✅ | `src/main/app/media-permissions.ts:19-40` installs both `setPermissionRequestHandler` and `setPermissionCheckHandler`; `media-permissions-policy.ts:43-59` allowlists `clipboard-sanitized-write` and audio-only `media`, refusing everything else including `openExternal`, camera, screen capture, geolocation, USB/HID/serial/Bluetooth. Request and check share one pure policy, so the two cannot drift. | Pass — best-in-class |
| 6 | Do not disable `webSecurity` | ✅ | Not set anywhere in `src/`. No `--disable-web-security`, no `--allow-file-access-from-files`, no `app.commandLine.appendSwitch` calls at all. | Pass |
| 7 | Define a Content-Security-Policy | ❌ | No `<meta http-equiv>` in `index.html`; no `onHeadersReceived`; no `session.defaultSession` configuration anywhere in `src/main`. | **SH-02** |
| 8 | Do not enable `allowRunningInsecureContent` | ✅ | Not set. | Pass |
| 9 | Do not enable experimental features | ✅ | `experimentalFeatures` not set. | Pass |
| 10 | Do not use `enableBlinkFeatures` | ✅ | Not set. | Pass |
| 11 | `<webview>`: do not use `allowpopups` | ✅ | No `<webview>` in the tree. | N/A |
| 12 | Verify `<webview>` options / disable webview creation | ⚠️ | `webviewTag` is not set (Electron default `false`), so a tag cannot be created today. There is no `web-contents-created` → `will-attach-webview` backstop, so the protection rests entirely on the default. | **SH-05** |
| 13 | Disable or limit navigation | ⚠️ | `src/main/app/external-links.ts:71-72` binds `will-navigate` and `will-redirect`, but `external-links-policy.ts:48-58` only *diverts* http(s) navigations to a foreign origin. A `file:`, `blob:` or `data:` navigation returns `null` and proceeds. `will-frame-navigate` is not bound, so subframes are unguarded. | **SH-05** |
| 14 | Disable or limit creation of new windows | ✅ | `src/main/app/external-links.ts:52-55` — `setWindowOpenHandler` returns `{ action: 'deny' }` unconditionally and routes the URL through the vetted opener. | Pass |
| 15 | Do not use `shell.openExternal` with untrusted content | ✅ (one gap) | The renderer-reachable path is guarded: `src/main/ipc/handlers/window.ts:19` → `openExternalUrl` → `parseAllowedExternalUrl` (`external-links-policy.ts:8,25`), which allows `http:`/`https:` only and refuses `file:`, `javascript:`, `vscode://`, `x-apple.systempreferences:` and every other custom scheme. One raw call bypasses that policy (`src/main/main.ts:1403`) but only ever receives a hardcoded `https://linear.app/oauth/authorize` URL. | Pass — **SH-10** is defense-in-depth |
| 16 | Use a current version of Electron | ❌ | `package-lock.json` pins `electron@44.1.1`; upstream `44-x-y` is `44.3.0`. | **SH-01** |
| 17 | Validate the sender of all IPC messages | — | Out of my dimension; the IPC sibling owns it. Structurally there is exactly one `BrowserWindow` and no remote content, so `senderFrame` spoofing has no vehicle today. | See sibling report |
| 18 | Avoid `file://`, prefer a custom protocol | ❌ | Production loads `file://…/index.html` (`main-window.ts:107-109`) and the `GrantFileProtocolExtraPrivileges` fuse is not set, so the default (`true`) applies. | **SH-03** |
| 19 | Check which fuses you can change | ⚠️ | Six set (`forge.config.ts:382-390`): `RunAsNode=false`, `EnableCookieEncryption=true`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`. `GrantFileProtocolExtraPrivileges` (`FuseV1Options[7]`, available in the pinned `@electron/fuses@2`) is absent. | **SH-03** |
| 20 | Do not expose Node primitives over the bridge | ✅ | `src/preload/bridge/ensemblr-api.ts` exposes invoke/on wrappers over named channels plus `webUtils.getPathForFile`; no `ipcRenderer`, no `require`, no Electron objects. | Pass |
| — | TLS validation intact | ✅ | No `certificate-error` handler, no `setCertificateVerifyProc`, no `ignore-certificate-errors` switch, no `select-client-certificate` or `login` handler. Chromium's defaults stand. | Pass |
| — | Custom scheme privileges minimal | ✅ | `src/main/linear/linear-asset-protocol.ts:18-23` — `{ secure, standard, supportFetchAPI }`, deliberately **not** `bypassCSP` and **not** `allowServiceWorkers`. | Pass |

---

## Findings

### [SH-01] Pinned Electron is two patch releases behind the 44 line

- **Severity:** Medium
- **Confidence:** Confirmed
- **Where:** `package-lock.json` (`node_modules/electron` → `44.1.1`), declared `^44.1.1` in `package.json`

```
$ node -p "require('./package-lock.json').packages['node_modules/electron'].version"
44.1.1
$ npm view electron dist-tags --json | grep 44-x-y
  "44-x-y": "44.3.0",
```

**What.** Electron patch releases inside a supported line exist almost exclusively to carry
Chromium and V8 security fixes. Two of them (44.2.0, 44.3.0) have shipped since the pinned
version. `npm ci` installs the lockfile, so every CI build and every release artifact is built
against 44.1.1.

**Scenario.** Remote content reaching Blink → a fixed-upstream Chromium bug is still live in a
shipped build. The app loads no remote content directly, so the realistic vehicle is the
renderer's own parsing of untrusted repository content (markdown, images, PDFs via SH-08) or a
follow-on from any XSS the sibling report finds.

**Existing guards & tests checked.** `.github/dependabot.yml` has a weekly npm schedule with a
`dev-dependencies` group, so an Electron bump should be proposed automatically — the gap is that
it has not been merged, not that it is unwatched. Nothing pins Electron for a stated reason the
way `@types/node` is pinned (`.github/dependabot.yml:12-17`).

**Fix.** Bump to `44.3.0` and re-run the Linux `node-pty` ABI check (`scripts/require-linux-toolchain.mjs --report`),
since a patch bump does not move `NODE_MODULE_VERSION` and should be a lockfile-only change.
Treat Electron patch bumps inside the pinned major as routine rather than grouped with the rest
of `dev-dependencies`; a dedicated Dependabot group for `electron` makes the PR visible instead
of buried in a five-package batch.

---

### [SH-02] No Content-Security-Policy on any surface

- **Severity:** Medium
- **Confidence:** Confirmed
- **Where:** `index.html:1-16` (no `<meta http-equiv="Content-Security-Policy">`), `src/main/**` (no `onHeadersReceived`, no `session.defaultSession` configuration at all)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ensemblr</title>
  </head>
```

**What.** The renderer runs with Chromium's default policy: any origin may be scripted from,
`eval` is available, and `connect-src` is unlimited. Electron's checklist item 7 calls a CSP the
"most important" of the defense-in-depth layers precisely because it is the one that survives a
markup-injection bug.

**Scenario.** Renderer XSS (a rendered agent message, a repository filename, a Linear issue body)
→ the injected script may `fetch()` a remote payload, `eval` it, and POST exfiltrated data
anywhere. It may also reach `http://127.0.0.1:<control port>`; that server is guarded by a
per-session bearer token and a `Host` check (the agent-control sibling owns that), but a CSP
`connect-src` directive would make the attempt impossible rather than merely rejected.

The marginal severity is bounded by the fact that a compromised renderer already holds
`window.ensemblr`, which reaches terminal spawn and script execution — so a CSP does not prevent
escalation on its own. It removes the remote-payload and exfiltration channels, which is what
keeps it Medium rather than higher.

**Existing guards & tests checked.** `linear-asset-protocol.ts:20` deliberately withholds
`bypassCSP` from the Linear scheme — the codebase has clearly reasoned about CSP interaction, so
the absence reads as untackled rather than rejected. No test asserts a CSP header.

**Fix.** Inject the header from `session.defaultSession.webRequest.onHeadersReceived`, which
covers `file://` and the dev `http://` origin alike and does not need `index.html` to be
regenerated. A policy the current stack survives:

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';          # Tailwind 4 + shadcn emit inline styles
img-src 'self' data: blob: linear-asset:;   # preview images, PDF blob, Linear proxy scheme
font-src 'self' data:;                      # bundled Nerd Font
connect-src 'self';
worker-src 'self' blob:;                    # Shiki / mermaid workers
object-src 'self' blob:;                    # the PDF <embed>
frame-src 'self' blob:;
base-uri 'none';
form-action 'none';
```

`'unsafe-inline'` for `style-src` is unavoidable with Tailwind 4 and the motion library; it is the
weakest part of the policy and does not undo the value of the rest. In dev the Vite HMR client
needs `connect-src 'self' ws://localhost:*` and `script-src 'self' 'unsafe-inline'` — gate that
branch on `MAIN_WINDOW_VITE_DEV_SERVER_URL` so the packaged build never ships the relaxed form.
Land it behind a renderer smoke test that fails on any `Refused to …` console error, because a
CSP that silently breaks Shiki is worse than none.

---

### [SH-03] `GrantFileProtocolExtraPrivileges` left at its permissive default under a `file://` renderer

- **Severity:** Medium
- **Confidence:** Confirmed
- **Where:** `forge.config.ts:382-390`

```ts
new FusesPlugin({
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
}),
```

**What.** The fuse exists in the pinned `@electron/fuses@2` (`node_modules/@electron/fuses/dist/config.d.ts:15`,
`GrantFileProtocolExtraPrivileges = 7`) and is not listed, so the backwards-compatible default
`true` applies. That grants pages on a `file://` origin privileges a browser withholds: `fetch`
and `XMLHttpRequest` to other `file://` URLs, a non-opaque origin, and service-worker
registration. Production loads exactly such a page (`src/main/app/main-window.ts:107-109`).

**Scenario.** Renderer XSS in a packaged build → `fetch('file:///Users/<me>/.ssh/id_ed25519')`
resolves, as does anything else readable by the user, with no IPC handler and no path validation
in the loop. Paired with SH-02 there is no `connect-src` to stop the result leaving the machine.
As with SH-02 the marginal gain over the existing IPC bridge is what caps this at Medium: a
compromised renderer can already read files through `window.ensemblr`. What this removes is the
*unlogged, unvalidated* path that bypasses every handler-side check the IPC sibling is auditing.

**Existing guards & tests checked.** No test covers the fuse set. `tests/main/` has no
`fuses`-named file; the fuse list is asserted nowhere, so a future edit that drops one is silent.

**Fix.** Two steps, in order.

1. Short term, set `[FuseV1Options.GrantFileProtocolExtraPrivileges]: false` and verify the
   packaged renderer still boots. The bundle loads its assets as ordinary relative
   `<script src>`/`<link href>` subresources, which the fuse does not govern, so this is likely a
   no-op for rendering — but Electron's own guidance is that an app *loading* from `file://` may
   need it, so this has to be confirmed against a real `npm run make` artifact on both platforms
   rather than reasoned about.
2. Properly, migrate the production renderer off `file://` to a custom `app://` scheme served
   with `protocol.handle`, which is checklist item 18's actual recommendation. The repo already
   has the pattern in hand — `src/main/linear/linear-asset-protocol.ts` registers a privileged
   scheme and serves it — so this is a second instance of an established shape, not a new one. It
   also gives the CSP in SH-02 a real origin to anchor `'self'` to.

Add a `tests/main/` assertion over the fuse list in the same change, matching how
`tests/main/database.test.ts` pins migration ids.

---

### [SH-04] The Linux native-module preflight auto-runs an unpinned container image with the repo bind-mounted read-write

- **Severity:** Medium
- **Confidence:** Confirmed
- **Where:** `scripts/rebuild-native-linux.sh:16,50-60`, invoked from `scripts/require-linux-toolchain.mjs:262`

```bash
IMAGE=${ENSEMBLR_NATIVE_REBUILD_IMAGE:-node:24-bookworm}
...
"$runtime" run --rm \
	--volume "$repo_root":/src \
	--workdir /src \
	--env MODULE="$MODULE" \
	"$IMAGE" \
	bash -euo pipefail -c '
		command -v python3 >/dev/null 2>&1 || {
			apt-get update -qq && apt-get install -y -qq python3
		}
		npx electron-rebuild --force --module-dir "$MODULE"
	'
```

**What.** `node:24-bookworm` is a floating tag, not a digest. `require-linux-toolchain.mjs` runs
ahead of `dev`, `package:linux` and `make:linux` and shells out to this script automatically when
the binding is missing or ABI-stale — per `.claude/rules/stack.md`, deliberately "rather than
printing an instruction the contributor would only have to retype." The container runs as root
(the script's own uid check at line 78-89 confirms rootful docker is an expected case) with the
entire repository writable, and installs `python3` from Debian mirrors inside the same shell.

Build integrity is explicitly in scope per `SECURITY.md` ("code signing, notarization, or
build-channel identity"), and this is the one step where a third-party artifact of unverified
content produces a binary (`node-pty/build/Release/pty.node`) that is then packaged into a shipped
AppImage.

**Scenario.** A compromised or tag-repointed `node:24-bookworm` → arbitrary writes anywhere in the
worktree (source, `package-lock.json`, `.git/hooks`) and a backdoored native binding inside the
release artifact. No signature or digest check exists on either the image or the resulting `.node`.
The trigger requires no operator decision — `npm run dev` on a Linux host is enough.

**Existing guards & tests checked.** Three real guards exist and work: `--report` never builds,
`ENSEMBLR_NATIVE_AUTOBUILD` blocks re-entry, and `ENSEMBLR_SKIP_NATIVE_AUTOBUILD` is an opt-out.
The script also refuses to run on non-Linux (line 21-26) and refuses root-owned output (line 78-89).
None of them addresses image provenance.

**Fix.** Pin the image by digest — `node:24-bookworm@sha256:…` — and treat the digest the way
`package-lock.json` treats an integrity hash: a reviewed line in the repo, bumped deliberately.
Drop `--env`-free root by passing `--network=none` after the `apt-get` step is removed (use a
`buildpack-deps`-derived tag that already carries `python3`, which the comment at line 15 says is
the expectation anyway, so the `apt-get` fallback is dead weight that opens a network fetch).
Narrow the mount to `node_modules/node-pty` plus whatever `electron-rebuild` reads, rather than the
whole `$repo_root`. And make the autobuild require an explicit opt-*in* for release builds
(`make:linux`), keeping the convenience only for `dev`.

---

### [SH-05] Navigation policy covers only top-level http(s); `file:`/`blob:` and subframe navigations are unguarded

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `src/main/app/external-links-policy.ts:48-58`, `src/main/app/external-links.ts:71-72`

```ts
export function externalNavigationTarget(url: string, appOrigin: string | null): URL | null {
	const parsed = parseAllowedExternalUrl(url);
	if (!parsed || (appOrigin && parsed.origin === appOrigin)) {
		return null;
	}
	return parsed;
}
```

**What.** `parseAllowedExternalUrl` returns `null` for any non-http(s) scheme, and the caller reads
`null` as "let the navigation proceed in-app." The JSDoc says this is intentional so the
production `file:` bundle keeps routing — correct for the *app's own* `index.html`, but it means
`location.assign('file:///etc/passwd')`, `blob:`, and `data:` top-level navigations are all
permitted rather than denied. Separately, only `will-navigate` and `will-redirect` are bound;
`will-frame-navigate` (Electron 22+) is not, so a subframe may navigate anywhere including a
remote origin, and there is no `app.on('web-contents-created')` backstop to carry the same policy
onto any future `WebContents` (a `<webview>`, a future second window, a devtools-extension frame).

**Scenario.** Renderer XSS → navigate the top frame to an attacker-controlled `blob:` document, or
inject an `<iframe src="https://evil.example">`. Neither escalates on its own: a navigated top
frame loses the React app but keeps the preload (so the IPC surface is *already* reachable without
this), and a subframe gets no preload because `nodeIntegrationInSubFrames` is off and the
`contextBridge` exposure is main-frame-scoped. The value here is removing a pivot, not blocking
one — hence Low.

**Existing guards & tests checked.** `tests/shared/external-links-policy.test.ts` exists and
covers the http(s) allowlist and the same-origin case. `webviewTag` is unset (default `false`), so
a `<webview>` cannot be created today; the missing `will-attach-webview` matters only if that
default is ever changed.

**Fix.** Invert the policy: deny by default. `will-navigate`/`will-redirect` should permit exactly
the app's own document (the dev origin, or the packaged `index.html` `file:` URL / the `app://`
origin once SH-03 lands), divert `http(s)` externally, and `preventDefault()` everything else. Bind
`will-frame-navigate` to the same handler. Add an `app.on('web-contents-created')` that applies
`routeExternalLinksToBrowser` plus a `will-attach-webview` that deletes `preload` and rejects any
`src` outside the app origin, so a future window inherits the policy instead of needing a second
call site.

---

### [SH-06] Linux registers `x-scheme-handler/ensemblr` with no handler, and logs the attacker-supplied URL verbatim

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `forge.config.ts:348-352`, `src/main/main.ts:2050-2057`

```ts
// Writes `x-scheme-handler/ensemblr` into the generated `.desktop` file…
// `src/shared/deep-link.ts` has no consumer yet; this only prepares the ground.
mimeType: ['x-scheme-handler/ensemblr'],
```

`@reforged/maker-appimage` writes `Exec=<bin> %U` (`node_modules/@reforged/maker-appimage/dist/main.js:99`),
so the URL is passed as argv. In the running instance that argv lands here:

```ts
app.on('second-instance', (_event, argv, workingDirectory) => {
	console.warn('[single-instance] blocked a second launch', { argv, workingDirectory });
	const [existing] = BrowserWindow.getAllWindows();
	if (existing) { … existing.focus(); return; }
	openMainWindow();
});
```

**What.** The scheme is registered with the desktop environment but nothing consumes it. The
effect is a drive-by launch/focus primitive: any web page a Linux user visits can
`location.href = 'ensemblr://x'` and force the app to the foreground. The argv — fully
attacker-controlled and unbounded — is then written to the log as-is.

**Scenario.** Web page → `ensemblr://` → app raised to front, arbitrary string in the log. No
state change, no navigation, no IPC. The log write is the sharper edge of the two: a support
bundle that collects stderr would carry attacker-chosen text, and a very long URL is an
unbounded write.

**Existing guards & tests checked.** `second-instance` genuinely ignores argv — it is read only
for the `console.warn`. `tests/main/deep-link-parse.test.ts` covers the parser, which nothing
calls. macOS does not register the scheme at all (no `CFBundleURLTypes` in `extendInfo`, no
`app.setAsDefaultProtocolClient`), so this is Linux-only.

**Fix.** Either drop `mimeType` from the AppImage maker until a handler exists, or wire the
handler now. If wiring it: bound the argv scan to one `ensemblr://`-prefixed entry, cap its length
before parsing, route it through `parseDeepLink`, and — critically — keep every deep link
*navigation-only*, never a write. Truncate the logged argv to a fixed length regardless.

---

### [SH-07] `parseDeepLink` throws on malformed percent-encoding

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `src/shared/deep-link.ts:99-102`

```ts
const segments = url.pathname.split('/').flatMap((s) => {
	const trimmed = decodeURIComponent(s).trim();
	return trimmed ? [trimmed] : [];
});
```

**What.** `decodeURIComponent` throws `URIError: URI malformed` on an invalid escape. The function's
whole contract is "unsafe segments … return `{ kind: 'invalid', reason }`", and this path escapes
it. Verified directly: `new URL('ensemblr://repo/%').pathname === '/%'`, and `decodeURIComponent('%')`
throws.

**Scenario.** Today: none — the function has no consumer. The day SH-06 wires it into an `open-url`
or argv handler, `ensemblr://repo/%` from any web page becomes an uncaught exception in the main
process.

**Existing guards & tests checked.** `tests/main/deep-link-parse.test.ts` covers traversal, query
smuggling and embedded protocols, but not malformed percent-encoding — the one case the parser
does not handle.

**Fix.** Wrap the decode and return `{ kind: 'invalid', reason: 'malformed-escape' }`. Add the
case to the existing test file. Cheap to fix now, and doing it before the handler exists is what
keeps it from shipping as a crash.

---

### [SH-08] `plugins: true` exposes PDFium to untrusted repository content

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `src/main/app/main-window.ts:57-60`, consumed at `src/renderer/components/workbench-shell/conversation-panel/file-preview-body.tsx:61-70`

```ts
// Chromium's built-in PDF viewer is a plugin, and Electron ships plugins
// off; without this the file preview's PDF frame renders empty. It is the
// only plugin modern Chromium still carries, so this grants nothing else.
plugins: true,
```

**What.** The comment's claim is accurate — PDFium is the only remaining plugin — but enabling it
routes any PDF in an opened repository through a large C++ parser. The trust boundary
`SECURITY.md` draws is "the repository you opened," and an opened repository is not necessarily
one whose *binary assets* were reviewed.

**Scenario.** A crafted PDF in a cloned repository → user clicks it in the file preview →
`usePdfObjectUrl` builds a blob and `<embed>` hands it to PDFium. A PDFium memory-safety bug would
then need a further Chromium sandbox escape to matter, which is why this stays Low.

**Existing guards & tests checked.** The preview path is clean in the ways that matter: the PDF is
a `blob:` URL built in the renderer (`use-pdf-object-url.ts:34-37`), never a `file://` URL, and the
hook revokes it on unmount. Images go through `imageSource` (a data URL), not the filesystem. This
is the correct shape.

**Fix.** Nothing urgent. The mitigation that actually reduces exposure is keeping Electron current
(SH-01), since PDFium fixes arrive in the same patch releases. If the exposure is judged not worth
the feature, the alternative is bundling `pdf.js` — a Wasm/JS parser inside the renderer sandbox —
and dropping `plugins: true`; that is a product call, not a security requirement.

---

### [SH-09] Chromium's spellchecker is left on and fetches dictionaries from Google's CDN

- **Severity:** Low
- **Confidence:** Likely
- **Where:** `src/main/app/main-window.ts:54-62` (no `spellcheck` key — Electron defaults it to `true`), used by `src/main/app/text-context-menu-forwarding.ts:44`

**What.** Electron's spellchecker downloads Hunspell dictionaries from a Google-hosted CDN on first
use, per locale, unless `session.setSpellCheckerDictionaryDownloadURL` redirects it. Nothing in
`src/main` calls that method. For a local-first desktop tool that stores no telemetry, an
unannounced request to a Google endpoint on first right-click in the composer is a privacy
surprise rather than a vulnerability.

**Scenario.** User types in the composer → Chromium fetches `…/chrome/dict/<locale>.bdic`, which
discloses the app's presence and the user's locale/IP to a third party the user did not opt into.
Marked **Likely** rather than Confirmed because I did not run the packaged app to observe the
request (out of scope for this audit) — the mechanism is Electron's documented default, not
something this repo configures.

**Existing guards & tests checked.** No `setSpellCheckerDictionaryDownloadURL`, no
`setSpellCheckerLanguages`, no `spellcheck: false`. The feature is genuinely used — the renderer
draws its own context menu from Chromium's verdict (`text-context-menu.tsx:85-89`), so turning the
spellchecker off would remove a shipped feature.

**Fix.** Document it (a line in the privacy/security docs and the Settings surface), or host the
`.bdic` files alongside the app and point `setSpellCheckerDictionaryDownloadURL` at them, or ship
them as an `extraResource` and use the offline path. Given the app already ships three locale
catalogues, bundling three dictionaries is proportionate.

---

### [SH-10] The Linear OAuth launcher bypasses the external-URL scheme allowlist

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `src/main/main.ts:1402-1403`

```ts
/** Opens an external URL in the user's default browser. */
openExternal: (url) => shell.openExternal(url),
```

**What.** This is the one `shell.openExternal` in the tree that does not pass through
`parseAllowedExternalUrl`. The single call site (`src/main/linear/linear-auth-service.ts:713-722`)
passes `buildLinearAuthorizeUrl(...)`, built from the hardcoded
`LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize'` (`src/main/linear/linear-oauth.ts:4`),
so there is no exploitable input today.

**Scenario.** None currently. It becomes one the day the authorize base URL is made configurable
(an enterprise/self-hosted Linear option is the obvious future request), at which point a
`config.json` value reaches `shell.openExternal` with no scheme check, and `shell.openExternal` of
a custom scheme launches whatever application registered it.

**Existing guards & tests checked.** Every other `shell.openExternal` is behind the policy
(`external-links.ts:26`). The `shell.openPath` calls in `src/main/config/open-in-editor.ts:36` and
`src/main/open-target/open-target-service.ts:494` are a different surface the open-target sibling
covers.

**Fix.** One-line change: `openExternal: openExternalUrl` — the vetted helper already accepts
`unknown`, logs a refusal, and never throws.

---

### [SH-11] Startup does synchronous database migration, config load and filesystem reconciliation before the window is created

- **Severity:** Low (performance)
- **Confidence:** Confirmed
- **Where:** `src/main/main.ts:1763-1911`

```ts
app.whenReady().then(() => {
	if (!hasSingleInstanceLock) return;
	allowPlainTextSecretFallback();
	configService.load();
	databaseService.open();          // opens SQLite + runs every pending migration
	registerLinearAssetProtocol(linearAssetProxy);
	ensureConciergeHome(rootDirectoryService.ensure().conciergePath);  // mkdirSync
	conciergeMemoryService.reconcile();
	…
	terminalService.recoverStaleSessions();
	updateService.start();
	openMainWindow();                // line 1910 — the window is constructed last
});
```

**What.** `openMainWindow()` is the final statement of a ~150-line `whenReady` body. Everything
before it — config parse, SQLite open plus the full migration ladder, `mkdirSync` for the concierge
home, concierge-memory reconciliation, the whole IPC handler graph, stale-terminal recovery —
runs on the main thread before a `BrowserWindow` object exists. The window uses `show: false` +
`ready-to-show` correctly (`main-window.ts:48,95-102`), which is the right pattern, but that only
avoids a white flash; it does not overlap any of this work with renderer boot, because the renderer
has not been asked to start yet.

**Scenario.** A user on a large install (many workspaces, a migration pending after an update)
sees nothing at all — no window, no Dock bounce beyond the launch tile — for the duration. The two
async calls already present (`void sharedRootAdoptionService.reconcile()`,
`void reclaimSweptWorkspaceDisk()`) show the pattern is understood; the blocking ones simply
predate it.

**Existing guards & tests checked.** The ordering constraints are real and documented: `setPath`
must precede `ready` (`main.ts:275-295`), the scheme must be declared before `ready`
(`main.ts:1393-1395`), and `updateService.start()` must sit behind the single-instance guard
(`main.ts:1905-1908`). None of those forces `openMainWindow()` to be last.

**Fix.** Move `openMainWindow()` up to immediately after `databaseService.open()` and
`registerLinearAssetProtocol()` — the two things the first renderer paint genuinely depends on —
and let the renderer's own module evaluation and first paint overlap with the handler-graph
construction. `ensureConciergeHome`, `conciergeMemoryService.reconcile()` and
`terminalService.recoverStaleSessions()` are not on the first-paint path; the first two can move
behind `ready-to-show`. Measure first: `console.time` around each step in a dev build will say
whether SQLite migration or the handler graph dominates, and that determines whether this is worth
doing at all. I did not measure (starting the app is out of scope for this audit), which is why
this is Low and framed as an ordering observation rather than a claimed win.

---

### [SH-12] Four High advisories in the dev tree, all one root cause, build-time only

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `@electron-forge/maker-dmg` → `electron-installer-dmg` → `appdmg` → `image-size`

```
$ npm audit --omit=dev --json | jq .metadata.vulnerabilities
{ "info":0, "low":0, "moderate":0, "high":0, "critical":0, "total":0 }

$ npm audit --json   # dev tree included
high  @electron-forge/maker-dmg   direct=true   fixAvailable=false
high  appdmg                      via image-size
high  electron-installer-dmg      via appdmg
high  image-size                  GHSA-w3rx-r6r6-pgpr (CWE-835, CVSS 7.5)
```

**What.** `GHSA-w3rx-r6r6-pgpr` is an infinite loop in `image-size`'s ICNS parser. In this repo the
only ICNS file it ever parses is `assets/icon.icns`, generated by `npm run icon:generate` from
`assets/icon.svg` in the same repository. `fixAvailable: false` — the fix has to come from
`appdmg`, which is effectively unmaintained.

**Scenario.** A denial of service during `npm run make` on a file the repo produces itself. Not
reachable by an attacker.

**Existing guards & tests checked.** The prod tree is clean (0 of every severity across 546
production dependencies). `overrides` already demonstrates the escape hatch the project uses when
a transitive dep is abandoned — `extract-zip` is aliased to `@electron-internal/extract-zip`
precisely to route around an unmaintained package with an advisory.

**Fix.** Accept, and record the acceptance so the recurring `npm audit` noise does not mask a real
finding later. If the noise is unwelcome, an `overrides` entry pinning `image-size` to a fixed
release is the same move already made for `extract-zip` — worth checking whether a patched
`image-size` satisfies `appdmg`'s range.

---

### [SH-13] Informational: hardening items that are correct by default rather than by declaration

- **Severity:** Info
- **Confidence:** Confirmed

Four things are safe today because of a default, not because the repo states them. Each is a
one-line change that converts an implicit guarantee into an explicit, reviewable one.

- **`sandbox`** is not set in `src/main/app/main-window.ts:54-62`. It is `true` today because
  Electron ≥20 defaults it on when `nodeIntegration` is off, and the preload imports only
  `electron`. Writing `sandbox: true` costs nothing and makes the property survive a future
  preload change that reaches for `node:fs`.
- **`webviewTag`** relies on the same kind of default (see SH-05).
- **`--remote-debugging-port`** is a Chromium switch and is *not* covered by any fuse —
  `EnableNodeCliInspectArguments: false` only blocks `--inspect*`. A local attacker who can alter
  a `.desktop` file or a Dock shortcut could add it and attach to the DevTools protocol. That
  requires local code execution as the user, which `SECURITY.md` puts out of scope, so it is noted
  rather than filed. There is no supported way to disable it short of an argv scan in `main.ts`
  before `ready`.
- **macOS never registers `ensemblr://`** — no `CFBundleURLTypes` in `packagerConfig.extendInfo`
  (`forge.config.ts:271-274`) and no `app.setAsDefaultProtocolClient` call. Linux does (SH-06), so
  the two platforms disagree about whether the scheme exists. Worth resolving in whichever
  direction the deep-link feature actually goes.

---

## Dependency audit

**Advisory counts.**

| Tree | info | low | moderate | high | critical |
| --- | --- | --- | --- | --- | --- |
| `npm audit` (all, 1490 deps) | 0 | 0 | 0 | **4** | 0 |
| `npm audit --omit=dev` (546 prod deps) | 0 | 0 | 0 | **0** | 0 |

All four Highs are the single `image-size` ICNS chain behind `@electron-forge/maker-dmg` — see
SH-12. Not a runtime dependency; not reachable by an attacker.

**Lockfile integrity.** `lockfileVersion: 3`. 620 packages carry a `resolved` URL; **620 of 620
carry an `integrity` hash**, and **every one resolves to `https://registry.npmjs.org/`**. Zero
`link:`, zero `file:`, zero `git+`, zero `http:` specifiers in `dependencies` or `devDependencies`.
This is as clean as a lockfile gets.

**`overrides` currency** (`package.json`):

| Override | Value | Assessment |
| --- | --- | --- |
| `extract-zip` | `npm:@electron-internal/extract-zip@^1.0.5` | Correct and load-bearing — routes around GHSA-jmr9-qjv8-65gv in the abandoned `extract-zip@2.0.1` that Forge 7 reaches through `@electron/packager@18`. Documented in `.claude/rules/stack.md`. Drop when Forge 8 ships. |
| `tar` | `^7.5.19` | Current major; ahead of the ranges transitives ask for. |
| `tmp` | `^0.2.7` | Past the `0.2.3` arbitrary-file-write advisory. |
| `linkify-it` | `^5.0.2` | Current. |
| `@electron/node-gyp` | `10.2.0-electron.1` | Electron's own fork pin, required for native rebuild. |
| `shiki` | `$shiki` | Deduplication against the direct dependency, not a security pin. |

**Repo scripts.** `preinstall` → `node scripts/require-node-version.mjs --stage=install` (a version
gate, no network, no writes). `postinstall` → `node scripts/fix-node-pty-permissions.mjs`, which
does exactly one thing: `chmodSync(…, 0o755)` over `node_modules/node-pty/prebuilds/*/spawn-helper`.
Neither downloads anything. There is no `prepare`/`prepack`. Clean.

**Runtime fetching.** `@iconify/react` is fed offline collections only —
`src/renderer/lib/workbench/icon-collections.ts:1-21` imports `@iconify-json/logos` and
`@iconify-json/vscode-icons` as modules and calls `addCollection`. No `fetch`, no API host, no
`iconify.design` reference anywhere in the tree. Confirmed sound.

**The unbundled runtime path.** Two packages are `external` in `vite.main.config.mts:18-27` and
therefore loaded from `node_modules` at runtime: `node-pty` (native) and
`@anthropic-ai/claude-agent-sdk`. Both are inside `app.asar` via `PACKAGE_KEEP_*`
(`forge.config.ts:46-57`), which means `EnableEmbeddedAsarIntegrityValidation: true` **does** cover
them — the fuse validates the asar's header hash against the one embedded in the signed binary, and
these files are archive members rather than external resources. `node-pty`'s `.node` binary and its
`spawn-helper` are the exception: `AutoUnpackNativesPlugin` and the `asar.unpack` glob
(`forge.config.ts:257-259`) move them to `app.asar.unpacked`, which the integrity fuse does **not**
cover. On macOS the hardened runtime's code signature covers them instead; on Linux (AppImage, no
signing) nothing does. That is inherent to shipping a native module, not a defect, but it is the
one file in the bundle with no integrity check on Linux.

`@anthropic-ai/claude-agent-sdk` is pinned at `^0.3.259` (lock: 0.3.259) against an upstream
0.3.269 — ten patches behind, no advisory. Its per-platform `claude-agent-sdk-<platform>` packages
are deliberately excluded, so the ~260 MB vendored `claude` binary never ships; the user's own CLI
is used. That is the right call and it removes a large opaque binary from the supply chain.

**`resources/pi-extensions/package.json`.** Declares `typebox@^0.34.0` and
`@earendil-works/pi-coding-agent@^0.79.1` with **no lockfile**, and the directory ships via
`extraResource` (`forge.config.ts:279-284`). This is not a live supply-chain path: no
`node_modules` is created there, nothing in the build installs it, and
`src/main/agent-control/main-integration.ts:125-128` documents that Pi's own extension loader
supplies both modules through jiti aliases. The `package.json` exists for local typechecking. The
only cost is that an SBOM scanner reading the packaged bundle will report two unpinned
dependencies that are not actually resolved from there — worth a comment in the file.

**`skills-lock.json`.** Two entries (`fallow`, `shadcn`), each with a `computedHash` over the
fetched `SKILL.md`. These are agent-authoring skills, not app code — nothing in `src/` reads them
and they do not ship in the bundle.

**Toolchain pins.** `.nvmrc` = `24`, `mise.toml` = `node = "24"`, `engines` = `>=24 <25`,
`packageManager` = `npm@11.17.0` — all agreeing, enforced at `preinstall` and at
`build`/`package`/`make` by `scripts/require-node-version.mjs`. `.npmrc` sets
`legacy-peer-deps=true` for one documented reason (the stale `@electron-forge/plugin-fuses@7` peer
range); it relaxes peer *resolution*, not integrity checking, so it has no supply-chain effect.

**CI install.** `.github/actions/install-dependencies/action.yml` uses
`npm ci --prefer-offline --no-audit --no-fund` against `node-version-file: .nvmrc`. `npm ci`
installs the lockfile exactly and fails on any drift — the correct choice. `--no-audit` only skips
a report; it does not skip integrity verification.

**Dependabot.** `.github/dependabot.yml` covers npm weekly (limit 5, dev-deps grouped) and
github-actions weekly, with one documented ignore (`@types/node` majors, mirroring the embedded
Node). Sound. The gap is SH-01: Electron sits inside the `dev-dependencies` group, where a
security-relevant patch bump is easy to defer alongside four cosmetic ones.

---

## Verified sound

- **Renderer sandbox is real.** `src/main/app/main-window.ts:55-56` plus a preload whose only
  imports are `electron` and type-only shared modules (`src/preload/preload.ts:1-4`,
  `src/preload/bridge/ensemblr-api.ts:1`) — nothing requires `sandbox: false`.
- **Session permissions are allowlisted in both directions.**
  `src/main/app/media-permissions.ts:20-40` installs request *and* check handlers over one pure
  policy (`media-permissions-policy.ts:43-59`), so they cannot disagree. Audio-only `media`;
  a request naming video is refused whole rather than downgraded.
- **Window-open is denied unconditionally.** `src/main/app/external-links.ts:52-55`.
- **The renderer-reachable `openExternal` is scheme-limited.**
  `src/main/ipc/handlers/window.ts:19-20` → `openExternalUrl` (`external-links.ts:13-30`) →
  `parseAllowedExternalUrl` (`external-links-policy.ts:8,25-31`). Non-string input, unparseable
  input, and every non-http(s) scheme are refused and logged. This is the correct shape for the
  classic Electron `openExternal` vector.
- **`second-instance` never interprets argv.** `src/main/main.ts:2050-2066` reads it only for a
  diagnostic log; the handler restores and focuses an existing window or opens a new one.
- **TLS validation is untouched.** No `certificate-error` handler, no `setCertificateVerifyProc`,
  no `ignore-certificate-errors`, no `app.commandLine.appendSwitch` anywhere in `src/`.
- **The Linear custom scheme takes minimal privileges.**
  `src/main/linear/linear-asset-protocol.ts:18-23` — `secure`/`standard`/`supportFetchAPI` only,
  explicitly not `bypassCSP` and not `allowServiceWorkers`, with the reasoning in the JSDoc.
- **The PDF and image preview never touch `file://`.**
  `src/renderer/hooks/workbench-shell/conversation-panel/use-pdf-object-url.ts:34-40` builds a
  `blob:` URL and revokes it on unmount; `file-preview-body.tsx:61-89` renders that blob and a data
  URL for images. Bytes arrive over IPC, not over a renderer-issued filesystem read.
- **No renderer env leakage and no prod source maps.** The only `import.meta.env` uses are
  `import.meta.env.DEV` guards (`src/renderer/main.tsx:27`,
  `src/renderer/routing/routes/debug.pi-replay.tsx:12`,
  `src/renderer/lib/instrumentation/profiler-store.ts:24`), which are compile-time constants
  stripped from the packaged bundle. No `process.env` in `src/renderer`. `vite.renderer.config.mts`
  sets no `define` and no `build.sourcemap`; `vite.main.config.mts:11-15` defines exactly one
  constant, the build channel.
- **Window presentation avoids the white flash correctly.** `show: false` +
  `once('ready-to-show')` (`src/main/app/main-window.ts:48,95-102`), with `backgroundColor` set and
  kept in sync with the OS theme (`nativeTheme.on('updated', refreshWindowBackgrounds)`,
  `main.ts:1810`). Wayland's positioning restriction is handled rather than branched around
  (`forbidsWindowPositioning`, `main-window.ts:51-53`).
- **Linux plaintext secret fallback is conditional, not unconditional.**
  `src/main/main.ts:1745-1761` calls `safeStorage.setUsePlainTextEncryption(true)` on Linux only;
  per `node_modules/electron/electron.d.ts:12057-12060` that forces an in-memory password **only
  when no OS password manager can be determined**, so a host with gnome-keyring or KWallet still
  gets real encryption. The code comment is accurate and the `secret-storage` setup check surfaces
  the degraded case.
- **Single-instance lock is acquired after the userData pin** (`main.ts:295,308`), so it keys on
  the right directory, and the losing instance `app.exit(0)`s before any shared state is touched.
  No `additionalData` is passed, so there is no untrusted payload to validate.

---

## Coverage

Read in full: all 16 files in `src/main/app/`, `src/shared/deep-link.ts`, `src/shared/window-chrome.ts`
(via `src/main/app/window-chrome.ts`), `src/main/linear/linear-asset-protocol.ts`, `forge.config.ts`,
all four `vite.*.config.mts`, `index.html`, `src/renderer/main.tsx`, the PDF/image preview pair,
`scripts/rebuild-native-linux.sh`, `scripts/fix-node-pty-permissions.mjs`, `.npmrc`, `.nvmrc`,
`mise.toml`, `.github/dependabot.yml`, `.github/actions/install-dependencies/action.yml`,
`resources/pi-extensions/package.json`, `skills-lock.json`, `SECURITY.md`.

Read in part: `src/main/main.ts` (lifecycle regions — `setPath`/single-instance at 260-330, module
scope 1380-1420, `whenReady` 1763-1912, quit/activate/second-instance 2007-2066), plus targeted
greps across the whole file for every hardening-relevant API.

Grepped exhaustively across `src/`: `sandbox`, `nodeIntegration`, `webSecurity`,
`allowRunningInsecureContent`, `experimentalFeatures`, `enableBlinkFeatures`, `webviewTag`,
`openDevTools`, `commandLine`, `certificate-error`, `setCertificateVerifyProc`,
`registerSchemesAsPrivileged`, `protocol.handle`, `onHeadersReceived`, `Content-Security-Policy`,
`setSpellChecker*`, `setDevicePermissionHandler`, `setBluetoothPairingHandler`, `shell.open*`,
`<iframe>`/`<embed>`/`<object>`/`<webview>`, `file://`, `createObjectURL`,
`dangerouslySetInnerHTML`, `import.meta.env`, `process.env`.

Commands run (read-only): `npm audit --json`, `npm audit --omit=dev --json`, `npm view electron
dist-tags`, `npm view @anthropic-ai/claude-agent-sdk version`, and a Node one-liner over
`package-lock.json` counting integrity hashes and non-registry resolutions.

**Not covered** (deliberately, per the brief): renderer XSS surfaces, the updater and code signing,
IPC handler validation, the agent-control server's auth, the Linear asset proxy's fetch behaviour,
`shell.openPath` in the open-target registry, and the release workflow's secret handling. Each has
a sibling. The app was not started and no test suite was run.

## Open questions

1. **Does `GrantFileProtocolExtraPrivileges: false` break the packaged renderer?** (SH-03) The
   bundle loads its assets as relative subresources, which the fuse should not govern, but
   Electron's guidance hedges for apps served from `file://`. This needs one `npm run make` on
   macOS and one on Linux to settle, and I did not build.
2. **Is `safeStorage.setUsePlainTextEncryption` valid after `ready`?** It is called as the first
   statement inside `app.whenReady().then(...)` (`src/main/main.ts:1770`). Electron's typings do not
   state an ordering constraint and the Linux target evidently boots, so this is probably fine —
   but some Electron versions have required it before `ready`, and if it ever throws there the
   whole `whenReady` body dies and no window appears. Worth a Linux dogfood confirmation.
3. **Should the deep-link feature be finished or withdrawn?** (SH-06, SH-07) Right now the parser
   is dead code, Linux advertises a handler that does not exist, and macOS advertises nothing.
   Three states, none of them the intended one. The security answer is the same either way — a
   deep link must only ever navigate — but which direction to go is a product call.
4. **Is the Linux `node-pty` autobuild meant to run for release builds?** (SH-04) Pinning the image
   by digest fixes provenance either way, but if `make:linux` should never silently pull, the
   opt-in gate is the cleaner change and I do not know the intent.
