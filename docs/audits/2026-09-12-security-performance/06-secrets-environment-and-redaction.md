# Audit 06 — Secrets, environment assembly, and redaction

The secret store itself is sound: nothing writes a credential value to a plain
file, nothing puts one in SQLite on macOS, the per-workspace control token is
never rendered literally into argv or an MCP config file, and the Infisical
Machine Identity cannot be redirected by a repository it reads. The exposure
that remains is at the edges — a Linux database file with default permissions
holding `safeStorage` ciphertext, a raw terminal scrollback log whose
git-exclude is best-effort, and three separate redaction implementations with
three different coverage sets, of which the weakest guards persisted command
logs.

Six findings: one Medium-High, two Medium, three Low, plus one performance item.
No Critical. ADR 0051's "native chat agents do not inherit the Infisical layer"
is verified in code, not just documented.

## Secret inventory

| Secret | At rest | In memory | Sinks reached | Verdict |
| --- | --- | --- | --- | --- |
| Linear OAuth access token | macOS Keychain / Linux `safeStorage` ciphertext in `secret_metadata.secret_value`, key `linear-access-token:<accountId>` (`src/main/linear/linear-account-store.ts:15`) | `linear-client.ts` request headers | Linear API over HTTPS. Never IPC, never argv, never a file. `infisical_accounts`-style comment at `src/main/storage/database.ts:739` confirms no token column. | Sound |
| Linear OAuth refresh token | Same, key `linear-refresh-token:<accountId>` (`linear-account-store.ts:16`) | Refresh call only | Linear token endpoint | Sound |
| Infisical Machine Identity client secret | Secret store, key derived per account (`src/main/infisical/infisical-account-store.ts:93,129`) | `resolveAccessToken` login body (`infisical-client.ts:87-92`) | POST body to `${account.siteUrl}/…`. **`http:` is accepted** (`infisical-api.ts:124`) → [SEC-05] | Finding |
| Infisical access token | Never persisted (`infisical-client.ts:42-52`) | `tokensByAccountId` Map, TTL-checked | Authorization header only | Sound |
| Infisical resolved secret values | Failure-fallback copy in the secret store under key `infisical-cache` (`infisical-cache.ts:9,101-118`) | Env assembly `redactValues` set | Terminal/script child env; `redactValues` into `createSanitizedLogs`; masked (`maskSecret`) in the renderer snapshot (`environment-variable-snapshots.ts:153`). **Not** given to native chat agents. | Sound |
| Dictation API key | Secret store, key `dictation:api-key`, app scope (`src/main/dictation/dictation-types.ts:17`) | `requestTranscript` Authorization header | Configured endpoint; provider error bodies are key-redacted (`dictation-service.ts:87-89,141`). Renderer receives `maskedDisplay` only, never the value. **`http:` allowed by design** (loopback whisper-server) → [SEC-05] | Mostly sound |
| Per-workspace control bearer token | Not persisted at all | `main-integration.ts:312` overlay; child env `ENSEMBLR_CONTROL_TOKEN` | Child process env only. MCP configs carry `${ENSEMBLR_CONTROL_TOKEN}` by reference (`claude-mcp-config.ts:46`, `harness-launch-config.ts:107,141,164`). Session metadata persists `{ runtimeSessionId }` only (`session-open.ts:214`). Reachable via terminal scrollback if the user runs `env` → [SEC-03] | Sound (design), transitive risk |
| GitHub credentials | **None stored.** No `GH_TOKEN`/`GITHUB_TOKEN` write path in `src/main`; `gh` owns it. Only appearance is a redaction pattern (`setup-diagnostics.ts:108`). | — | — | Confirmed absent |
| Keychain-backed env-var rows (Settings) | Secret store, key `environment:variables:<KEY>` (`environment-variable-keys.ts:9`) | Env assembly | Terminal/script env; renderer sees `maskedDisplay` + `characterCount` (`environment-variable-snapshots.ts:116-128`) | Sound |
| `.env`-file values | The user's own file; paths in `settings.value_json` under `environment.files` | Env assembly | Terminal/script env; secret-*named* ones render `[set]` and feed `redactValues` (`environment-assembly.ts:52-60`), **non-secret-named ones render in plaintext over IPC** (`environment-variable-snapshots.ts:135`) → [SEC-06 note] | Acceptable, see note |
| `environment_variables` from `settings.toml` / `config.json` | Git-tracked / config file, by the user's choice | Env assembly | Terminal/script env. Secret-classified names are **refused** with a diagnostic (`environment-variable-collectors.ts:87-96`) | Sound guard |
| Plain env-var rows set in Settings | `settings.value_json`, plaintext SQLite (`environment-variable-collectors.ts:113-184`) | Env assembly | Terminal/script env, renderer plaintext | By design (they are declared plain) |
| Linux `safeStorage` key material | Held by the OS keyring; ciphertext in `secret_metadata.secret_value` | — | **The DB file is created with default permissions** → [SEC-01] | Finding |
| Raw terminal scrollback (may contain any of the above) | `<worktree>/.context/terminals/<id>.log`, unredacted, default mode (`terminal-output-file.ts:48-64`) | `ScrollbackBuffer` | The log; `ensemblr_read_terminal_output` → agent transcript → `agent_session_events.payload_json` → [SEC-03] | Finding |
| Command logs (`LocalCommandSanitizedLogs`) | **Not persisted** — no SQLite write, no file. Returned in-process and surfaced through setup checks. | — | Setup-check UI, clipboard support bundle (second sanitizer applies) | Sound sink, weak redactor → [SEC-02] |
| Agent prompts / tool results | `agent_session_events.payload_json` verbatim (`agent-session-persistence.ts:41-49`) | — | SQLite. Names and summaries go to the *user's own* runtime (`agent-runtime/naming/*`) — no third-party model. | Transitive sink for [SEC-03] |

## Findings

### [SEC-01] Linux: the SQLite file holding every secret's ciphertext is created world-readable, and an obfuscated keyring makes that ciphertext reversible

- Severity: Medium-High
- Confidence: Confirmed (file mode); Likely (Electron `basic_text` reversibility — not reproducible without a Linux host)
- Where: `src/main/storage/database.ts:1249-1260`

```ts
const databasePath = options.databasePath ?? resolveDefaultDatabasePath();

if (databasePath !== SQLITE_MEMORY_PATH) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
}

const database = new DatabaseSync(databasePath, {
```

- **What.** `mkdirSync` is called with no `mode` and the DB file with no mode, so
  the directory lands at 0755 and the file at 0644 under a typical umask. On
  Linux the path is `~/.config/ensemblr/` (`database.ts:1237`), whose parent is
  commonly 0755 — unlike macOS, where `~/Library` is 0700 (verified on this
  machine: `drwx------`). ADR 0056 puts `safeStorage` ciphertext for every
  secret in `secret_metadata.secret_value` (migration `023_secret_value_blob`,
  `database.ts:1021-1048`), so on Linux the ciphertext for Linear tokens, the
  Infisical client secret, the whole Infisical fallback cache, and the dictation
  key sits in that file.
- **Scenario.** A shared Linux workstation with no keyring daemon:
  `getSelectedStorageBackend()` returns `basic_text`, which Electron
  "encrypts" with a hardcoded key. `requireSafeStorage` only refuses when
  `isEncryptionAvailable()` is false (`safe-storage-backend.ts:186-196`), and
  that is not false for `basic_text` — so storing proceeds. A second local user
  reads `~/.config/ensemblr/*.db` (0644) and reverses every secret with a
  published constant. Even with a real keyring, a 0644 database hands another
  user the full metadata table and ciphertext to attack offline.
- **Existing guards & tests checked.** `safe-storage-health.ts:33-50` grades
  `basic_text` and `unknown` as `obfuscated`, and `setup-checks-core.ts:477-492`
  raises a *warning* setup check ("stored secrets are only obfuscated"). That is
  a real guard and it is why this is not High: the state is visible. What is
  missing is any refusal at the write path and any permission hardening.
  `tests/main/setup-diagnostics.test.ts:1167` covers the warning; nothing
  asserts a file mode.
- **Fix.** Create the Linux config directory with `mode: 0o700` and `chmod` it,
  and open the database so the file lands 0600 — the repo already does exactly
  this for published settings (`settings-publication-files.ts:317-320` uses
  `mkdirSync(..., { mode: 0o700 })` and `openSync(..., 'wx', 0o600)`), so this
  is applying an existing house pattern to the database. Separately, have
  `buildSafeStorageSecretStore` consult `readSafeStorageStatus()` and refuse a
  *new* write while protection is `obfuscated` unless the user has acknowledged
  it, rather than only reporting it afterwards.

### [SEC-02] Three divergent redaction implementations; the weakest one guards command logs and has no test file

- Severity: Medium
- Confidence: Confirmed
- Where: `src/main/commands/command-redaction.ts:4-15`

```ts
const SENSITIVE_KEY_PARTS = [
    'accesstoken', 'apikey', 'auth', 'credential',
    'password', 'privatekey', 'secret', 'token',
];
const SENSITIVE_ASSIGNMENT_PATTERN =
    /\b([A-Z0-9_.-]*(?:ACCESS[_-]?TOKEN|API[_-]?KEY|CREDENTIAL|PASSWORD|PRIVATE[_-]?KEY|SECRET|TOKEN)[A-Z0-9_.-]*)(\s*[=:]\s*)(["']?)([^\s"',;]+)/gi;
```

- **What.** Four secret-name lists exist and none of them agree:
  `src/shared/sensitive-key.ts:6-15` (the declared single source of truth),
  `command-redaction.ts:4-15` (a hand-copied duplicate of it),
  `src/main/setup/setup-diagnostics.ts:106-111` (adds GitHub token shapes), and
  `src/renderer/lib/diagnostics-bundle.ts:8-14` (adds `bearer`,
  `authorization`, `cookie`, JWT, hex tokens, emails). The list that guards
  persisted-and-displayed command output is the narrowest of the four, and
  `command-redaction.ts` does not import the shared constant it duplicates.
- **Scenario.** A user sets `PASSPHRASE`, `SESSION_ID`, `DATABASE_URL`
  (`postgres://user:pw@host/db`), `OPENAI_KEY`, or `SIGNING_KEY` in a workspace
  environment and a setup or run script fails. `isSensitiveKey` normalises
  `OPENAI_KEY` to `openaikey`, which contains none of the eight parts, so the
  key is not redacted — and because the value-list is populated *only* from
  keys that already matched (`command-redaction.ts:63-67`), the value is not
  redacted in stdout/stderr either. The failing command's environment and output
  are rendered into a setup check and shown in the UI. The renderer's second
  sanitizer catches a JWT- or hex-shaped value on the clipboard path only; the
  on-screen text is not re-sanitized.
- **No value-shape detection at all.** `sk-…`, `ghp_…`, `github_pat_…`,
  `xoxb-…`, `AKIA…`, `eyJ…` JWTs, and PEM blocks pass through
  `command-redaction.ts` untouched, even though `setup-diagnostics.ts:108` and
  `diagnostics-bundle.ts:12-14` already carry two of those patterns.
- **Existing guards & tests checked.** `tests/main/local-command.test.ts:509-532`
  asserts only `API_TOKEN` and `PASSWORD`. There is no
  `tests/main/command-redaction.test.ts`. The `value.length >= 4` floor
  (`command-redaction.ts:64,70`) is a negligible gap by comparison.
- **Fix.** Import `SENSITIVE_KEY_PARTS` from `src/shared/sensitive-key.ts` in
  all three redactors rather than copying it, widen it (`pass`, `passwd`,
  `passphrase`, `session`, `cookie`, `bearer`, `signing`, `dsn`, `_url` when the
  value parses as a URL with userinfo), and add a value-shape pass carrying the
  provider prefixes already present in the sibling files. Redact the value of
  *every* env entry above a length floor when it appears verbatim in output,
  rather than only entries whose key matched.

### [SEC-03] Unredacted terminal scrollback is written to `.context/terminals/<id>.log`, the git-exclude that hides it is best-effort, and an agent can pull the same text into SQLite

- Severity: Medium
- Confidence: Confirmed
- Where: `src/main/terminal/terminal-output-file.ts:48-64` and
  `src/main/repository/create-workspace.ts:1223-1249`

```ts
const outputPath = ensureContextPath(worktreePath, TERMINAL_OUTPUT_SUBDIR, `${terminalId}.log`);
if (outputPath === null) { return; }
writeFileSync(outputPath, text);
```

```ts
const excludePath = path.join(commonDir, 'info', 'exclude');
...
console.warn('[create-workspace] Failed to add .context/ to git exclude.', {
```

- **What.** Scrollback is persisted raw — no redactor runs anywhere under
  `src/main/terminal/**` (grep for `redact|sanitiz` returns one unrelated
  comment at `terminal-service.ts:1972`), and `writeFileSync` uses the default
  mode. The module's own JSDoc says the directory is "root-gitignored with the
  rest of `.context`", but that ignore is written per repository into
  `<git-common-dir>/info/exclude` at workspace creation, and a failure there is
  a `console.warn` that never reaches the user or a setup check
  (`create-workspace.ts:1196` documents this as deliberate: "failure leaves
  `.context/` un-ignored but never fails workspace creation").
- **Scenario.** The exclude write fails (read-only `.git`, a permissions
  problem, an unusual common-dir layout). The user runs `cat .env` or
  `export AWS_SECRET_ACCESS_KEY=…` in a dock terminal. `.context/terminals/*.log`
  now holds that value, is not ignored, and the next agent that runs
  `git add -A && git commit` commits it. That is the SECURITY.md in-scope case
  exactly: a stored credential reaching a git-tracked file.
- **Transitive sink.** Independently of the exclude, an agent calling
  `ensemblr_read_terminal_output` (`agent-control-service.ts:3667`,
  `mcp-endpoint.ts:603`) receives the same text, and the tool result is
  persisted verbatim — `eventPayload` passes `event.payload` straight through
  for a `message` event (`agent-session-persistence.ts:41-49`) into
  `agent_session_events.payload_json`. So a secret echoed in a terminal reaches
  the database through the agent transcript even when the log itself stays
  ignored. This is also the one path by which the control bearer token can
  escape its process: a user who runs `env` puts it in scrollback.
- **Existing guards & tests checked.** `.gitignore:2` covers `.context/` for
  *this* repository only — it says nothing about a user's repository.
  `tests/main/terminal-output-file.test.ts` covers write/read/remove, not the
  exclude failure and not permissions. The awareness playbook
  (`src/shared/agent-control/awareness.ts:314`) tells agents never to echo a
  secret back, which is guidance, not a control.
- **Fix.** Raise the exclude failure as a workspace diagnostic or setup check
  rather than a console warning — it is the only thing standing between raw
  scrollback and `git add -A`. Write the log `0600`. Consider threading the
  assembled `redactValues` (already computed for the same terminal's
  environment, `workspace-environment.ts:82-84`) through the scrollback writer
  and through `readTerminalOutput`, which would cover the Infisical and
  Keychain-backed values at both sinks for free.

### [SEC-04] The Keychain write path passes the secret value on argv as `-X <hex>`

- Severity: Low
- Confidence: Confirmed
- Where: `src/main/secrets/keychain-backend.ts:96-111`

```ts
const encodedValue = Buffer.from(input.value, 'utf8').toString('hex');

await runSecurityCommand(commandPath, [
    'add-generic-password', '-a', reference.account, '-s', reference.service,
    '-l', input.displayName, '-j', `Ensemblr ${input.scope} secret metadata entry`,
    '-U', '-X', encodedValue,
]);
```

- **What.** `man security` documents `-X password` as "password data to be added
  as a hexadecimal string" — hex is an encoding, not a protection. For the life
  of the spawn the value is in `ps` argv. Every write goes through here: Linear
  access and refresh tokens, the Infisical client secret, the dictation key,
  every Keychain-backed env-var row, and the Infisical fallback cache — which is
  a JSON blob of an *entire project's* secrets in one argv
  (`infisical-cache.ts:98-118`).
- **Correction to the brief's premise.** The `-w` at `keychain-backend.ts:198`
  is on the *read* path (`find-generic-password … -w`), where it is a bare flag
  with no value and carries nothing. The argv exposure is `-X`, on the write
  path.
- **Scenario / ranking.** Reading it requires another process running as the
  same user at the moment of a write, which SECURITY.md places out of scope
  ("anything requiring an attacker who already has local code execution as your
  user"). Ranked Low rather than dismissed because the fix is nearly free:
  `runSecurityCommand` already takes a `stdin` parameter
  (`keychain-backend.ts:243-247`) that the write path does not use, and the
  window is widened by the cache blob, which is written on every successful
  Infisical resolution.
- **Existing guards & tests checked.** No `-A` is passed, so the item is *not*
  created "accessible by any application without warning"; no `-T ""` either, so
  the default applies — the creating app (`/usr/bin/security`) is trusted.
  `stripLaunchContextEnv` is correctly applied to the spawn
  (`keychain-backend.ts:252`) and `sanitizeStderr` bounds error text
  (`keychain-backend.ts:349-351`). `tests/main/secret-store.test.ts` has 15
  tests; none asserts the value stays off argv.
- **Fix.** Feed the value over stdin, or move the write to
  `SecKeychainAddGenericPassword` through a native binding. If neither is
  practical, at minimum stop round-tripping the whole Infisical cache through
  argv on each resolution.

### [SEC-05] `http://` is accepted for the Infisical instance URL, sending the Machine Identity client secret in cleartext

- Severity: Low
- Confidence: Confirmed
- Where: `src/main/infisical/infisical-api.ts:124-128`

```ts
if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new InfisicalApiError(
        'infisical-invalid-request',
        'An Infisical instance URL must use http or https.',
    );
}
```

- **What.** A self-hosted instance URL typed as `http://infisical.internal` is
  accepted with no warning, and `login` POSTs `{ clientId, clientSecret }` to it
  (`infisical-api.ts:235-244`). The issued bearer token and then every resolved
  secret value travel the same cleartext channel.
- **Scenario.** A user on a corporate network configures an internal instance
  over `http`. Anyone on-path recovers the Machine Identity credentials, which
  are longer-lived than the access token, and the full secret set for every
  linked project.
- **Existing guards & tests checked.** The URL is *not* attacker-controlled from
  a repository: `infisical-client.ts:88-92` logs in against `account.siteUrl`
  from the local account row, and a link's `siteUrl` — including the one read
  from a repository's `.infisical.json` (`infisical-cli-config.ts:64`) — is only
  ever used to *match* an existing account (`infisical-account-match.ts:34,114`),
  never to redirect a request. That is the important half and it is correct.
  `tests/main/infisical-api.test.ts` covers normalization but not a scheme
  policy.
- **Related, lower.** Dictation allows `http:` too
  (`src/main/dictation/dictation-types.ts:19-24`) but documents why — a local
  `whisper-server` is a supported target — and the sent credential is one API
  key rather than a whole vault's identity.
- **Fix.** In both places, permit `http:` only for a loopback host
  (`localhost`, `127.0.0.1`, `::1`) and refuse it otherwise, or at least surface
  a warning in the account form.

### [SEC-06] The diagnostics bundle masks macOS home paths only

- Severity: Low
- Confidence: Confirmed
- Where: `src/renderer/lib/diagnostics-bundle.ts:10`

```ts
const HOME_PATH_PATTERN = /\/Users\/[^/\s'"]+/g;
```

- **What.** Linux home directories (`/home/<user>`) are not matched, so a
  support bundle copied from a Linux build carries the username in every path.
  Linux is a first-class target per `.claude/rules/stack.md`, not a port.
- **Scenario.** A Linux user copies a diagnostics bundle into a GitHub issue and
  publishes their username and directory layout. The main-process sanitizer does
  handle this correctly (`setup-diagnostics.ts:340-341` collapses the real
  `homeDirectory` to `~`), so the gap is only in the renderer's second pass —
  which is also where the JWT and hex-token patterns live.
- **Fix.** Add `/home/<user>` (and `/root`) to the pattern, or drop the
  duplicate renderer-side home masking entirely and rely on the main-process
  pass that already collapses the actual home directory.
- **Related note (Info).** `.env` values whose key does not look sensitive are
  sent to the renderer in plaintext (`environment-variable-snapshots.ts:131-144`)
  while secret-classified ones become `[set]`
  (`environment-variable-types.ts:62`). That is the intended distinction, but it
  inherits `isSensitiveKeyName`'s blind spots — an env-file entry named
  `PASSPHRASE` renders its value in the environment panel.

### [PERF-01] Every terminal and script launch spawns one `/usr/bin/security` process per stored secret, across three scopes, uncached

- Severity: Low-Medium (performance)
- Confidence: Confirmed
- Where: `src/main/environment/environment-assembly.ts:175-181` and
  `src/main/environment/workspace-environment.ts:65-73`

```ts
const resolved = await Promise.all(
    ...
        return readOneSecret(secretStore, key, metadata);
```

- **What.** `readOneSecret` calls `secretStore.read`, which on macOS spawns
  `/usr/bin/security find-generic-password` (`keychain-backend.ts:192-199`).
  `assemble` runs `assembleEnvironment` for the app, repository, and workspace
  scope (`workspace-environment.ts:59-73`), so a workspace with *N* Keychain-backed
  variables spawns *N* processes per launch, with no memoization anywhere —
  `allocatedPorts` is the only cache in the service.
- **Impact.** The reads are concurrent, so wall-clock is roughly the slowest
  spawn (tens of milliseconds) rather than the sum, but the process count scales
  with the secret count on every terminal open, every script run, and every
  re-assemble. Compounding it, the Infisical layer fetches live on every
  assemble by design — `infisical-cache.ts:17-24` is explicit that it is "a
  failure fallback, not a latency cache", correct for freshness but it puts a
  network round trip on the critical path of opening a terminal.
- **Fix.** Memoize secret reads for the lifetime of one `assemble` call so the
  three scope passes do not re-read overlapping keys, and consider a short
  in-process TTL keyed on the secret metadata's `updated_at`. Leave the
  Infisical live-fetch semantics alone; if launch latency matters, resolve it
  concurrently with the shell-environment load rather than caching it.

## Verified sound

- **Control token never materialised.** `buildClaudeMcpServers` writes
  `Bearer ${envVarReference(CONTROL_TOKEN_ENV_KEY)}` rather than the token
  (`src/main/claude-agent/claude-mcp-config.ts:43-52`), with the reason stated in
  its JSDoc; the terminal harness decorations do the same for Claude, Codex, and
  Vibe (`src/main/agent-control/harness-launch-config.ts:107,141,164-169`).
- **Control env is not persisted.** The session row's metadata is
  `{ runtimeSessionId }` (`src/main/agent-runtime/session/session-open.ts:214`);
  the overlay reaches only the child's env (`pi-agent/cli-rpc/spawn-env.ts:76`).
- **A repository cannot redirect Infisical credentials.** Requests use
  `account.siteUrl` (`infisical-client.ts:88-92,115`); a committed or
  CLI-discovered `siteUrl` only matches an account
  (`infisical-account-match.ts:34,114`), and a cross-instance match is refused by
  design (`infisical-account-match.ts:1-8`).
- **Infisical access tokens are memory-only** (`infisical-client.ts:42-52`), and
  the fallback cache goes through the secret store, never a file
  (`infisical-cache.ts:98-118`).
- **`.infisical.json` is read-only** — never written back
  (`infisical-cli-config.ts:1-6`).
- **ADR 0051 holds in code.** `workspaceEnvironmentService.assemble` has exactly
  one caller, `src/main/terminal/terminal-service.ts:1181`. Native chat agents
  receive only the control overlay, so no Infisical value reaches an agent's
  process env.
- **Agent control exposes no environment or secret operation.** No
  `environment`/`secret`/`envFile` op in `src/main/agent-control/ports.ts` or
  `mcp-endpoint.ts`.
- **Declarative config refuses secret-named keys** with an error diagnostic
  (`environment-variable-collectors.ts:87-96`), so a committed
  `settings.toml` cannot smuggle a credential in as a plain variable.
- **`safeStorage` never falls back to plaintext.** `requireSafeStorage` throws
  when `isEncryptionAvailable()` is false (`safe-storage-backend.ts:186-196`),
  and the `basic_text` case is graded and surfaced as a setup check
  (`safe-storage-health.ts:42-44`, `setup-checks-core.ts:477-492`).
- **Dictation redacts the key out of provider error bodies before they reach the
  UI or the support bundle** (`dictation-service.ts:87-89,141`) and never returns
  the value to the renderer (`toKeyStatus` yields `maskedDisplay` only).
- **Setup fingerprints hash the command and lockfile contents, not the
  environment** (`src/main/scripts/setup-fingerprint.ts:72-84`) — no hash of a
  secret lands on disk.
- **No `console.*` site in `src/main` logs an env object, a token, a request
  body, or a response body.** All 69 call sites surveyed; the only
  secret-adjacent one is `dictation-service.ts:348`, which logs a
  `SecretStoreError` whose message and `stderr` field carry no value.
- **No crash reporter.** `crashReporter.start` appears nowhere in `src/` or
  `forge.config.ts`, so no environment or minidump is uploaded anywhere.
- **`stripLaunchContextEnv` is applied to the `security` spawn itself**
  (`keychain-backend.ts:252`), not just to agent and terminal children.

## Coverage

Read in full: `src/main/secrets/**` (9 files), `src/main/environment/**` (the
assembly, collector, snapshot, key, launch-env, parse-env-file, env-files and
workspace-environment modules), `src/main/infisical/**` (api, cache, cli-config,
client, account-match, account-store), `src/main/dictation/**`,
`src/main/commands/command-redaction.ts`,
`src/main/terminal/terminal-output-file.ts` and `scrollback-text.ts`,
`src/renderer/lib/diagnostics-bundle.ts`, `src/shared/sensitive-key.ts`, the
secret and session schema in `src/main/storage/database.ts`, and the control-env
and MCP-config paths in `claude-agent/`, `pi-agent/`, and `agent-control/`.
Surveyed by grep: every `console.*` in `src/main`; every `chmod`/`mode:`/`umask`
in `src/main`; every consumer of `workspaceEnvironmentService.assemble` and of
`LocalCommandSanitizedLogs`. Permissions confirmed on this machine by `ls -ld`
only; no secret value was read or printed.

Not covered: `linear-asset-cache.ts` and `linear-asset-proxy.ts` (signed asset
URLs on disk) — opened but not audited in depth, low prior since the cache holds
no token key. `concierge-memory-service.ts` reads memory files the agent itself
authored rather than app-held secrets, so it adds no new sink. Main-process
tests were not executed (shared machine).

## Open questions

1. **Is a 0644 database acceptable on Linux?** The threat model excludes "an
   attacker with local code execution as your user", but a second *user* on the
   same machine is a different principal. My reading is that SEC-01 is in scope;
   if the intent is single-user machines only, it drops to Low and only the
   `basic_text` write-time refusal remains worth doing.
2. **Should scrollback be redacted, or is `.context/` considered sufficient?**
   Redacting at the writer would cover `ensemblr_read_terminal_output` and the
   agent transcript in one change, at the cost of a terminal log that no longer
   matches what the user saw. The narrower fix — surfacing the git-exclude
   failure — is what I would do first.
3. **Is `http://` for a self-hosted Infisical instance a supported
   configuration?** If some users genuinely run one on a trusted LAN, a warning
   is the right answer rather than a refusal.
