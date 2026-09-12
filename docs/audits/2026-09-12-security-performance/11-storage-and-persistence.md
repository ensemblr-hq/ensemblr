# Storage & Persistence — SQLite schema, migrations, repositories, event log

Every SQL statement in `src/main/` is parameterized: the two dynamic `SET` builders
(`agent-session-repository.ts:318`, `concierge-session-repository.ts:301`) emit hardcoded column
literals and bind only values, the one `LIKE` search escapes `%`/`_` with an explicit `ESCAPE`
clause, and the one FTS5 `MATCH` strips every character that could reach the query grammar.
There is no SQL injection here, and foreign keys, cascades, and migration idempotency are each
covered by a test.

The problems are all on the performance and lifecycle side, and they are large. The author's own
database is **989 MB after nine days of use** — 890,305 rows in `agent_session_events` (732 MB of
table, 202 MB of index) accumulated between 2026-09-03 and 2026-09-12, with **no pruning path
anywhere in the codebase**, `auto_vacuum = NONE`, and no `VACUUM`/`PRAGMA optimize` ever issued.
Opening the largest chat tab in that database blocks the main process for a measured **255 ms** and
ships a **12.8 MB** IPC message, because the replay handler reads the whole branch with no cursor,
no limit, and no snapshot.

12 findings: 1 Critical, 3 High, 5 Medium, 3 Low/Info.

## Schema map

Measurements are from a read-only copy of the author's live database (`PRAGMA page_size = 4096`,
`page_count = 241,655`, `freelist_count = 0`, `user_version = 28`), taken 2026-09-12.

| Table | Purpose | Key columns | Indexes | Growth | Pruning | Secret-bearing text |
| --- | --- | --- | --- | --- | --- | --- |
| `agent_session_events` | Append-only agent transcript; source of truth for chat replay | `branch_id`, `ordinal`, `event_type`, `payload_json` | PK autoindex, `UNIQUE(branch_id,ordinal)` autoindex, `_branch_ordinal` (**duplicate**), `_turn_id`, `_type` (**unused**) | per-event, unbounded — **732 MB / 890,305 rows / 9 days** | **none** | **yes** — `payload_json` holds verbatim tool output (anything an agent read: `.env`, `gh auth token`, terminal text) |
| `concierge_session_events` | Concierge transcript | `session_id`, `ordinal`, `payload_json` | `_session_ordinal`, `_type`, 2 autoindexes | per-event, unbounded — 31 MB / 82,276 rows / 9 days | **none** | yes, same mechanism |
| `agent_sessions` / `agent_session_branches` / `agent_turns` | Session, branch, turn metadata | `workspace_id`, `status`, `runtime_session_id` | `_workspace_id`, `_status`, `_runtime_session_id`, `_provider`, `_branch_ordinal` | per-session (471 rows) | cascade only on workspace delete | no |
| `chat_tabs` | Tab strip, open and closed | `workspace_id`, `closed_at`, `position`, `metadata_json` | `_workspace_id`, `_session_id`, `_open(workspace_id,closed_at)` | per-tab, closed tabs kept forever (488 rows) | none | no (titles only) |
| `workspaces` / `repositories` | Core aggregates | `path`, `slug`, `archived_at` | `_repository_id`, `_archived_at`, `_remote_url` (partial) | bounded (132) | explicit delete + cascades | no |
| `checkpoints` | Git refs per turn | `workspace_id`, `agent_session_id`, `turn_id` | 3 FK indexes + unique `_turn_id` | per-turn (814 rows) | cascade on workspace delete | no |
| `comments` / `todos` | Review diff comments and todos | `workspace_id`, `file_path`, `body` | `_workspace_id`, `_session_id`, `_checkpoint_id`, `_status` | per-review (380 rows) | explicit delete | body is user/agent prose — treat as yes |
| `terminal_sessions` | Terminal tab rows (no scrollback) | `workspace_id`, `status` | `_workspace_id`, `_session_id` | per-terminal (352 rows, 49 B avg metadata) | cascade | no |
| `integration_metadata` | GitHub PR cache + Linear/workspace links | `provider`, `resource_type`, `resource_id` | `_provider`, unique 4-col autoindex | per-workspace, upserted (280 rows, 61 KB max) | `DELETE` on branch continue / repo delete | no |
| `linear_issues` / `_comments` / `_resources` / `_sync_state` | Linear cache, per account | `account_id`, `identifier`, `team_id` | 5 indexes | per-sync (408 issues) | delete on issue removal | issue bodies — assume yes |
| `linear_accounts` | OAuth account identity | `organization_id`, `user_id` | unique autoindex | bounded | explicit delete | **no tokens** (platform secret store) |
| `secret_metadata` | Secret index + Linux ciphertext | `scope`, `name`, `secret_value BLOB` | `_scope`, 2 unique autoindexes | bounded (9 rows, 0 `secret_value` on macOS) | explicit delete | **yes on Linux** — `safeStorage` ciphertext by design (ADR 0056) |
| `concierge_memories` + `_fts` (FTS5) | Memory index, derived from disk | `slug`, `body`, `content_hash` | `_kind`, `_updated_at`, unique `slug`; FTS5 `unicode61` | per-memory (42 rows) | rebuilt from files | yes (memory prose) |
| `agent_control_spawn_reservations` | Lifetime + rolling spawn quota | `root_session_id`, `reserved_at` | `_root_time` | per-spawn, **never pruned**, no FK (164 rows) | refund-on-failure only | no |
| `settings` / `root_directories` / `archive_records` / `infisical_*` / `process_records` / `schema_migrations` | Config, roots, archive history, links, migrations | various | scope/status indexes | bounded | explicit | no |

## Findings

### [DB-01] The agent event log grows without bound and is never pruned, compacted, or vacuumed

- Impact (performance): **Critical** — Confidence: **Confirmed** (measured against the author's live database)
- Where: `src/main/storage/database.ts:346` (table), `src/main/agent-runtime/agent-session-persistence.ts:97` (the only writer), `src/main/storage/database.ts:1370` (pragmas — no `auto_vacuum`, no maintenance)

**What.** Nothing in `src/` deletes an event, a branch, a turn, or a closed session. `DELETE FROM`
across the whole repository layer returns twelve statements, none touching `agent_session_events`
or `concierge_session_events`. `deleteAgentSession` exists but has one caller — the rollback path in
`session/session-open.ts:233` when session creation fails. Archiving a workspace
(`archive-workspace.ts:681`) deliberately keeps every row so unarchive can restore. The only way a
transcript leaves the database is a hard workspace or repository delete. There is also no `VACUUM`,
no `PRAGMA optimize`, no `ANALYZE`, and no manual checkpoint anywhere in `src/` or `scripts/`, and
`auto_vacuum` is `0` (NONE) — so even after a delete the file keeps its size and the freed pages sit
on the freelist.

**Mechanism, with numbers.** The author's database at the time of audit:

| | |
| --- | --- |
| File size | 989,548,544 B (989 MB), `freelist_count = 0` — all live |
| `agent_session_events` | 732 MB table + 202 MB of indexes = **94% of the file** |
| Rows | 890,305 across 471 sessions (1,890 events/session average) |
| Time window | 2026-09-03 → 2026-09-12 — **nine days** |
| Implied rate | ~99,000 events/day, **~110 MB/day → ~40 GB/year** of daily use |
| Payload bytes | 507 MB total, 597 B mean, 1,015,249 B max |

`concierge_session_events` adds 31 MB / 82,276 rows over the same nine days, by the same mechanism.

**Existing guards & tests checked.** `tests/main/database.test.ts:548` proves workspace deletion
cascades to agent sessions and the cascades are live ([verified sound](#verified-sound)) — but a
user who never deletes a workspace never triggers them. `DatabaseHealthSnapshot`
(`src/shared/ipc/contracts/health.ts`) reports `path`, `schemaVersion`, and `status` and **not
size**, so nothing tells the user the file has reached a gigabyte.

**Fix.** In order of value: (a) a retention policy — delete events for sessions closed longer than N
days, or keep the last N per branch and replace the prefix with a synthesized summary event;
(b) surface `page_count * page_size` in `DatabaseHealthSnapshot`; (c) `PRAGMA optimize` on close and
`VACUUM` behind an explicit maintenance action, since `auto_vacuum` cannot be enabled on an existing
file without a full vacuum anyway.

### [DB-02] Chat replay reads the entire branch with no cursor or limit, blocking main for 255 ms and shipping 12.8 MB over one IPC message

- Impact (performance): **High** — Confidence: **Confirmed** (benchmarked against the live database)
- Where: `src/main/ipc/handlers/agent-session.ts:317`, `src/main/agent-runtime/agent-session-service.ts:435`, `src/main/ipc/request-schemas/agent-session.ts:89`

```ts
const request = listAgentSessionEventsRequestSchema.parse(raw);   // { branchId: string }
const rows = agentSessionService.listEvents(request.branchId);    // whole branch
const events: AgentSessionEventWire[] = rows.map((row) => ({ ... }));
return Promise.resolve({ events });
```

**What.** The request schema is `z.object({ branchId: z.string().min(1) })` — no `fromOrdinal`, no
`limit`, no `since` cursor. `listEventsByBranch` *supports* both parameters
(`agent-event-repository.ts:206`), and the service calls it with neither. Every chat-tab open reads
every row the branch has ever had, `JSON.parse`s each `payload_json` on the main thread, allocates
one object per row, and hands the whole array to Electron's structured cloner in a single reply.
There is no snapshot or materialized-summary table to replay from.

**Mechanism.** Benchmarked with `node:sqlite` against the copied database, replicating
`listEventsByBranch` + `mapEventRow` on the largest branch (warm cache, M-series Mac, Node 26):

```
branch events=26922
sqlite all():           184 ms
map + JSON.parse:        46 ms
serialize (IPC proxy):   24 ms   ← JSON.stringify; structured clone costs more
payload size:          12.8 MB
TOTAL main-thread block: 255 ms
heap after:             200 MB
```

The distribution is not a tail case: median branch is 421 events, but **p95 is 12,446** and 27
branches exceed 10,000. Every one of those 255 ms is a stalled main event loop — every pending IPC
reply, every other window message, and the streaming broadcast of any *other* running agent waits.

**Existing guards & tests checked.** None. `listEvents` does filter checkpoint-hidden ordinals
(`agent-session-service.ts:438`) but only *after* loading everything. `iterateBranchPayloadsDescending`
(`agent-event-repository.ts:255`) shows the team already knows how to stream a branch lazily — it is
used for activity snapshots, not for replay.

**Fix.** Add `fromOrdinal` and `limit` to the request schema and page the replay backwards from the
newest ordinal, loading older pages on scroll. The repository already accepts both arguments, so
this is a handler and renderer change, not a storage one.

### [DB-03] Event payloads are stored verbatim with no size cap, so one tool result can be a multi-megabyte row that is re-shipped on every replay

- Impact (performance) / Severity (security): **High** — Confidence: **Confirmed**
- Where: `src/main/agent-runtime/agent-session-persistence.ts:110`, `src/shared/ipc/contracts/agent-message-payloads.ts:96`, `src/main/storage/repositories/agent-event-repository.ts:323`

```ts
| { isError: boolean; kind: 'tool-result'; output: unknown; toolCallId: string }
//                                         ^ whatever the tool produced, verbatim
```

**What.** `serializePayload` `JSON.stringify`s the envelope and writes it; the only failure mode it
handles is an unserializable value (falls back to `'{}'`). No truncation, no byte budget, no
per-event ceiling anywhere between the adapter and the column. The nearest cap is
`DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024` in `src/main/pi-agent/pi-cli-rpc-adapter.ts:46`, which
bounds one RPC *line* — so a single Pi event row may legitimately be up to 16 MB.

**Mechanism.** In the live database, 476 rows exceed 100 KB and hold **123 MB between them**; the
largest is 1,015,249 B — and that ceiling is the Claude SDK's own internal tool-output limit, not
anything this repo enforces. A `cat` of a large log, a `find /`, or a wide `git diff` lands in one
row. Because [DB-02] replays the whole branch, that row is re-read, re-parsed, and re-cloned over
IPC on *every* open of that chat for the life of the session.

The security dimension is the same row: `payload_json` is the verbatim text an agent saw, including
any secret that appeared in terminal output, a `.env` read, or a `gh auth token` call. That is
accepted design (the transcript has to be faithful) and the secrets sibling owns redaction — but it
is what makes [DB-06]'s file mode load-bearing, and why a never-pruned log is a confidentiality
question as well as a disk one.

**Existing guards & tests checked.** `tests/main/agent-event-payload.test.ts` covers envelope
mapping, not size. No cap exists in `src/main/agent-runtime/`.

**Fix.** Cap `payload_json` at write time — a few hundred KB per event — and replace the tail with a
truncation marker the renderer can render as "output truncated (N KB)". The full output is already
on the user's disk or scrollback; the transcript does not need to be the archive of record.

### [DB-04] `withTransaction` opens a deferred `BEGIN` where every repository uses `BEGIN IMMEDIATE`, and its rollback masks the original error

- Impact: **Medium** — Confidence: **Likely** (code confirmed; the concurrency trigger is dev-only)
- Where: `src/main/storage/tx.ts:13`

```ts
	database.exec('BEGIN');           // ← deferred, not IMMEDIATE
	try {
		const result = fn();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		database.exec('ROLLBACK');    // ← can throw, replacing `error`
		throw error;
	}
```

**What.** Two transaction styles coexist: `withTransaction` (11 call sites, all multi-table
workspace mutations — create, archive, unarchive, rename, delete, continue-branch) uses a
**deferred** `BEGIN`, while all fourteen repository-internal transactions use `BEGIN IMMEDIATE`
(`agent-event-repository.ts:88`, `chat-tab-repository.ts:100`, `agent-session-repository.ts:197`,
`agent-control-spawn-repository.ts:32`, and others). A deferred transaction that reads before it
writes must promote its read lock; in WAL mode, if another connection committed since the read
snapshot, SQLite returns `SQLITE_BUSY_SNAPSHOT` **immediately** — `busy_timeout = 5000` does not
apply to a promotion failure. The repositories use `IMMEDIATE` precisely to avoid this; the helper
wrapping the heaviest multi-table writes does not.

**Scenario.** Packaged builds hold a single-instance lock (`main.ts:308`), so this cannot bite a
release user. **Dev builds are explicitly excluded** from that lock — `const hasSingleInstanceLock
= isDev || app.requestSingleInstanceLock()` — and every dev instance opens the same
`devDatabasePath`. Two dogfooding instances, one archiving a workspace while the other persists an
agent event, and the archive fails with an opaque `SQLITE_BUSY` that no retry path catches.

Separately and on every platform: if the transaction was already auto-rolled-back by SQLite (an I/O
error, `SQLITE_FULL`), the `ROLLBACK` in the catch throws *"cannot rollback — no transaction is
active"*, and that secondary error propagates in place of the real cause. Every one of the fourteen
raw-`BEGIN` sites has the same shape.

**Fix.** `BEGIN IMMEDIATE` in `withTransaction`, matching the repositories, and wrap the rollback in
its own `try`/`catch` so the original error survives.

### [DB-05] An older build silently opens a database migrated by a newer one — and release and canary share the same file

- Severity (data integrity): **Medium** — Confidence: **Confirmed** (path sharing) / **Likely** (harm)
- Where: `src/main/storage/database.ts:1383`, `:1226`, `src/main/app/user-data-location.ts:52`

```ts
	const appliedMigrationIds = new Set(listAppliedMigrationIds(database));
	for (const migration of MIGRATIONS) {
		if (appliedMigrationIds.has(migration.id)) continue;
		runMigration(database, migration);
	}
	return getCurrentSchemaVersion(database);   // ← no comparison against LATEST_SCHEMA_VERSION
```

**What.** The runner skips ids it already sees and never compares `user_version` against
`LATEST_SCHEMA_VERSION`. A database at version 30 opened by a binary that knows 28 applies nothing,
reports `schemaVersion: 30`, `status: 'ok'`, and proceeds — against a schema with tables, columns,
and `CHECK` constraints it does not know. `linear-store.ts` reads with `SELECT *`, and several
migrations drop and recreate tables (`chat_tabs` three times, `secret_metadata`, `root_directories`),
so the older build's `INSERT` column lists are the ones at risk.

**Scenario.** `resolveDefaultDatabasePath` is channel-independent — it hardcodes
`~/Library/Application Support/dev.ensemblr.app/ensemblr.db` with no channel component, and only
`isDev` gets an override (`main.ts:380`). So **release and canary share one database file**, which
`user-data-location.ts:52` states outright ("they already share one database file"). Canary is by
construction ahead of release. Run Canary once, then launch Release, and Release is running against
Canary's schema. A downgrade via the updater does the same thing.

**Existing guards & tests checked.** `tests/main/database.test.ts:343` proves migrations are
idempotent on reopen, and `:622` proves migration 014's data carry — both forward paths. Nothing
tests the backward one. The single-instance lock prevents the two channels running *simultaneously*,
not sequentially.

**Fix.** In `openEnsemblrDatabase`, refuse to open when `getCurrentSchemaVersion(database) >
LATEST_SCHEMA_VERSION`, returning a `DatabaseHealthSnapshot` with an error that names both versions
and tells the user to run the newer build.

### [DB-06] The database directory and file are created with default modes, and on Linux the file carries `safeStorage` secret ciphertext

- Severity (security): **Medium** — Confidence: **Confirmed** on macOS, **Likely** on Linux
- Where: `src/main/storage/database.ts:1252` — `mkdirSync(path.dirname(databasePath), { recursive: true })`

**What.** No `mode` argument, and no `chmod` after SQLite creates the file — so the directory is
`0777 & ~umask` (0755 with the usual 022) and the `.db`, `-wal`, and `-shm` files are `0644`.
Verified on the author's machine:

```
drwxr-xr-x  dev.ensemblr.app
-rw-r--r--  ensemblr.db       (989 MB)
-rw-r--r--  ensemblr.db-wal
```

**Scenario.** On macOS the parent `~/Library/Application Support` is `0700`, so another local user
cannot traverse to it and the exposure is limited to anything that copies the tree with modes
intact (a backup, a sync client, a support bundle). **On Linux it is materially worse**: the path
is `~/.config/ensemblr/`, `~/.config` is not reliably `0700` across distributions, and on Linux
this file is where secrets actually live — `secret_metadata.secret_value` holds `safeStorage`
ciphertext rather than a Keychain reference (ADR 0056, migration `023_secret_value_blob`). When
Electron's selected backend is `basic_text` — no gnome-keyring or kwallet present, which
`safe-storage-health.ts:42` already flags as a warning — that ciphertext is obfuscated with an
upstream-hardcoded key. A world-readable file plus a public key is a plaintext secret. On top of
that the same file holds 507 MB of verbatim agent transcript ([DB-03]).

**Fix.** `mkdirSync(dir, { recursive: true, mode: 0o700 })`, and `chmodSync` the `.db`, `-wal`, and
`-shm` to `0o600` after open. Both are one-liners and neither changes behaviour for an existing
correctly-permissioned install.

### [DB-07] `idx_agent_session_events_branch_ordinal` exactly duplicates the `UNIQUE(branch_id, ordinal)` autoindex — 47.7 MB and a write on every append

- Impact (performance): **Medium** — Confidence: **Confirmed**
- Where: `src/main/storage/database.ts:358` (original), `:664` (recreated after the 014 rename), against `UNIQUE(branch_id, ordinal)` at `:355`

**What.** The table declares `UNIQUE(branch_id, ordinal)`, which SQLite implements as
`sqlite_autoindex_agent_session_events_2` over exactly those two columns in that order. The explicit
`CREATE INDEX ... ON agent_session_events(branch_id, ordinal)` is the same index. `dbstat` confirms
it — identical size, identical cell count:

```
sqlite_autoindex_agent_session_events_2 | 47,722,496 | 890,305
idx_agent_session_events_branch_ordinal | 47,722,496 | 890,305
```

**Mechanism.** 47.7 MB of dead weight, plus one extra b-tree insert and one extra page write per
event append — on a table that takes ~99,000 appends a day. The query planner picks one of the two
and ignores the other (`EXPLAIN QUERY PLAN` on the replay query resolves to the explicit index;
either would serve).

Alongside it, **`idx_agent_session_events_type` (16.6 MB) has no reader at all**: `grep` for
`event_type` across `src/main/` outside `database.ts` returns only column lists in `SELECT`/`INSERT`
statements and row-shape declarations — no `WHERE event_type`, no `GROUP BY event_type`. It costs a
third write per append and buys nothing. (`idx_agent_session_events_turn_id`, by contrast, *is*
load-bearing even though `listEventsByTurn` has no caller: `turn_id REFERENCES agent_turns(id) ON
DELETE SET NULL` needs it so a turn delete does not scan 890k rows. Keep that one.)

**Fix.** One migration dropping `idx_agent_session_events_branch_ordinal` and
`idx_agent_session_events_type`. Reclaims ~64 MB on the author's database and removes two of the
four index writes per event.

### [DB-08] `listAllChatTabs` full-scans `chat_tabs` and sorts in a temp b-tree, on a table nothing ever prunes

- Impact (performance): **Medium** — Confidence: **Confirmed**
- Where: `src/main/storage/repositories/chat-tab-repository.ts:370`

```ts
`${SELECT_TAB} WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT ?`
```

**What.** There is no index on `closed_at`. `idx_chat_tabs_open(workspace_id, closed_at)` cannot
serve a query with no `workspace_id` predicate. `EXPLAIN QUERY PLAN` confirms:

```
--SCAN chat_tabs
`--USE TEMP B-TREE FOR ORDER BY
```

**Mechanism.** `SELECT_TAB` projects `metadata_json` and `full_title`, so the scan is over the wide
row, not a covering index — the live table is 1.5 MB for 488 rows (~1.9 KB/row). Closed tabs are
never deleted, so the scan cost grows monotonically with the user's lifetime tab count: at 10,000
closed tabs this is a ~19 MB read and a full sort every time the history list is drawn, on the main
thread.

**Fix.** `CREATE INDEX idx_chat_tabs_closed_at ON chat_tabs(closed_at DESC) WHERE closed_at IS NOT
NULL` — a partial index the `LIMIT` can walk, ending the scan and the temp b-tree.

### [DB-09] Each event append is its own transaction with a `MAX(ordinal)` probe and a read-back — 12× the cost of a batched write

- Impact (performance): **Medium** — Confidence: **Confirmed** (benchmarked)
- Where: `src/main/storage/repositories/agent-event-repository.ts:88`

```ts
database.exec('BEGIN IMMEDIATE');
const next = database.prepare(
    `SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM agent_session_events WHERE branch_id = ?`,
).get(input.branchId) as { next: number };
database.prepare(`INSERT INTO agent_session_events ...`).run(...);
database.exec('COMMIT');
const row = getEventById({ database, id });   // ← extra SELECT after COMMIT
```

**What.** Four statements and one durable commit per persisted event: `BEGIN IMMEDIATE`, a
`MAX(ordinal)` seek, the `INSERT`, `COMMIT`, then a primary-key `SELECT` to return the row the
caller just supplied every field of. `appendAgentEvents` (the batched variant, `:127`) exists and is
correct, but nothing calls it — `persistRuntimeEvent` goes one at a time.

**Mechanism.** Benchmarked on a temp database with the app's exact pragmas and the
`agent_session_events` schema, 1,000 appends with a 600-byte payload:

| `synchronous` | 1,000 single appends | 1,000 in one transaction |
| --- | --- | --- |
| default (`2`/FULL) | **214 ms** (0.21 ms/event) | **18 ms** |
| `NORMAL` (`1`) | 148 ms (0.15 ms/event) | 8 ms |

0.21 ms of blocked main loop per event is not a crisis on an APFS SSD; it is meaningful because it
is paid ~99,000 times a day and it happens while the same thread is broadcasting the stream. Note
that streaming *deltas* are correctly **not** persisted (`handle-runtime-event.ts:95`,
`tryBroadcastDelta` returns before `persistRuntimeEvent`) — this is per finalized event, not per
token, which is the right design.

**Fix.** Track the branch's next ordinal in the already-existing `ActiveSession` state (it holds
`lastBroadcastOrdinal` for exactly this shape of bookkeeping) to drop the `MAX` probe; return the
row the caller already has instead of re-selecting it; and coalesce bursts within a turn through
`appendAgentEvents`.

### [DB-10] `PRAGMA synchronous` is never set, so every commit fsyncs the WAL at `FULL`

- Impact (performance): **Low** — Confidence: **Confirmed** (measured; `PRAGMA synchronous` reads back as `2`)
- Where: `src/main/storage/database.ts:1370`

```ts
	database.exec(`
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
`);                                  // ← no synchronous, temp_store, cache_size, optimize
```

**What.** WAL is set but `synchronous` is left at SQLite's compile-time default of `2` (FULL),
confirmed by reading the pragma back on a freshly opened database with this exact sequence. In WAL
mode, `NORMAL` is the documented recommendation: it fsyncs at checkpoint rather than at every
commit, and the durability it gives up is the last few transactions on a *power loss* — not
corruption, and not a process crash.

**Mechanism.** Measured at 0.21 ms/append at FULL against 0.15 ms at NORMAL — a 30% reduction, but
0.06 ms in absolute terms, which is why this is Low and not the headline I expected. It matters more
than the benchmark suggests on a slow or network-backed home directory, and it compounds with
[DB-09]'s one-commit-per-event.

Also absent and worth adding in the same call: `PRAGMA temp_store = MEMORY` (the several
`USE TEMP B-TREE FOR ORDER BY` plans spill to disk otherwise), a `cache_size` above the 2 MB
default for a 989 MB file, and `PRAGMA optimize` on `close()` (`database.ts:1319`).

**Fix.** Add `PRAGMA synchronous = NORMAL;` and `PRAGMA temp_store = MEMORY;` to
`configureDatabase`, and `PRAGMA optimize` to `close`.

### [DB-11] `agent_control_spawn_reservations` rows have no foreign key and are never swept

- Impact: **Low** — Confidence: **Confirmed**
- Where: `src/main/storage/database.ts:1205` (`root_session_id TEXT NOT NULL` — no `REFERENCES`), `src/main/storage/repositories/agent-control-spawn-repository.ts:70`

**What.** The migration comment is explicit that reservations "remain for the tree lifetime,
including across app restarts", and `refundAgentControlSpawn` deletes only a single row after a
failed spawn creation. With no `REFERENCES agent_sessions(id)`, deleting a workspace cascades away
the session rows and leaves the reservations orphaned. Nothing sweeps by age — the rolling-window
query filters `reserved_at >= ?` but never deletes below it.

**Mechanism.** ~60 B/row, capped at 20 per tree, so the table is 164 rows today: a housekeeping
issue rather than a size one. The correctness angle is that quota accounting outlives the sessions
it describes, leaving a permanent record of every spawn the user ever made (ids are UUIDs, so there
is no reuse collision).

**Fix.** Delete rows older than the rolling window plus a margin inside
`reserveAgentControlSpawn` — it already holds a write transaction, so it is free. Adding the FK
would need a table rebuild and is not worth it on its own.

### [DB-12] `PRAGMA user_version` is set by string interpolation

- Severity: **Info** — Confidence: **Confirmed** (not exploitable)
- Where: `src/main/storage/database.ts:1430` — `database.exec(\`PRAGMA user_version = ${migration.version};\`)`

The only interpolated SQL in the codebase carrying a value rather than a schema literal. Not
injectable: `migration.version` is a numeric literal in the `MIGRATIONS` const array, and SQLite
does not accept a bound parameter in a `PRAGMA` assignment, so interpolation is the only option.
Recorded so the next reader who greps for `exec(\`` need not re-derive that it is safe; a
`Number.isInteger` assertion before the `exec` would make the invariant local.

## Verified sound

- **Every SQL statement is parameterized.** Both dynamic `SET` builders assemble hardcoded column
  literals and bind only values: `agent-session-repository.ts:318-345` (`fields.push('status = ?')`)
  and `concierge-session-repository.ts:301` (`assign('status', patch.status)`, where `assign`
  receives a literal). No caller key ever reaches SQL text. The only `.exec()` calls with a template
  literal are `database.ts:1371` (pragmas), `:1404` (`schema_migrations` DDL), `:1424`
  (`migration.sql`, a const), and `:1430` ([DB-12]).
- **FTS5 `MATCH` cannot be injected.** `toMatchExpression` (`concierge-memory-repository.ts:355`)
  splits on `/[^\p{L}\p{N}_-]+/u`, deleting `"`, `*`, `:`, `^`, `(`, and `)` before the terms are
  quoted — the FTS5 query grammar is unreachable from user text, exactly as its JSDoc claims.
- **`LIKE` wildcards are escaped.** `escapeLikePattern` (`linear-store.ts:562`) backslash-escapes
  `%` and `_`, and all three predicates declare `ESCAPE '\'` (`:242-244`) — a search for `%` is a
  literal search, not a match-everything.
- **Foreign keys are on, twice.** `enableForeignKeyConstraints: true` in the `DatabaseSync`
  constructor (`database.ts:1258`) *and* `PRAGMA foreign_keys = ON` (`:1372`). Enforcement is tested
  at `tests/main/database.test.ts:372` and the workspace → session → branch → event cascade at
  `:548`. The cascades are live, not decorative.
- **Migrations are transactional and idempotent.** `runMigration` (`database.ts:1420`) wraps each in
  `BEGIN IMMEDIATE` … `COMMIT` with `ROLLBACK` on throw, records the id in `schema_migrations`
  inside the same transaction, and skips applied ids on reopen (`tests/main/database.test.ts:343`).
  The four table-rebuild migrations (`chat_tabs` ×3, `secret_metadata`, `root_directories`) do
  `CREATE new → INSERT SELECT → DROP old → RENAME` inside that transaction, so an interruption rolls
  back rather than losing rows; migration 014's `pi_*` → `agent_*` carry is tested at `:622`. Two
  carry a comment explaining the `chat_tabs_new` ordering that stops `ON DELETE SET NULL` firing
  mid-rebuild — a real hazard, correctly handled.
- **`STRICT` on every table**, so a type mismatch is a write-time error rather than a coerced column.
- **Streaming deltas are not persisted.** `tryBroadcastDelta` (`handle-runtime-event.ts:95`) returns
  before `persistRuntimeEvent`, so per-token deltas are broadcast and dropped and only the
  authoritative final message is written. Without this the log would be far larger than 989 MB.
- **JSON reads are defensive and cannot pollute prototypes.** `parseMetadata`
  (`metadata-json.ts:25`), `parsePayload` (`agent-event-repository.ts:337`), and `parseProjects`
  (`concierge-memory-repository.ts:111`) each `try`/`catch` to an empty value, and `parseMetadata`
  additionally rejects arrays and non-objects. No hand-rolled recursive merge consumes the result —
  call sites spread, which defines rather than assigns — so a crafted `__proto__` key is inert.
- **Board status is in memory, not SQLite.** `createBoardStatusStore`
  (`agent-control/board-status-store.ts:47`) validates every value against
  `WORKSPACE_BOARD_STATUSES`; nothing reaches the database from that path.
- **Query plans are indexed where it counts.** `EXPLAIN QUERY PLAN` against the live copy: replay
  and the ordinal probe use `idx_agent_session_events_branch_ordinal` (the latter covering);
  sessions-per-workspace, open-tabs-per-workspace, terminal-sessions-per-workspace,
  checkpoint-by-turn, spawn counting, and the workspace ⋈ `integration_metadata` navigation join all
  resolve to index searches. [DB-08] is the one miss.

## Coverage

Read fully: all 20 files under `src/main/storage/**`, `src/main/app/user-data-location.ts`,
`agent-runtime/agent-session-persistence.ts`, `agent-runtime/session/handle-runtime-event.ts`,
`ipc/handlers/agent-session.ts`, `ipc/request-schemas/agent-session.ts`,
`agent-control/board-status-store.ts`, `secrets/safe-storage-backend.ts`,
`shared/ipc/contracts/agent-message-payloads.ts`, `shared/ipc/contracts/health.ts`, `SECURITY.md`.

Surveyed by targeted grep for SQL construction, transaction style, and growth: `linear-store.ts`,
`linear-account-store.ts`, `sqlite-metadata-store.ts`, `github/pr-cache.ts`,
`repository/issue-cache.ts`, `repository/workspace-row-ops.ts`, `repository/delete-*.ts`,
`repository/archive-workspace.ts`, `agent-runtime/agent-session-service.ts`,
`agent-runtime/session/session-activity-snapshot.ts`, `main/main.ts` (database wiring, instance lock).

Measured against a `/tmp` copy of the author's live database (read-only; counts, sizes, and plans
only — no row contents read or printed, copy deleted afterwards): `dbstat` per-object sizes, row
counts, payload-length distribution, per-branch event distribution, event-type breakdown, and
`EXPLAIN QUERY PLAN` for 13 queries. Two `/tmp` benchmarks: replay cost on the largest real branch,
and append cost on a synthetic schema with the app's exact pragmas at three `synchronous` levels. No
repository file was modified, no test suite was run, and the app was not started.

## Open questions

1. **Is an unbounded transcript a product decision?** [DB-01] assumes not, but a fork/replay model
   built on an append-only log may require full history. If so the answer is snapshot-plus-tail (a
   materialized state row per branch, replayed forward) rather than deletion — which also resolves
   [DB-02]. Whoever owns checkpoint/fork semantics should pick.
2. **Should release and canary share one database?** `user-data-location.ts:52` argues for shared
   `userData` so a canary sees the release's recents, and the database follows. Sound for *forward*
   movement, unsafe backward ([DB-05]). A downgrade guard preserves the intent; a per-channel
   database would not.
3. **What retention does the user expect for `concierge_session_events`?** It grows by the same
   mechanism as [DB-01] at a third the rate, but Concierge *memory* is file-backed and rebuildable
   (`concierge-memory-repository.ts:28`), so the session transcript may be genuinely disposable.
4. **Does `iterateBranchPayloadsDescending` finalize promptly on an early break?** It calls
   `.iterate()` and yields inside the loop (`agent-event-repository.ts:255`); on one shared
   connection that is worth confirming against `node:sqlite`'s iterator semantics before relying on
   it for the paging fix in [DB-02].
