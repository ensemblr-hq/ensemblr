# 08 — Repository config, environment layering, scripts, terminal, setup, settings publication

Audit date 2026-09-12, branch `psoldunov/security-and-performance-audit`, read-only.

The headline is not a repository-config capability — it is that the workspace permission mode
never reaches a gate. `security.permissionMode` is written at **repository** scope by the only UI
that sets it, and every enforcement point resolves the **app** scope, so `read-only` and
`approval-required` are inert while the Security screen displays them as active (CFG-01,
Critical, demonstrated). Second: a committed symlink at `.ensemblr/settings.toml.tmp` makes the
Scripts-settings writer overwrite an arbitrary file outside the repository with repo-authored
content (CFG-02, High, demonstrated) — the sibling publication writer already defends against
exactly this and the scripts writer does not.

The env-hijack vectors the brief anticipated do **not** exist, for an unexpected reason: repo
`environment_variables` and `*_executable_path` are parsed, schema-validated and documented, but
consumed by nothing (CFG-05). The app's own `git`/`gh` calls run on a cached login-shell env that
no repository layer touches. `settings-publication-*` is the best-hardened code in this scope and
is used as the reference fix throughout.

---

## Repository config capability table

Every key `.ensemblr/settings.toml` accepts, from `TOML_FIELD_MAP` / `GIT_FIELD_MAP` /
`PROMPT_FIELD_MAP` / `SCRIPT_FIELD_MAP` in `src/main/config/repository-config.ts:46-115` and
`schemas/settings.schema.json`. Writers: **repo author** = untrusted (committed file); **Scripts
pane** = `updateRepositoryScripts` IPC; **Infisical pane** = `infisical-repository-config.ts`.
Agents cannot write any of it through a control op — there is no settings-write port.

| Key | Writable by | Controls | Script? | Validation | Verdict |
| --- | --- | --- | --- | --- | --- |
| `scripts.setup` / `.archive` | repo author, Scripts pane | shell command run on workspace create / archive | **yes** | string type only | Out of scope per SECURITY.md |
| `scripts.run.<name>.command` | repo author, Scripts pane | shell command behind the Run button | **yes** | string; name used as a map key only, never a path (`run-scripts.ts:186-218`) | Out of scope |
| `scripts.run.<name>.icon` | repo author | dock icon | no | allowlist of 55 names (`run-scripts.ts:118`) | Sound |
| `scripts.run.<name>.available_in` | repo author | whether the script is offered locally | no | string array; `local` membership | Sound |
| `scripts.run_mode`, `.auto_run_after_setup` | repo author, Scripts pane | serialize sibling workspaces; chain run after setup | no | type-checked (`repository-config.ts:365-377`) | Sound (auto-run only chains an already-in-scope script) |
| `environment_variables` | repo author | **documented** as env for terminals and scripts | no | object type only | **CFG-05 — no consumer exists** |
| `{claude,pi,codex,gemini,opencode,amp,copilot}_executable_path` | repo author | **would** point the app at a binary | no | string type only | **CFG-05 — resolver reads app scope only (`claude-executable.ts:218-226`), never repository scope** |
| `prompts.*` (15 spellings → 6 keys) | repo author | text appended to the agent prompt for Review / Create PR / Fix errors / Resolve conflicts / Branch rename / general | no | string type only, **no length cap** | **CFG-04 — presented to the agent as the *user's* overriding preference** |
| `git.branch_from`, `.branch_prefix`, `.remote_origin` | repo author | base branch, branch prefix, push remote | no | string type | In scope of auditor 05 (git arg handling); no path use here |
| `git.delete_local_branch_on_archive`, `.archive_after_merge`, `.set_upstream_on_push` | repo author | archive/push behaviour | no | boolean type | Sound |
| `infisical.site_url` | repo author, Infisical pane | Infisical instance URL | no | string; **credential only sent when an exact user-registered account matches** (`infisical-account-match.ts:114-124`) | Sound — cannot redirect a token to an attacker host |
| `infisical.project_id`, `.environment`, `.path`, `.recursive`, `.project_name` | repo author, Infisical pane | which secrets are pulled | no | string/boolean | Deferred to auditor 06 |
| `file_include_globs` | repo author | gitignored files copied into a new workspace | no | string array; enumerated by `git ls-files --others --ignored --exclude-from=<tmpfile>` (`files-to-copy.ts:172-183`) | Sound — git cannot return a path outside the worktree, and patterns go in a file not argv |
| `enterprise_data_privacy` | repo author | provider privacy flag | no | boolean | Not audited here |
| `spotlight_testing` | repo author | object, passed through | no | object type only | No consumer found; same class as CFG-05 |
| **`security.permissionMode`** | **not accepted** — no field-map entry | — | — | — | A committed config **cannot** set it, contradicting the UI copy (CFG-07) |

Unknown top-level keys are dropped with a `warning` diagnostic (`repository-config.ts:320-327`),
so the loader is allowlist-shaped. `__proto__` / `constructor` are not in any field map and every
merge uses object spread with a mapped key or a `Map`, so there is no pollution sink.

---

## Findings

### [CFG-01] The per-repository permission mode is written at a scope no gate reads

- **Severity:** Critical
- **Confidence:** Confirmed (reproduced against the real resolver)
- **Where:** `src/main/environment/repository-settings.ts:71-76` (write) vs
  `src/main/ipc/permission-gate.ts:109` and `src/main/main.ts:961-962` (read)

```ts
// repository-settings.ts:32,71-76 — written at repository scope
const scope: NormalizedScope = { scope: 'repository', scopeId: repositoryId };
setStringSetting({ database, key: 'security.permissionMode', scope, value: settings.permissionMode });

// permission-gate.ts:109-111 — read from the APP scope
const setting = snapshot.app.settings.find((entry) => entry.key === 'security.permissionMode');

// main.ts:961-962 — resolve() called with no repository, so only the app scope exists
resolvePermissionMode: () => readPermissionModeFromSnapshot(settingsResolutionService.resolve()),
```

**What.** `collectSqliteSettings` filters on `WHERE scope = ? AND scope_id = ?`
(`config-resolution.ts:935-942`), and the app scope is queried with `scopeId` `''`
(`config-resolution.ts:180`). The row `upsertRepositorySettings` writes carries
`scope='repository', scope_id=<repositoryId>` and is therefore never a candidate for the app
scope. All three enforcement points — the renderer IPC gate (`ipc/handlers.ts:268-271`), the
agent-control op gate (`main.ts:1544-1545`), and the agent-session mode (`main.ts:961-962`) —
call `resolve()` with no argument. There is no app-scope Security UI: the only route is
`settings/repo/$repoId/security.tsx`, whose `save()` goes to `upsertRepositorySettings`. The
same screen *displays* the repository-scope value (`security.tsx:27`), so the UI reports a mode
nothing enforces.

**Scenario.** User → Settings → Repo → Security → `Read only`. The row is stored, the row is
displayed as selected, and `classifyPermissionAction` is never asked about it. Every agent
session opens under `workspace-trusted` (the built-in default at
`config-resolution.ts:515`), and every gated IPC channel and control op is allowed. A bypass of
the workspace permission mode is named in scope by `SECURITY.md`; here the mode never engages at
all, and the UI is what conceals it.

Reproduced with the real `resolveSettings` + `readPermissionModeFromSnapshot` against an
in-memory SQLite carrying one `('repository','repo-1','security.permissionMode','"read-only"')`
row:

```
gate sees: workspace-trusted
UI shows:  read-only
```

**Existing guards & tests checked.** `tests/main/config-resolution.test.ts` covers precedence
within a scope and `getInvalidPermissionModeReason`; `tests/main/permissions.test.ts` covers
`classifyPermissionAction` in isolation. Nothing asserts that the mode the Security screen writes
is the mode a gate reads — the two halves are each correct and are never tested end to end.
`~/.config/ensemblr/config.json` `{"security":{"permissionMode":...}}` *does* reach the app scope
(`config-resolution.ts:811`), so a hand-edited config works; the UI does not.

**Fix.** Decide which scope owns the mode and make both ends agree. The per-repository intent in
`SECURITY.md` and in the UI copy argues for repository scope: thread the active workspace's
repository into the three `resolve()` calls and read `snapshot.repository` with an app-scope
fallback, so a repo with no override still inherits the global default. Whichever way it lands,
add a test that writes through `upsertRepositorySettings` and asserts the gate's `getMode()`
changes — the bug lives precisely in the seam neither existing test spans.

---

### [CFG-02] A committed symlink at `settings.toml.tmp` makes the Scripts writer overwrite any file

- **Severity:** High
- **Confidence:** Confirmed (reproduced against the real writer)
- **Where:** `src/main/config/repository-settings-writer.ts:150-164`

```ts
function writeTomlFile(configPath, record, schemaDirective): void {
	const temporaryPath = `${configPath}.tmp`;      // predictable, attacker-plantable
	const document = dump(record);
	const serialized = schemaDirective ? `${schemaDirective}\n\n${document}` : document;
	mkdirSync(path.dirname(configPath), { recursive: true });
	writeFileSync(temporaryPath, serialized, 'utf8');   // follows a symlink at that path
	renameSync(temporaryPath, configPath);
}
```

**What.** The temp path is a fixed suffix inside the repository checkout, written with plain
`writeFileSync` — no `O_EXCL`, no `lstat`. A repository that commits `.ensemblr/settings.toml.tmp`
as a symlink gets that link followed: the serialized TOML lands on the link's target, and the
subsequent `renameSync` moves the *symlink itself* onto `settings.toml`, so the repository is left
permanently aliased and every later save writes there too — and the loader now *reads* the
target file as the repo config.

The written content is attacker-controlled, not just attacker-triggered:
`rewriteRepositorySettings` passes the parsed committed record through and only replaces the
`scripts` table (`repository-scripts-writer.ts:63-67`), so every other top-level table in the
committed `settings.toml` round-trips verbatim into the victim file. A committed
`[core]\nsshCommand = "..."` plus a symlink to `~/.gitconfig` is valid git config on arrival.

**Scenario.** Repository author commits two files → user opens the repo and saves anything in
Settings → Repo → Scripts (or links Infisical, same writer) → the target file is overwritten.
Reproduced verbatim:

```
result: {"ok":true,"path":"<repo>/.ensemblr/settings.toml"}
--- victim file now: ---
[scripts]
setup = "echo hello"
--- repo dir: ---
settings.toml -> /tmp/…/victim/authorized_keys
```

`outside-workspace-write` is an explicit `PermissionActionKind` classified
`confirmation-required` in *every* mode (`src/shared/permissions.ts:63,152-160`). This path never
reaches the classifier, so the confirmation the model promises is not asked.

**Existing guards & tests checked.** The sibling writer for the same file already defends against
this and says so: `settings-publication-files.ts:419-434` `validateSettingsPath` `lstat`s the
root, `.ensemblr/`, and the file, refusing a symlink at any of the three; its temp path is
`${filePath}.${pid}.${randomUUID()}.tmp` opened `openSync(…, 'wx', 0o600)`
(`settings-publication-files.ts:319-320`), which fails outright on an existing symlink. None of
that is applied in `repository-settings-writer.ts`. `ensureRepositoryConfigFile`
(`repository-config-file.ts:45-48`) has the same gap with fixed content.
`tests/main/repository-config-file.test.ts` does not cover symlinks.

**Fix.** Reuse the publication writer's two mechanics here: `lstat`-refuse a symlinked root,
`.ensemblr/`, `settings.toml`, or `settings.toml.tmp`, and open the temp file with a
randomized name and the `wx` flag at mode `0600`. Best done by lifting
`validateSettingsPath` + the `wx` open into one shared module both writers call, so the
guarantee cannot drift again.

---

### [CFG-03] `restoredFromId` reaches `rmSync` through a traversal-capable path builder

- **Severity:** High
- **Confidence:** Confirmed (path resolution reproduced; chain read end to end)
- **Where:** `src/main/config/context-directory.ts:29-36` (the sink),
  `src/main/ipc/handlers/terminal.ts:42` (the source),
  `src/main/terminal/terminal-output-file.ts:31,133-135`

```ts
// context-directory.ts:33-35 — new URL() collapses ".." before fileURLToPath
const relative = [CONTEXT_DIRECTORY, ...segments].join('/');
return fileURLToPath(new URL(relative, directoryUrl(worktreePath)));

// terminal-output-file.ts:133-135
rmSync(terminalOutputPath(worktreePath, terminalId), { force: true });
```

**What.** `createTerminalSession` takes `restoredFromId` as an opaque renderer string
(`handlers/terminal.ts:42`; the terminal channel family has no `request-schemas/` module) and it
flows to `discardRestoredLog` → `deleteTerminalOutput` → `terminalOutputPath` →
`resolveContextPath`, which resolves `..` segments rather than rejecting them. Measured:

```
"normal.log"              -> /Users/me/wt/.context/normal.log
"../../../etc/passwd.log" -> /Users/etc/passwd.log
"a/../../../x"            -> /Users/me/x
```

Delete-only in practice: `writeTerminalOutput` is only ever handed `session.snapshot.id`, a
`randomUUID` (`terminal-service.ts:1468`), and `readTerminalOutput` is only reached with
`row.id` from SQLite (`terminal-service.ts:1777`). `rmSync` without `recursive` throws `EISDIR`
on a directory and the `catch {}` swallows it, so the primitive is bounded to unlinking any
`*.log` file the user can write, anywhere on disk.

**Existing guards & tests checked.** The archive-side writer has exactly the right guard, with a
comment naming this risk: `terminal-output-file.ts:85-87`,
`if (path.basename(capture.id) !== capture.id) return …`, covered by
`tests/main/terminal-output-file.test.ts:105`. It was never applied to the three live-worktree
entry points that share `terminalOutputPath`. `tests/main/terminal-service.test.ts:1384`
exercises `restoredFromId` only with a legitimate id.

**Fix.** Put the `path.basename(id) !== id` refusal inside `terminalOutputPath` so read, write and
delete inherit it, rather than asking each caller to remember. Separately, make
`resolveContextPath` refuse a segment containing a path separator or `..` — it is a shared
primitive and the next caller will make the same assumption. Adding
`src/main/ipc/request-schemas/terminal.ts` closes the class structurally.

---

### [CFG-04] A repository's committed `[prompts]` text is fed to the agent as the *user's* overriding instruction

- **Severity:** Medium
- **Confidence:** Confirmed
- **Where:** `src/shared/prompt-scaffolding.ts:40-41`,
  `src/renderer/lib/workbench/action-prompts.ts:341-345`,
  `src/renderer/lib/workbench/action-preference.ts:13-22`

```ts
// prompt-scaffolding.ts:40-41
export const USER_PREF_ADDON =
	"IMPORTANT: The following are the user's custom preferences. These preferences take precedence over any default guidelines or instructions above. When there is a conflict, always follow the user's preferences.";

// action-prompts.ts:340-345 — the clamp covers the base prompt, not the preferences
const bounded = clampReviewContext(contextSections.join('\n\n'));
return `${bounded}\n\n${USER_PREF_ADDON}\n\n${trimmedPreferences}`;
```

**What.** `sharedActionPreference` reads `actionPreferences.<key>` out of the resolved
**repository** snapshot, which `PROMPT_FIELD_MAP` (`repository-config.ts:100-115`) populates from
the committed `[prompts]` block. `resolveActionPreference` falls back to it whenever the user has
no personal override, and `composeActionPrompt` appends it under a header asserting it is the
user's own preference and outranks everything above. The comment at `action-prompts.ts:337-339`
records a deliberate decision to leave the preferences *outside* the clamp, so repo-authored text
is the one unbounded segment of the prompt.

**Scenario.** Repository author commits `[prompts] review = "…"` → user clicks Code review /
Create PR / Fix errors → repo-authored text is delivered to their agent as a top-priority
instruction from themselves, with no provenance marker and no length bound. This is weaker than
the setup script the same repo already runs, so it is not a privilege escalation in
`workspace-trusted`; it matters because it is the one repo-controlled channel that stays live
when scripts are not running, it is invisible at click time, and CFG-01 means the stricter modes
that would otherwise narrow the blast radius are not engaged.

**Existing guards & tests checked.** Settings → Repo → Actions surfaces the value
(`settings/repo/$repoId/actions.tsx:119`), so it is discoverable — but only if looked for. No cap,
no delimiter, no separation of committed from personal text in the composed prompt.

**Fix.** Split the addon: keep the precedence claim for the personal override, and wrap the
committed value in its own tagged block whose header states it came from the repository's
`.ensemblr/settings.toml` and is untrusted guidance rather than a user instruction. Cap it (the
existing `clampReviewContext` budget is the natural bound) and show its source in the Actions row.

---

### [CFG-05] `environment_variables` and `*_executable_path` are parsed, schema-valid, documented — and read by nothing

- **Severity:** Medium
- **Confidence:** Confirmed
- **Where:** `src/main/config/repository-config.ts:54,60-68`; `schemas/settings.schema.json:9`;
  `docs/guide/12-repository-settings.md:88`;
  `resources/agent-skills/skills/ensemblr/references/settings-toml.md:54`

**What.** Both key families normalise into the repository-scope resolution and stop there.
`environmentVariables` has no reader anywhere in `src/` outside the field map itself — the
environment assembly builds its layers from env files, Infisical, SQLite plain values and the
secret store (`environment-assembly.ts:37-215`) and never consults a repository config. The
executable-path resolvers read the **app** scope only
(`claude-executable.ts:218-226`, `toPathSnapshot` at `agent-provider-service.ts:112-117`), so a
repository-scope value is unreachable by construction.

**Scenario.** A team commits `environment_variables` for their whole repo, the JSON Schema
validates it, the docs and the bundled agent skill both state it is "assembled into the
environment of terminals and scripts", the Repo settings screen raises no diagnostic — and every
terminal launches without it. The failure is silent in both directions: nothing warns, and the
agent skill actively instructs agents to route secret-dependent commands through Ensemblr
terminals on the strength of a guarantee that is not implemented.

This is also *why* the env-hijack vector in the brief does not exist. There is no denylist of
variable names for repo-supplied env because there is no repo-supplied env: a repository cannot
set `PATH`, `ANTHROPIC_BASE_URL`, `GIT_SSH_COMMAND`, `NODE_OPTIONS`, `DYLD_INSERT_LIBRARIES` or
the `ENSEMBLR_CONTROL_*` keys for any consumer. **If this is implemented, a name allowlist must
land with it** — the reserved-key check (`environment-variable-keys.ts:29-34`) only covers the
five `ENSEMBLR_*` runtime variables and would not stop any of the above.

**Existing guards & tests checked.** `tests/main/published-schemas.test.ts` holds the schema to
`REPOSITORY_CONFIG_KEYS`, which is derived from the field maps — so it passes, because the loader
genuinely accepts the keys. The test cannot see that nothing consumes them.

**Fix.** Pick one. Either wire both into their consumers (env as a repository layer below the
SQLite plain layer, with a variable-name allowlist; executable paths as repository-scope
candidates in the provider resolvers) — or remove them from the field maps and the schema and
correct `docs/guide/12-repository-settings.md` and the bundled skill reference. Shipping a schema
that validates an inert key is the worst of the three.

---

### [CFG-06] The workspace-script IPC channels bypass the permission gate

- **Severity:** Medium
- **Confidence:** Confirmed
- **Where:** `src/main/ipc/handlers/workspace-scripts.ts:34-76`

```ts
ipcMain.handle(          // bare handle — not withPermissionGate
	IPC_CHANNELS.runWorkspaceScript,
	(_event, request: RunWorkspaceScriptRequest): Promise<RunWorkspaceScriptResult> =>
		scriptLifecycleService.runScript({ kind: request.kind, … }),
);
```

**What.** `registerWorkspaceScriptHandlers` is not passed `withPermissionGate` and registers all
four channels — `ensureWorkspaceSetup`, `runWorkspaceScript`, `stopWorkspaceScript`,
`updateRepositoryScripts` — with bare `ipcMain.handle`. Only six handler modules accept the gate
(`github`, `clone`, `repository`, `root`, `workspace-files`, `agent-session`). Running a
repository script is a `workspace-command`, which `classifyPermissionAction` returns as
`blocked` under `read-only` and `confirmation-required` under `approval-required`
(`permissions.ts:162-180`), and `updateRepositoryScripts` writes a committed file.

**Scenario.** Under `read-only`, the Run button still starts the repository's shell command and
the Scripts pane still rewrites `.ensemblr/settings.toml`. Today this is masked by CFG-01 — the
mode is always `workspace-trusted`, so nothing is blocked anywhere — which is exactly why it must
be fixed in the same change: repairing CFG-01 without gating these channels leaves read-only
enforced on six handler groups and not on the one that runs shell commands.

**Existing guards & tests checked.** Agent-reached terminals go through the control server's own
gate (`main.ts:1544-1545`) and are workspace-scoped, so this is a renderer-side gap. No test
asserts gate coverage per channel.

**Fix.** Pass `withPermissionGate` into `registerWorkspaceScriptHandlers` and classify the four
channels (`workspace-command` for run/stop/ensure, `workspace-write` for the settings rewrite).
A test that enumerates registered channels against an expected action map would stop the next
handler group from being added ungated.

---

### [CFG-07] The Security screen tells the user a committed value overrides them; no committed value can

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `src/renderer/routing/routes/_workbench/settings/repo/$repoId/security.tsx:47-53`

```tsx
defaults='A committed <file>.ensemblr/settings.toml</file> value shared with the team still wins
 over this personal override — a repository can raise its own floor and you cannot lower it locally.'
```

**What.** No field map maps any TOML key onto `security.permissionMode`, so a committed config
can never contribute a candidate for it (`repository-config.ts:52-115`; unknown keys are dropped
at `:320-327`). The sentence describes a mechanism that does not exist, and it is the one piece of
UI copy that would make a user believe the mode is enforced. It is translated into `ru` and `el`,
so a correction is a three-locale change.

**Fix.** Resolve alongside CFG-01. If repository-scope enforcement lands and a committed floor is
wanted, add the key to the field map and the schema with a validator that only permits *raising*
strictness. If not, delete the paragraph and its `ru`/`el` values.

---

### [CFG-08] Two config writers use a predictable temp path without `O_EXCL`

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `src/main/config/app-settings-service.ts:129-132`;
  `src/main/config/repository-settings-writer.ts:155-163` (same line as CFG-02)

```ts
const tempPath = `${configPath}.tmp`;
writeFileSync(tempPath, serialized, 'utf8');
renameSync(tempPath, configPath);
```

**What.** `~/.config/ensemblr/config.json.tmp` is a fixed path written with default `0644` and no
`wx`. Unlike CFG-02 this is not reachable from a repository — it needs local write access to the
user's config directory, which is already game over — so it is hardening rather than a live
vector. Two concurrent `update()` calls also race on the same temp name. The publication writer
shows the pattern to copy: randomized name, `openSync(…, 'wx', 0o600)`, `mkdirSync` at `0o700`
(`settings-publication-files.ts:317-326`).

**Fix.** Fold both writers onto the publication writer's atomic-replace helper.

---

### [CFG-09] No size bound on the repository config read

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `src/main/config/repository-config-loaders.ts:59,106`

**What.** `readFileSync(sourcePath, 'utf8')` then `load()` with no length check. A repository
shipping a multi-hundred-MB `.ensemblr/settings.toml` blocks the main thread and inflates the
heap on every `resolve({repository})` — which the Scripts pane, the review-brief fallback and
`resolveScriptConfig` all call. Deeply nested tables recurse in both `js-toml` and `flattenRecord`
(`config-resolution.ts:972-990`). Self-inflicted in the common case; the guard already exists
next door.

**Existing guards & tests checked.** `settings-publication-files.ts:36,377-397` caps the same file
at `MAX_SETTINGS_BYTES = 1 MiB` and reads it through `readBoundedSettings`, which refuses before
allocating. The loader does not use it.

**Fix.** Route `readTomlFile` through `readBoundedSettings` and surface an
`invalid-repository-toml` diagnostic on overflow. Cap `flattenRecord` depth.

---

### [CFG-10] Scrollback append is O(retained chunks) at the 10 MB production limit

- **Severity:** Medium
- **Confidence:** Confirmed (measured)
- **Where:** `src/main/terminal/terminal-scrollback.ts:37-48`, on the `pty.onData` path at
  `src/main/terminal/terminal-service.ts:1336`

```ts
while (totalLength > limit && chunks.length > 0) {
	const head = chunks[0] as string;
	if (head.length <= overflow) { chunks = chunks.slice(1); }          // O(chunks) per append
	else { chunks = [head.slice(overflow), ...chunks.slice(1)]; }       // O(chunks) per append
}
```

**What.** The live limit is `scrollbackMbToBytes(appearance.terminalScrollbackMb)`, default 10 MB
and up to 200 (`main.ts:1277`, `src/shared/config.ts:175`) — not the 400 000-byte default. Once
the buffer is full, each append rebuilds the chunk array, so cost scales with chunk *count*.
Measured at a full 10 MB buffer: 16-byte chunks → 655 360 retained → **1 874 µs per append**;
4 KiB → 8.3 µs; 64 KiB → 0.7 µs. This runs synchronously on the main thread. `cat /dev/urandom |
base64` is not the bad case (large chunks); a long-lived agent TUI repainting with small flushed
writes is, and raising the setting to 200 MB scales the chunk count 20×.

**Existing guards & tests checked.** `tests/main/terminal-service.test.ts:27` tests trimming
correctness, not cost. No cap on chunk count.

**Fix.** Advance a head index instead of re-slicing, compacting only when it passes half the
array; or coalesce small appends into a tail chunk until it reaches a threshold. Either makes
append amortized O(1) and leaves `read()` unchanged.

---

### [CFG-11] Terminal writes are truncated at 64 KiB only after the whole payload has crossed IPC

- **Severity:** Medium
- **Confidence:** Confirmed
- **Where:** `src/main/terminal/terminal-service.ts:72-73,1862`;
  `src/renderer/components/workbench-shell/dock-panel/xterm-terminal.tsx:126`

```ts
// Defense-in-depth against a compromised renderer flooding the PTY buffer.
const MAX_WRITE_BYTES = 65_536;
…
write: (terminalId, data) => { session.pty?.write(data.slice(0, MAX_WRITE_BYTES)); },
```

**What.** Two defects on one line. As a flood guard the cap is too late: the renderer forwards
xterm's `onData` unchunked, so a 100 MB paste is structured-cloned across IPC and materialized in
main *before* the slice — the main-process memory spike and serialization stall the cap exists to
prevent. For an honest user, a paste above 64 KiB is silently discarded past the boundary with no
error, diagnostic, or truncation marker.

**Existing guards & tests checked.** No test asserts the cap. `resizeTerminal` is correctly
clamped to `[2, 1000]` with non-finite rejection (`terminal-service.ts:1868-1874`).

**Fix.** Chunk in the renderer (~32 KiB, sequenced), keep the main-side cap as the
defense-in-depth it claims to be, and emit a diagnostic when it actually fires.

---

### [CFG-12] OSC window titles from a PTY are uncapped and render untruncated in the dock strip

- **Severity:** Low
- **Confidence:** Confirmed
- **Where:** `src/main/terminal/terminal-service.ts:788-813`;
  `src/renderer/components/workbench-shell/dock-panel/dock-panel.tsx:121-127`

**What.** `TITLE_SCAN_WINDOW` (512, line 796) bounds only the *unterminated* tail buffer; a fully
terminated title inside one PTY chunk is captured at up to ~64 KiB, becomes `snapshot.title`, and
renders on a `TabsTrigger` with `flex-none` and no `truncate`/`max-w-*`. The tab sizes to its
content and pushes the rest of the dock off-screen. No XSS — React escapes it — and it is not
persisted. Affects `kind === 'agent'` sessions (line 781), so a hostile repository's toolchain
qualifies. The sibling title source is capped at 80 characters and collapsed to one line
(`agent-conversation-title.ts:48,99-106`); the OSC path is not.

**Fix.** Route the OSC title through the same `normalizeTitle`, and add `truncate max-w-*` to the
dock trigger as defense in depth.

---

## Verified sound

- **The app's own `git`/`gh`/`du` calls carry no repository-controlled env.**
  `local-command.ts:143,193` resolves a login-shell snapshot memoized per cwd and merges only
  caller-supplied overrides; no repository layer participates. `spawn-command.ts:66` applies
  `stripLaunchContextEnv` as a final boundary strip, dropping `__CFBundleIdentifier`,
  `ELECTRON_RUN_AS_NODE`, `XPC_*` and the full `GIT_*` discovery set including
  `GIT_CONFIG_{KEY,VALUE}_N` (`launch-env.ts:16-72`). `shell: false` throughout.
- **Login-shell env capture cannot be delimiter-spoofed.** `command-environment.ts:143-144` runs
  `<shell> -lic "printf … BEGIN; /usr/bin/env -0; printf … END"`; `parseShellEnvironmentOutput`
  (`:246-256`) splits on NUL and matches sentinels by whole-element equality. An env value cannot
  contain NUL and `env -0` always prefixes `NAME=`, so no value can forge a sentinel field.
- **That capture is bounded and cached.** 3 s timeout (`local-command.ts:49`), SIGTERM then
  SIGKILL after 500 ms (`command-environment.ts:169-178`), memoized per-cwd for the session on
  success and 30 s on fallback (`local-command.ts:85-141`). One spawn per workspace directory.
- **js-toml's serializer escapes correctly — no TOML injection.** Round-tripped the real `dump`
  against a script body containing `"\n[bad]\nx = 1`, one containing `"""`, one containing `\"`,
  and run-script names containing `.`, a space, and `"]\n[scripts]\nsetup="…"`. Every case
  serialized to a quoted/escaped form that parsed back identically. A renderer-supplied script
  body or name cannot inject a table.
- **`settings-publication-*` is correctly hardened** and is the reference for CFG-02/08/09:
  symlink refusal via `lstat` on root, `.ensemblr/`, and file (`:419-434`);
  `openSync(…, 'wx', 0o600)` on a randomized temp path (`:319-320`); `mkdirSync` at `0o700`
  (`:317`); 1 MiB bound enforced before allocation (`:36,377-397`); `git --no-optional-locks`
  with a timeout and `maxBuffer` (`:494-498`). It **writes a file only** — no commit, no push, no
  index mutation.
- **`file_include_globs` cannot escape the repository.** Patterns are written to a temp file and
  passed as `--exclude-from`, never argv, and enumeration is `git ls-files -z --others --ignored`
  in the repository cwd (`files-to-copy.ts:163-183`), which cannot return a path outside the
  worktree. The copy destination joins the git-supplied relative path (`:93-95`).
- **A repo-supplied `infisical.site_url` cannot pull a credential to an attacker host.**
  `matchBySiteUrl` (`infisical-account-match.ts:114-124`) requires an exact match against exactly
  one account the user already registered; anything else yields `accountId: null`.
- **The setup fingerprint hashes no secrets.** `computeSetupFingerprint` covers the setup command
  plus lockfile bytes only (`setup-fingerprint.ts:72-82`); no environment value enters the hash or
  the state file.
- **Repository config parsing is allowlist-shaped with no pollution sink.** Unknown keys are
  dropped with a diagnostic (`repository-config.ts:320-327`); every merge is an object spread on a
  mapped key or a `Map`; `__proto__`/`constructor` appear in no field map.
- **Settings resolution is cheap enough to run per gated IPC call.** Measured against the real
  `resolveSettings` over 2 000 iterations: 14 µs app-scope, 87 µs with a repository (TOML read,
  `.worktreeinclude` probe and SQLite query included). The per-call design at
  `ipc/handlers.ts:268-271` is not a hot-path problem.
- **Terminal resize bounds, OSC reachability, and poll timers** — `clampDimension` rejects
  non-finite and clamps to `[2, 1000]` (`terminal-service.ts:1868-1874`); xterm 6 registers no
  OSC 52 handler and `allowProposedApi` is off (`xterm-adapter.ts:54-72`); OSC 8 targets pass the
  `{http,https}` scheme gate in main (`app/external-links-policy.ts:8,25`); replayed scrollback is
  stripped of DA/DSR/DECRQM answerback forms (`shared/terminal/strip-report-requests.ts:28-49`);
  the 1500 ms title poll reads a bounded log head and the 500 ms foreground poll is one
  `tcgetpgrp` (`pty-backend.ts:76-82`) — no `ps`, no `lsof` — both `unref`'d and cleared in
  `clearSessionTimers` (`terminal-service.ts:992-1010`).
- **Scrollback persistence is debounced, not per-chunk.** `terminal-service.ts:735-748` arms a
  single 1 s timer that will not re-arm while pending; `persistSessionOutput` then does one
  `writeFileSync` of the whole buffer (measured 3.7 ms at 10 MB), off the `onData` path and only
  for `kind === 'terminal'`. The six sync fs calls in `terminal-output-file.ts` are one per
  flush / restore / close.
- **Setup probes are parallel, non-blocking, shell-free, and never auto-remediate.** One
  `Promise.all` (`setup-diagnostics.ts:179-186`) so worst case is the slowest probe, not the sum;
  fixed argv with no interpolation of probe output (`setup-checks-github.ts:55-60,114-119,187-192`);
  `gh auth status` without `--show-token`, 5 s timeout; every `run-command` remediation is a
  constant the renderer *copies to the clipboard* rather than executing
  (`setup-check-row.tsx:108-112`); the shell route gate keys on `onboarding.completedAt`, not
  setup status — **offline is usable**. Diagnostics are redacted before leaving main
  (`setup-diagnostics.ts:282-351`).
- **`open-in-editor.ts`** reads `$VISUAL`/`$EDITOR` from the app's own `process.env` (not
  repository-controlled), splits on whitespace, and spawns with `shell: false` and
  `stripLaunchContextEnv` (`:22-27,48-53`).

---

## Coverage

**Read in full:** all 18 files of `src/main/config/**`; `src/main/environment/` —
`launch-env.ts`, `environment-assembly.ts`, `environment-variable-keys.ts`,
`environment-variable-catalog.ts` (head), `repository-settings.ts`, `settings-table.ts`;
`src/main/commands/` — `command-environment.ts`, `local-command.ts`, `spawn-command.ts` (head);
`src/main/scripts/` — `setup-fingerprint.ts`, `setup-state-file.ts`, `script-lifecycle-service.ts`
(head + config resolution); `src/shared/permissions.ts`, `src/shared/scripts/run-scripts.ts`,
`src/shared/prompt-scaffolding.ts` (relevant constants); `src/main/ipc/permission-gate.ts`,
`handlers/workspace-scripts.ts`, `handlers/terminal.ts` (head); `schemas/settings.schema.json`;
`src/main/repository/files-to-copy.ts` (listing path); `src/main/infisical/` account matching and
link resolution; the renderer Security, Environment and Actions routes and
`lib/workbench/action-prompt{s,-preference}.ts`.

**Evidence gathered by measurement** (throwaway scripts, no repo file written): the CFG-01 scope
mismatch against the real `resolveSettings` + `readPermissionModeFromSnapshot`; the CFG-02
symlink overwrite against the real `writeRepositoryScripts` (fixture created and removed under
`/tmp`); js-toml `dump`/`load` escaping over six hostile payloads; `resolveContextPath` traversal;
`resolveSettings` throughput.

**Delegated:** `src/main/terminal/**` and `src/main/setup/**` were audited by one depth-2 leaf
(Opus, read-only), which produced CFG-10 through CFG-12 and the terminal/setup entries under
Verified sound. I independently re-verified CFG-03 end to end (handler → `rmSync`, and the
`writeArchivedTerminalOutput` guard asymmetry at `terminal-output-file.ts:85`) and confirmed the
read path is not renderer-reachable. CFG-10's measurements and the OSC-handler enumeration in
CFG-12 are the leaf's and were not independently re-run.

**Not covered:** `script-lifecycle-service.ts` beyond config resolution — kill semantics on app
quit, orphaned grandchildren of a `npm run dev` PTY, and archive-hook ordering against worktree
removal are unexamined; `repository-scripts-migration.ts`; `settings-publication-recovery.ts`
internals (only its writer's guards were read); `environment-variables.ts` (736 lines) beyond
confirming it has no repository-config reader — secret handling there belongs to auditor 06;
`workspace-environment.ts` and `workspace-ports.ts`; git argument construction, which is
auditor 05's.

---

## Open questions

1. **Which scope should own `security.permissionMode`?** (CFG-01) `SECURITY.md` and the UI say
   per-repository; every gate is written for app scope; `config.json` already feeds app scope and
   works. Repository scope with an app-scope fallback matches the documented model and keeps the
   hand-edited config working, and is what I would do — but it means threading the active
   workspace's repository into three call sites, one of which (`ipc/handlers.ts:270`) is a generic
   gate with no workspace in hand. An app-scope-only answer is a smaller change and a bigger
   doc/UI correction.
2. **Is `environment_variables` meant to exist?** (CFG-05) Implementing it is the larger job and
   needs a variable-name allowlist designed first; removing it is a schema change plus three doc
   edits. The bundled agent skill instructing agents to rely on it argues that it was intended.
3. **Should a committed config be able to raise the permission floor?** (CFG-07) If yes, the key
   needs a field-map entry with a raise-only validator. If no, the UI paragraph and its `ru`/`el`
   values go.
4. **CFG-04's shape.** Tagging the committed block as untrusted is the minimal fix; refusing
   committed prompts entirely under `approval-required`/`read-only` is the stronger one but only
   becomes meaningful once CFG-01 is fixed.
