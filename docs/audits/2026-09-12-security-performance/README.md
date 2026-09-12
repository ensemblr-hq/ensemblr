# Security and performance audit — 2026-09-12

Fifteen read-only auditors covered the app in parallel, one dimension each, against the threat
model in `SECURITY.md`. Every finding in the fifteen reports cites the line it rests on; the
headline ones were reproduced against the real code (classifier, resolver, writer, database) and
re-verified by the orchestrator by reading the cited lines. Nothing under `src/` was changed.

Branch: `psoldunov/security-and-performance-audit`. Commit `64f8b0c2` audited.

## Posture in one paragraph

The parts that were designed as security boundaries hold: the loopback control server never
believes agent-supplied identity, every control op's scope check fails closed on a foreign id,
the markdown pipeline neutralised all 38 XSS payloads thrown at it, every SQL statement is
parameterized, git argv is built with `--` separators everywhere a path enters, the Linear OAuth
flow is PKCE + single-use state on a bounded loopback server, and the production dependency tree
carries zero advisories with a fully integrity-hashed lockfile. The defects are in the seams
between correct halves: the permission mode the Security screen writes is not the one any gate
reads; Plan Mode's allowlist trusts `sort`, which can exec a program; three writers into the
repository-controlled `.context` tree follow symlinks; and the event log has no retention at all.

## Top findings after de-duplication

Three reports found the permission-mode bug independently (CO-01, IPC-01, CFG-01); two found the
session-replay cost (RT-02, DB-02); two found the Iconify boot cost (RR-02, WB-01); two found
the git-status fan-out (MP-02, FS-04). Each is listed once below.

### Security

| # | Sev | Finding | Report | Where |
| --- | --- | --- | --- | --- |
| 1 | **Critical** | Per-repo `security.permissionMode` is written at repository scope and read at app scope by every gate, so `read-only` / `approval-required` never engage while the UI shows them selected. Reproduced against the real resolver. | 08 CFG-01 (= 02 CO-01, 04 IPC-01) | `src/main/environment/repository-settings.ts:71`, `src/main/ipc/permission-gate.ts:109`, `src/main/main.ts:962`, `:1544`, `src/main/ipc/handlers.ts:268` |
| 2 | **Critical** | Plan Mode bash allowlist admits `sort --compress-program=<prog>`, which execs the program. Reproduced: classifier says ALLOW, real `sort` wrote files. Same classifier guards the Concierge. | 03 PM-01 | `src/shared/plan-mode/bash-guard.ts:42`, `:270` |
| 3 | High | On Claude, Plan Mode is only `permissionMode: 'plan'`; the SDK's own `ExitPlanMode` drops it mid-turn and nothing re-asserts until the next prompt, so the rest of the turn runs unguarded in a trusted workspace. | 03 PM-02 | `src/main/claude-agent/claude-agent-adapter.ts:389` |
| 4 | High | Only 11 of ~170 IPC registrations pass through the permission gate; terminal create/write, script run, git discard, checkpoint restore, settings.toml write, agent session open are all ungated. | 04 IPC-02 | `src/main/ipc/handlers.ts:273` |
| 5 | High | A repository committing `.ensemblr/settings.toml.tmp` as a symlink makes the Scripts writer overwrite the link target with repo-authored TOML. Reproduced. | 08 CFG-02 | `src/main/config/repository-settings-writer.ts:155` |
| 6 | High | A repository committing `.context` as a symlink redirects every `ensureContextPath` write (setup marker, raw scrollback) out of the worktree. Reproduced. | 05 FS-01 | `src/main/config/context-directory.ts:52` |
| 7 | High | The action-prompt writer follows a committed symlink at its leaf; content embeds the PR body. | 05 FS-02 | `src/main/workspace-files/context-attachments.ts:183` |
| 8 | High | `restoredFromId` from the terminal-create IPC (no schema) reaches `rmSync` through a URL-based path builder that honours `..`. Needs a compromised renderer. | 08 CFG-03 | `src/main/config/context-directory.ts:35`, `src/main/terminal/terminal-output-file.ts:134` |
| 9 | High | `dictation.baseUrl` is agent-writable via `updateAppSettings` with no host check; the next dictation posts the audio and the stored API key there. Confirmation is skipped in AFK mode. | 07 INT-01 | `src/shared/config.ts:334`, `src/main/agent-control/agent-control-service.ts:1187` |
| 10 | Medium-High | Linux: the SQLite file holding `safeStorage` ciphertext for every secret is created 0644 under `~/.config`; a `basic_text` keyring makes it reversible. | 06 SEC-01 (= 11 DB-06) | `src/main/storage/database.ts:1252` |
| 11 | Medium | `/mcp` checks that a bearer token is *present*, not valid, before serving the 37-tool inventory and playbook (35 KB) and holding a `GET` SSE stream open. | 01 CT-01, CT-02 | `src/main/agent-control/control-server.ts:246`, `:318` |
| 12 | Medium | Sub-agents hold both architecture-diagram ops their playbook says are refused. | 02 CO-02 | `src/shared/agent-control/subagent-policy.ts:34` |
| 13 | Medium | No Content-Security-Policy anywhere; `GrantFileProtocolExtraPrivileges` fuse left default under a `file://` renderer; Electron 44.1.1 vs upstream 44.3.0. | 09 SH-01..03 | `index.html`, `forge.config.ts:382` |
| 14 | Medium | Linux update is digest-only where macOS has Squirrel's signature check. | 07 INT-02 | `src/main/updates/appimage-installer.ts:214` |
| 15 | Medium | The Pi extension intercepts eight hard-coded tool names; any other write tool bypasses Plan Mode unseen. `resolveDisallowedTools` never receives `depth`. | 03 PM-05, PM-06 | see report |

Verified sound (highlights, with the report that checked it): token never trusted from the
caller and never in argv or an MCP file (01, 06); every foreign-id write refused (02);
`ensemblr_exit_plan_mode` cannot self-approve, no ReDoS in the lexer (03); preload exposes only
typed wrappers (04); deletion canonicalises through `realpath` and depth-checks inside the
managed root (05); Infisical layer never reaches native chat agents (06); OAuth PKCE/state/loopback
(07); no `dangerouslySetInnerHTML`, mermaid `strict`, KaTeX refuses `\href`, Lexical plain-text
paste (10); parameterized SQL, escaped `LIKE`, stripped FTS5 grammar (11).

### Performance

| # | Impact | Finding | Report | Where |
| --- | --- | --- | --- | --- |
| 1 | **Critical** | `agent_session_events` is never pruned, compacted or vacuumed: 989 MB / 890k rows after nine days on the maintainer's machine. | 11 DB-01 | `src/main/storage/database.ts:346` |
| 2 | High | 79% of those rows are Pi `extension_ui_request` spinner frames persisted and broadcast verbatim that render nothing; each costs a `BEGIN IMMEDIATE` transaction and two IPC broadcasts. | 13 RT-01 | `src/main/pi-agent/cli-rpc/protocol-dispatch.ts:376` |
| 3 | High | Session open loads the whole branch with no cursor: ~460 ms blocked main thread and a 13.5 MB IPC message for the largest real chat. Payloads are uncapped. | 13 RT-02 (= 11 DB-02, DB-03) | `src/main/agent-runtime/agent-session-service.ts:435` |
| 4 | High | One full `git status --untracked-files=all` per workspace every 30 s, all at once, no dedupe: 60 spawns / 666 ms at 15 workspaces. | 12 MP-02 (= 05 FS-04) | `src/renderer/hooks/workbench-shell/route-layout/use-workbench-queries.ts:106` |
| 5 | High | Boot fires an unbounded `Promise.all` of git probes over every repository during window creation: 48 spawns / ~280 ms at 16 repos. | 12 MP-01 | `src/main/repository/adopt-shared-root/repository-adoption.ts:72` |
| 6 | High | Every command result synchronously redacts its whole stdout and clones its env for a `logs` payload two callers read: 41 ms at the 8 MB cap. | 12 MP-03 | `src/main/commands/spawn-command.ts:126` |
| 7 | High | `waitForAgents` runs a ~500 ms synchronous full-branch scan per target per 250 ms tick for a value it discards. | 02 CO-03 | `src/main/agent-control/port-adapters.ts:914` |
| 8 | High | Shiki tokenizes whole files synchronously, uncapped, twice per diff: a 5k-line diff freezes the renderer ~4.8 s; one long line freezes it for a minute. | 14 RR-01 (= 10 PERF-01) | `src/renderer/lib/code/highlighter.ts:166` |
| 9 | High | The full `logos` (7.1 MB) and `vscode-icons` (3.6 MB) Iconify collections are parsed before first paint to serve 65 icons (79 KB): 254 ms V8 parse on an M-series Mac; 86% of the 13 MB critical-path JS. | 15 WB-01 (= 14 RR-02) | `src/renderer/main.tsx:31`, `src/renderer/lib/workbench/icon-collections.ts:19` |
| 10 | High | Every settled tool-call row in the live turn re-renders on every streamed delta (40/40 measured); every agent session event replaces the live-state map and re-renders the workspace subtree (1.9% memo ratio). | 14 RR-03, 15 WB-03 | `src/renderer/components/chat-assistant-turn.tsx:82`, `src/renderer/state/agents/atoms.ts:118` |
| 11 | High | Organic architecture-diagram layout is super-quadratic: 3.9 s blocked at 100 nodes. | 15 WB-02 | `src/renderer/lib/architecture-diagram/route-ladder.ts:131` |
| 12 | Medium | Terminal scrollback flushed with a synchronous whole-buffer `writeFileSync` every second; output broadcast per PTY chunk with no coalescing; ring copies its chunk array on trim. | 12 MP-04, MP-08, MP-10 | `src/main/terminal/` |
| 13 | Medium | All three locale catalogues eager (548 KB unused per launch); 9.7 MB uncompressed Nerd Font TTF; hidden terminal tabs keep live WebGL contexts; `debug.pi-replay` ships 2 MB into prod. | 15 WB-04..07 | see report |
| 14 | Medium | Diff viewer and timeline are not virtualized; a tab switch remounts the whole transcript. | 14 RR-04, RR-05 | see report |
| 15 | Medium | Duplicate index on `agent_session_events`; per-event transaction with `MAX(ordinal)` probe and read-back (12× a batched write); `PRAGMA synchronous` at FULL. | 11 DB-07, DB-09, DB-10 | `src/main/storage/` |

## Decisions needed before fixing

1. **Which scope owns `security.permissionMode`?** `SECURITY.md`, the UI, and the settings
   resolver say per repository; every consumer reads app scope. Recommendation: repository scope
   with app-scope fallback, and a test that writes through `upsertRepositorySettings` and asserts
   the gate's `getMode()` changes. (Finding 1.)
2. **Is an unbounded transcript a product decision?** If fork/replay needs full history, the
   answer is a materialized snapshot per branch plus tail replay, not deletion. Either way, stop
   admitting spinner frames. (Perf 1–3.)
3. **Should `dictation.*` and `general.automaticUpdates` be agent-writable at all?** If yes,
   restrict `baseUrl` to `https:` or loopback and show the patch in the confirmation. (Finding 9.)
4. **Linux secrets at rest:** accept 0644 + `basic_text` on single-user machines, or `chmod 0600`
   and refuse to write secrets when the keyring backend is `basic_text`. (Finding 10.)
5. **Linux update integrity:** accept the GitHub-only trust model and say so in
   `docs/build-and-release.md`, or sign AppImages. (Finding 14.)

## Suggested fix order

1. Permission-mode scope (Finding 1) + gate the ungated write channels (Finding 4) — one change
   restores the whole permission model.
2. Plan Mode: drop `sort` from the allowlist or guard `--compress-program`; re-assert `plan` in
   `forward()` when `ExitPlanMode` is observed (Findings 2, 3).
3. `lstat` + realpath containment in the three `.context` writers and an `O_EXCL` temp file in
   the TOML writer (Findings 5–8) — the codebase already has the pattern in `plan-file-writer.ts`.
4. Stop persisting `extension_ui_request` frames; add a retention/compaction path and a replay
   cursor (Perf 1–3).
5. Ship the 65 icons the app uses instead of two full collections (Perf 9) — the largest single
   win for startup.

## Reports

| File | Dimension | Findings |
| --- | --- | --- |
| `01-control-transport-and-identity.md` | Loopback server, MCP endpoint, origin registry, guardrails, Pi extensions | 3 M, 3 L, 1 I |
| `02-control-ops-and-ports.md` | Per-op authorization, ports, Linear/review/architecture ports | 2 H, 1 M, 3 L, 1 I |
| `03-plan-mode-enforcement.md` | Bash guard (294 probes), tool guard, Claude/Pi seams, exit-plan flow | 1 C, 1 H, 4 M, 2 L, 2 I |
| `04-ipc-bridge-and-handlers.md` | Preload bridge, every IPC handler, Zod schemas, permission gate | 2 H, 4 M, 4 L, 1 I |
| `05-filesystem-git-and-process-exec.md` | Paths, symlinks, git/gh argv, deletion scope, open targets | 2 H, 3 M, 4 L, 1 I |
| `06-secrets-environment-and-redaction.md` | Secret store, env layering, Infisical, redaction, every sink | 1 MH, 2 M, 3 L, 1 perf |
| `07-integrations-oauth-updates-build.md` | Linear OAuth + asset proxy, gh, dictation, updater, signing, CI, npm audit | 1 H, 4 M, 7 L, 3 I |
| `08-config-scripts-terminal-setup.md` | settings.toml capabilities, config writers, scripts, PTY, setup checks | 1 C, 2 H, 5 M, 4 L |
| `09-electron-shell-deeplinks-supply-chain.md` | Electron checklist, CSP, fuses, deep links, dependency audit | 4 M, 8 L, 1 I |
| `10-renderer-untrusted-content.md` | Every rendering surface vs 38 payloads, link handling, localStorage trust | 1 H(perf), 4 L, 3 I |
| `11-storage-and-persistence.md` | Schema, migrations, SQL safety, growth, replay, PRAGMAs (measured on the live DB) | 1 C, 3 H, 5 M, 3 L |
| `12-main-process-event-loop.md` | Boot sequence, timers, fan-out, sync fs, spawn storms (measured) | 3 H, 5 M, 5 L |
| `13-agent-runtime-pipeline.md` | Parse → persist → broadcast → reduce, session open, lifecycle (measured) | 2 H, 3 M, 2 L |
| `14-renderer-conversation-rendering.md` | Streaming re-render path, Shiki, diff viewer, timeline (render-counted) | 3 H, 4 M, 5 L |
| `15-renderer-workbench-and-bundle.md` | Bundle (built), broadcast fan-out, diagram layout, i18n, fonts, terminal dock | 3 H, 3 M, 2 L |

Counts are as each auditor ranked them; the tables above re-rank after de-duplication.
