# Agent-Control Transport, Identity, Guardrails, and the Shipped Pi Extensions

Covered the loopback control server and its two bridges (`POST /invoke`, `/mcp`), the origin
registry and token lifecycle, durable lineage, fork-bomb guardrails, the token's path into every
agent species (native Pi, native Claude, three terminal harnesses, Concierge), and both shipped Pi
extensions.

Headline: **`/mcp` is authenticated in name only.** The server requires an `Authorization: Bearer`
header to be *present* but never validates it before building and answering a request, so any
local caller sending `Bearer x` receives the full 37-tool inventory plus the orchestrator playbook
(reproduced: 35 KB on `tools/list`, 24 KB on `initialize`), and `GET /mcp` opens an SSE stream held
open indefinitely. Actual ops are still refused at the service, so this is disclosure and resource
hold rather than privilege escalation.

Otherwise the layer is in good shape and several of the hard parts are right: the token never
reaches argv, SQLite, the renderer, or a config file; lineage is re-validated against the database
on every read and fails closed; the cross-workspace scope check is derived only from the token; and
every one of the six process- or tab-creating ops reserves spawn capacity. One non-security bug is
material: the durable spawn quota degenerates into a permanent per-workspace cap for terminal
harnesses. The per-request MCP server construction measured 0.8–1.8 ms, so the stateless design
costs nothing worth changing.

## Findings

### [CT-01] `/mcp` serves the full tool inventory and the orchestrator playbook to any bearer token

- Severity: Medium
- Confidence: Confirmed (reproduced against `startControlServer` with a stub service)
- Where: `src/main/agent-control/control-server.ts:246`
- Where: `src/main/agent-control/mcp-endpoint.ts:794`
- Where: `src/main/agent-control/agent-control-service.ts:3776`

```ts
// control-server.ts:239-253 — presence, not validity
async function handleMcp(req, res, service, progressIntervalMs) {
	const token = readToken(req);
	if (!token) {
		sendJson(res, 401, { ok: false, code: 'denied-permission', error: 'Missing token.' });
		return;
	}
	// ... no further check; the token is handed straight to handleMcpRequest
```

```ts
// agent-control-service.ts:3775-3784 — an unresolvable token gets the most privileged audience
const origin = originRegistry.resolveByToken(token);
if (!origin) {
	return { architectureDiagram, delegation: 'ensemblr', hasChatTab: false,
	         role: 'orchestrator', tuiHarnesses };
}
```

- What: `handleMcp` rejects only a *missing* `Authorization` header. An unknown token reaches
  `handleMcpRequest`, which calls `describeAudience(token)`; that falls into the unknown-origin
  branch and answers with `role: 'orchestrator', hasChatTab: false` — the widest tool list the
  endpoint serves. `buildMcpServer` then registers all 37 tools and computes `instructionsFor`,
  which for a caller with no chat tab concatenates the harness playbook with the language,
  delegation, and co-author directives. Both `initialize` and `tools/list` are answered with HTTP
  200. The withholding policy in `withheldControlOps` is therefore bypassed entirely for discovery:
  a caller that should see a leaf's cut list sees a root's.
- Scenario: any process on the machine (a browser extension's helper, a stray script, a sub-agent
  whose own token was withheld ops) posts
  `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` to `http://127.0.0.1:<port>/mcp` with
  `Authorization: Bearer x`. Reproduced output: `STATUS 200 … bytes 35389 … TOOL COUNT 37`, and
  `initialize` returns 24,230 bytes including the `instructions` playbook. A sub-agent can read the
  orchestrator playbook it was deliberately not given, learning the exact op names and argument
  shapes of the delegation surface it is denied — which is the prose half of the withholding policy
  (`mcp-endpoint.ts:11-18` states the rationale: "Listing a tool the service would only refuse
  teaches the model to keep reaching for it").
- Existing guards/tests checked: `tests/main/agent-control-mcp-endpoint.test.ts:285` is the only
  auth test on this route and covers a connection with **no** bearer token; its stub's
  `describeAudience` (line 67) ignores the token argument entirely, so no test can distinguish a
  valid token from an invalid one here. `tests/main/agent-control-control-server.test.ts` tests
  `/invoke` with a bad token (line 100) — and `/invoke` *is* safe, because
  `agent-control-service.ts:3725-3728` resolves the token first and fails with
  `denied-permission`. The Host-header guard (`control-server.ts:77-84`) stops a browser, and the
  required `Authorization` header forces a CORS preflight that fails (verified: `OPTIONS /mcp`
  returns 401 with no `Access-Control-*` headers), so the reachable actor is a local process rather
  than a web page. No op executes: a `tools/call` with a bogus token was refused with
  `Error (denied-permission): Unknown or expired control token.`
- Fix: resolve the token before doing any work. Add a `resolveToken`/`isKnownToken` predicate to the
  `AgentControlService` surface (or have `describeAudience` return `null` for an unresolvable token)
  and answer 401 from `handleMcp` when it does not resolve, before `buildMcpServer` runs. The
  unknown-token fallback in `describeAudience` should not exist at all; if it must, it should be the
  *narrowest* audience rather than the widest.

### [CT-02] `GET /mcp` with any bearer token opens an unbounded, indefinitely held SSE stream

- Severity: Medium
- Confidence: Confirmed (reproduced; 300 concurrent streams held open with a bogus token)
- Where: `src/main/agent-control/control-server.ts:318`
- Where: `src/main/agent-control/mcp-endpoint.ts:800`

```ts
// control-server.ts:318 — any method, not just POST
if (req.url === '/mcp') {
	handleMcp(req, res, service, options.progressIntervalMs).catch(...);
	return;
}
```

- What: `/invoke` is matched on `req.method === 'POST'`; `/mcp` is matched on the URL alone, so
  GET and DELETE reach it too. `handleMcpRequest` constructs a `StreamableHTTPServerTransport`, and
  a GET is answered as `200 text/event-stream` (verified headers:
  `content-type: text/event-stream, connection: keep-alive, transfer-encoding: chunked`) which is
  then held open forever — the server writes nothing and never ends the response. Nothing bounds
  the number of such streams: `requestTimeout` (`control-server.ts:45`) bounds *receiving* a
  request, not answering one, and `server.maxConnections` is never set. Each held stream retains a
  socket, a file descriptor, an `McpServer`, and a transport in the main process. Combined with
  CT-01 this needs no valid credential.
- Scenario: a loop of `curl -N -H 'Authorization: Bearer x' http://127.0.0.1:<port>/mcp` from any
  local process accumulates held connections until the main process runs out of file descriptors,
  at which point SQLite writes, PTY spawns, and agent child processes start failing — the app
  degrades rather than crashing cleanly. Measured: 300 streams opened and held with no error and no
  server-side limit. Heap growth was not measurable (GC noise), so the binding constraint is
  descriptors and sockets rather than memory.
- Existing guards/tests checked: `tests/main/agent-control-control-server.test.ts:217` proves the
  `requestTimeout` wiring cuts off a *stalled request*, which is the opposite direction — the
  request here completes and the *response* is what hangs. `mcp-endpoint.ts:803-806` cleans up on
  `res.on('close')`, which fires only when the client disconnects, so a client that deliberately
  does not disconnect is never reclaimed. No test exercises GET or DELETE on `/mcp`. The MCP SDK's
  own `enableDnsRebindingProtection` / `allowedHosts` options are not used (the Host check is
  hand-rolled and is sound, see Verified sound), and neither would bound this.
- Fix: restrict the route to `req.method === 'POST'` and 405 everything else — the transport runs in
  stateless mode (`sessionIdGenerator: undefined`), so it has no legitimate use for the SSE GET or
  the session DELETE. Fixing CT-01 first also removes the unauthenticated half. A
  `server.maxConnections` ceiling would be a reasonable belt-and-braces addition.

### [CT-03] The durable spawn quota is a permanent per-workspace cap for terminal harnesses

- Severity: Medium
- Confidence: Confirmed (reproduced against the real `createGuardrails` + `createOriginRegistry`
  over an in-memory database carrying migration 028's schema)
- Where: `src/main/agent-control/main-integration.ts:359`
- Where: `src/main/agent-control/origin-registry.ts:92`
- Where: `src/main/storage/repositories/agent-control-spawn-repository.ts:36`

```ts
// main-integration.ts:356-361 — the harness origin's session id is derived from the workspace
token: resolveAgentControlEnv({
	workspaceId,
	sessionId: `ws:${workspaceId}`,
	species: 'harness',
})[CONTROL_TOKEN_ENV_KEY] ?? null,
```

```sql
-- agent-control-spawn-repository.ts:36-39 — lifetime count, never pruned
SELECT COUNT(*) AS count FROM agent_control_spawn_reservations WHERE root_session_id = ?
```

- What: every terminal in a workspace registers one shared origin under the synthetic session id
  `ws:<workspaceId>` (`terminal-service.ts:1198`, `main-integration.ts:359`). With no
  `parentSessionId`, `resolveFallbackLineage` gives it `depth: 0, rootSessionId: 'ws:<workspaceId>'`,
  and `establishAgentSessionLineage:311-323` puts its children at depth 1 on the *same* root. So
  every spawn by any harness agent in that workspace charges the durable row-count for
  `root_session_id = 'ws:<workspaceId>'`. That table is append-only — only a *failed* creation
  deletes its own row (`refundAgentControlSpawn`), there is no pruning migration, and no delete on
  workspace removal (grep: the table is referenced in exactly two files plus `database.ts`). The key
  is stable across app restarts, so the 20-spawn lifetime budget documented as "per root tree"
  (`docs/agent-control.md:128`) becomes a permanent, unresettable cap of 20 for the entire history
  of a workspace's terminal harnesses. `openTab` and `startTerminal` also charge it
  (`agent-control-service.ts:2473`, `:2638`), so twenty file tabs exhaust it with no delegation at
  all. A chat-tab root is unaffected: its root is a fresh session UUID per conversation.
- Scenario: a user works in one workspace over several weeks, launching `claude` in a terminal from
  time to time. Reproduced: 20 reservations succeed, the 21st returns
  `{ ok: false, code: 'denied-quota' }`, and after simulating an app restart (fresh registry and
  fresh guardrails over the same database, same `ws:W1` id) the very first reservation is still
  refused with `Root-tree spawn quota of 20 exhausted.` Every further
  `ensemblr_start_conversation`, `ensemblr_open_tab`, and `ensemblr_start_terminal` from any harness
  terminal in that workspace fails forever, with no user-facing reset and a message that reads as a
  fork-bomb accusation.
- Existing guards/tests checked: `tests/main/agent-control-guardrails.test.ts` exercises the limits
  against synthetic root ids and does not model the `ws:` root's stability across restarts;
  `tests/main/database.test.ts:46,276` asserts migration 028 exists but says nothing about growth.
  `docs/agent-control.md:128-129` documents the lifetime budget and that closing a child does not
  restore it, but not that a harness root tree never ends.
- Fix: give the harness origin a per-launch root rather than a per-workspace one — mint
  `ws:<workspaceId>:<appRunId>` (or a fresh uuid per terminal) so the budget is scoped to something
  that actually ends, and keep the workspace-scoped part only for the identity/scope check that
  needs it. Failing that, prune `agent_control_spawn_reservations` rows older than the rate window
  for `ws:`-prefixed roots, and delete a workspace's rows when the workspace is deleted.

### [CT-04] Nothing but merge order keeps a repository from redirecting the control token

- Severity: Low (defense-in-depth; the exploit path is closed today)
- Confidence: Confirmed on both halves — the control keys are not reserved, and the extension
  validates no URL. The path is not currently reachable.
- Where: `src/main/environment/environment-variable-catalog.ts:101`
- Where: `resources/pi-extensions/ensemblr-control.mts:30`
- Where: `resources/pi-extensions/ensemblr-control.mts:689`

```ts
// environment-variable-catalog.ts:101-118 — the only reserved keys
...['ENSEMBLR_WORKSPACE_NAME','ENSEMBLR_WORKSPACE_PATH','ENSEMBLR_ROOT_PATH',
    'ENSEMBLR_DEFAULT_BRANCH','ENSEMBLR_PORT'].map((key) =>
	createCatalogEntry({ ..., reserved: true, ... }))
```

```ts
// ensemblr-control.mts:689-700 — the URL is trusted verbatim
const req = httpRequest(`${url}/invoke`, { method: 'POST',
	headers: { ..., authorization: `Bearer ${token}` }, agent: false, signal }, ...)
```

- What: `isReservedEnvironmentVariableKey` consults the catalog, and none of the six
  `ENSEMBLR_CONTROL_*` keys is in it — so `readEnvFileLayer`, `readInfisicalLayer`, and
  `readPlainLayer` will all happily emit a repository- or user-declared `ENSEMBLR_CONTROL_URL` into
  an assembled workspace environment. What saves it today is merge order at the two sites that
  matter: `terminal-service.ts:1204` spreads `...controlEnv` *after* `...assembled.env`, and a
  native agent is handed `control.env` alone (`session-open.ts:792`) with no workspace layer at all.
  The Pi extension, meanwhile, reads `process.env.ENSEMBLR_CONTROL_URL` and posts its bearer token
  to `${url}/invoke` with no check that the host is loopback. So the invariant "the control keys
  cannot be overridden" is enforced by nothing but the order of two object spreads, and the
  component that would leak the token if it broke has no second line of defence. There is one live
  crack: when `resolveAgentControlEnv` returns `{}` (server not up, or workspace cwd unresolvable),
  `terminal-service.ts:1203` falls back to `assembled` unchanged, and a repository-declared
  `ENSEMBLR_CONTROL_URL`/`_TOKEN` survives into the terminal environment. It is inert today because
  the extension is loaded only by the app's own `pi --mode rpc -e` spawn, which does not inherit the
  terminal environment.
- Scenario (hypothetical, requires a future regression): a repository's `.ensemblr/settings.toml`
  declares `ENSEMBLR_CONTROL_URL = "http://127.0.0.1:9999"`. If any future call site merges the
  workspace layer over the control overlay — or a new runtime is wired to inherit the terminal
  environment — the shipped extension posts every control call, bearer token in the `Authorization`
  header, to a listener the repository controls. The token is then usable against the real server
  for the life of the session, with the origin's full workspace scope.
- Existing guards/tests checked: `tests/main/agent-control-env-role.test.ts` and
  `agent-control-env-lineage.test.ts` assert the overlay's *contents*, not its precedence; nothing
  asserts that a workspace layer cannot shadow a control key. `command-redaction.ts:4-15` does cover
  the token (`'token'` is in `SENSITIVE_KEY_PARTS` and `TOKEN` in the assignment regex), so a
  persisted command log would not carry it. `stripLaunchContextEnv` strips launch and Git context
  but knows nothing about the control keys.
- Fix: mark the six `ENSEMBLR_CONTROL_*` keys `reserved: true` in the built-in catalog — that is one
  entry per key and makes every environment layer skip them by construction, which is the same
  mechanism already protecting `ENSEMBLR_WORKSPACE_PATH`. Separately, have the extension refuse a
  `CONTROL_URL` whose hostname is not in the loopback set before it sends anything, and cap the
  response body it accumulates (`postControl` concatenates chunks with no limit).

### [CT-05] The control token is injected into every terminal, including repository script terminals

- Severity: Low (hardening; a malicious repository script is out of scope by policy)
- Confidence: Confirmed
- Where: `src/main/terminal/terminal-service.ts:1196`
- Where: `src/main/terminal/terminal-service.ts:1424`

```ts
// terminal-service.ts:1196-1206 — one assembly for every terminal kind
const controlEnv = resolveAgentControlEnv?.({
	workspaceId, sessionId: `ws:${workspaceId}`, species: 'harness',
});
return { environment: controlEnv ? { ...assembled, env: { ...assembled.env, ...controlEnv } } : assembled };
```

- What: `create` is the single entry point for every terminal — a plain shell, the setup script, a
  run script, an archive script, and a harness launch — and all of them call
  `assembleSessionEnvironment`, so all of them receive `ENSEMBLR_CONTROL_TOKEN` and
  `ENSEMBLR_CONTROL_URL`. Only the harness terminals have any use for them: the decoration in
  `harness-launch-config.ts` is what turns the token into an MCP client. A repository's setup or run
  script therefore runs with a live capability into the control channel it was never meant to hold,
  and `env` typed at any prompt in the workspace prints the token into scrollback that is persisted
  to `<worktree>/.context/terminals/<id>.log`.
- Scenario: a repository's `run` script does `curl -s -X POST "$ENSEMBLR_CONTROL_URL/invoke" -H
  "Authorization: Bearer $ENSEMBLR_CONTROL_TOKEN" -d '{"op":"launchHarness",...}'`, or simply posts
  the pair to a remote. SECURITY.md puts the malicious script itself out of scope, but the token it
  is handed is a capability the permission model otherwise gates, so widening the blast radius of an
  out-of-scope actor is worth closing.
- Existing guards/tests checked: `harness-launch-config.ts:8-10` and `claude-mcp-config.ts:23-27`
  both keep the token out of argv by passing `${ENSEMBLR_CONTROL_TOKEN}` as a reference (verified in
  `tests/main/agent-control-harness-launch-config.test.ts:32,98,124`), which is exactly the right
  instinct — the gap is that the variable is populated for terminals that do not consume it.
  `command-redaction.ts` would redact it from a persisted *command* log but does not touch terminal
  scrollback.
- Fix: gate the overlay on the terminal actually being a harness launch — `create` already receives
  `harnessId`, so `resolveAgentControlEnv` can be called only when one is present (and the token can
  stay out of setup, run, archive, and plain shells entirely).

### [CT-06] The workspace harness origin and its token are never released

- Severity: Low
- Confidence: Confirmed (reproduced: the `ws:` token still resolves after every session release)
- Where: `src/main/agent-control/origin-registry.ts:152`
- Where: `src/main/agent-control/agent-control-service.ts:3843`

- What: `releaseSession` deletes an origin from both maps, which correctly invalidates its token —
  but nothing ever calls it for the synthetic `ws:<workspaceId>` origin. `origin-registry.ts:58-65`
  documents this as deliberate ("registered on the first terminal of any kind and never released"),
  and the consequence is that the token minted for the first terminal in a workspace stays valid for
  the app's whole lifetime, along with the `workspaceCwd` captured at registration. Archiving or
  deleting the workspace does not invalidate it. Because `workspaceId` is a UUID that is never
  reused, the token cannot be redirected to a *different* workspace — this is a lifetime problem,
  not a confusion problem.
- Scenario: a user deletes a workspace while a detached harness process (or anything else that
  captured the environment) is still alive; it keeps a working control token whose origin names a
  worktree that no longer exists, and ops against it fail late and untidily rather than being
  refused at the gate.
- Existing guards/tests checked: `tests/main/agent-control-origin-registry.test.ts` covers
  `register`/`resolve`/`release`/`retire` for ordinary sessions. Token lookup is a `Map.get`, which
  is not constant-time — worth noting only, since the attacker model here is already local and a
  122-bit `randomUUID` is not going to fall to a timing oracle over a `Map`.
- Fix: release the `ws:<workspaceId>` origin when the workspace's last terminal closes, or when the
  workspace is archived or deleted — whichever the terminal service can observe cheaply.

### [CT-07] `GET /health` answers unauthenticated

- Severity: Info
- Confidence: Confirmed
- Where: `src/main/agent-control/control-server.ts:305`

- What: `/health` returns `{"ok":true}` with no bearer token. It leaks nothing about the workspace,
  but it does let a caller confirm that a given loopback port is Ensemblr's control server. A web
  page cannot read the body (no `Access-Control-Allow-Origin` on any response, verified) but can
  distinguish a successful opaque fetch from a connection refusal, which is enough to find the port.
- Scenario: a page or local process sweeps the ephemeral port range and identifies the control
  server, then has a target for CT-01 and CT-02 without guessing.
- Existing guards/tests checked: `tests/main/agent-control-control-server.test.ts:59` asserts the
  200, which is the intended contract. The Host guard still applies to `/health`, so a rebound
  domain is refused.
- Fix: require the bearer token on `/health` too, or answer 204 with no body. This is only worth
  doing alongside CT-01; on its own it buys little.

## Verified sound

- **DNS-rebinding / Host-header guard is tight.** `control-server.ts:77-84` strips the port,
  lowercases, and matches an exact set. Probed 14 variants: `localhost.` (trailing dot),
  `127.0.0.2`, `127.1`, `0.0.0.0`, `[::ffff:127.0.0.1]`, `user@localhost`, `localhost.evil.com`,
  `evil.com`, and `evil.com:80` are **all** refused with 403; only `127.0.0.1`, `localhost`
  (any case), and `[::1]` pass. A rebound attacker domain sends its own hostname and is rejected.
- **No CORS surface.** No `Access-Control-*` header is written anywhere in the layer. `OPTIONS /mcp`
  with `Origin` and `Access-Control-Request-Headers: authorization` returns 401 with no CORS
  headers, so a browser preflight fails and the required `Authorization` header cannot be sent
  cross-origin. An `Origin: https://evil.example` on a direct POST is ignored, which is correct
  given the header cannot be forged by the actor CORS protects against.
- **`/invoke` is properly authenticated.** `agent-control-service.ts:3725-3728` resolves the token
  before validating args or dispatching and fails with `denied-permission` on an unknown one;
  `control-server.ts:212` also rejects an op outside `AGENT_CONTROL_OPS` before the service is
  touched.
- **Tool *calls* are refused on an unknown token even over `/mcp`.** Verified: a `tools/call` with a
  bogus token returned `Error (denied-permission): Unknown or expired control token.` CT-01 is
  discovery only.
- **The token never reaches argv.** `control-env-keys.ts:52` renders `${NAME}`, and both consumers
  pass the reference: `harness-launch-config.ts:107` (Claude's inline `--mcp-config`),
  `:141` (Codex's `bearer_token_env_var`), `:164` (Vibe's `api_key_env`), and
  `claude-mcp-config.ts:46` for the native Claude runtime. Asserted by
  `tests/main/agent-control-harness-launch-config.test.ts:32,98,124`.
- **The token never reaches SQLite.** `agent-session-persistence.ts:50-58` projects a `metadata`
  runtime event down to `{ model, sessionId, status }`, dropping `AgentSessionMetadata.env`
  (`agent-types.ts:104`) before the row is written.
- **The token never reaches the renderer.** `handle-runtime-event.ts:299-307` broadcasts only the
  *persisted* row, so the renderer sees the same projection.
- **The token is redacted from persisted command logs.** `command-redaction.ts:4-15` matches on
  `'token'` and on `TOKEN` in the assignment regex, and redacts by value as well as by key.
- **Token revocation works.** `origin-registry.ts:152-159` deletes from both maps; verified that
  `resolveByToken` returns null immediately after `release`. `retire` (`:163-171`) deliberately
  keeps the token valid while narrowing the origin, and `agent-control-service.ts:1101-1104` gates
  on `origin.retired` ahead of the Concierge list; `:2123-2124` re-resolves the live origin so a
  request admitted under a pre-retirement origin cannot outlive it.
- **Cross-workspace scope is derived from the token alone.** `agent-control-service.ts:1273-1282`
  refuses any `workspaceId` argument that differs from `origin.workspaceId` for a non-Concierge
  caller, and otherwise uses `origin.workspaceCwd`/`origin.workspaceId` rather than anything the
  caller supplied. The Concierge branch resolves its target against the live workspace list.
- **Lineage cannot be forged by a caller.** `parentSessionId` is `origin.sessionId` at all four
  spawn sites (`agent-control-service.ts:1808, 1978, 2460, 3249`) — never an argument.
  `session-lineage.ts` re-validates the whole ancestor chain against the database on every read,
  version-gates the metadata record (`:54`), rejects a cross-workspace parent (`:207`), guards
  cycles with a `seen` set (`:237`), and fails closed to `UNPROVEN_LINEAGE` (`depth: 2,
  rootSessionId: null`), which `guardrails.ts:119` then refuses for any spawn.
- **The registry's fallback lineage fails closed.** `origin-registry.ts:107-114` returns
  `{ depth: 2, rootSessionId: null }` whenever the parent is unknown, in another workspace, itself
  unproven, or already at depth 2.
- **Depth 2 cannot spawn by any route.** All six creating ops reserve capacity through
  `reserveSpawnGuard` before acting: `spawnChatTab` (`:1304`), `startConversation` (`:1785`,
  including the `peer: true` path, which additionally passes `gatePeerSpawn`), `startReview`
  (`:1958`), `launchHarness` (`:2451`), `startTerminal` (`:2473`), `openTab` (`:2638`).
  `guardrails.ts:118-128` refuses on `depth >= 2` or a null root before touching any budget.
  `messageConcierge` has its own lifetime and rate quota (`:3011`).
- **Spawn capacity is reserved atomically.** `agent-control-spawn-repository.ts:32` opens
  `BEGIN IMMEDIATE` around the count-and-insert, so concurrent requests cannot overshoot, and only a
  failed creation refunds its own row by id.
- **`callerModel` is not trusted for anything security-relevant.** It is a freshness hint only:
  `spawn-model-resolver.ts:206-211` honours it solely when it matches a catalogue row *and* that
  row's provider equals the child's runtime, so a forged value cannot introduce an unknown model or
  smuggle one across runtimes.
- **Server-side enforcement does not depend on the client's tool list.** `registersOp`
  (`ensemblr-control.mts:627-642`) and `toolDefsFor` (`mcp-endpoint.ts:688`) only *hide* tools; the
  authority is `gateSubAgentRole` (`agent-control-service.ts:1087-1120`) over `origin.depth` plus the
  durable tab marker (`sub-agent-marker.ts`), with `origin.depth === 0 ? 2 : origin.depth` failing
  closed on the denial lookup.
- **The Pi plan-mode interceptor fails closed.** `ensemblr-control.mts:1136-1141` blocks the guarded
  tool when the app cannot be reached, rather than allowing it, and asks per call rather than
  caching the verdict for the turn.
- **The delegation barrier cannot be spoofed by tool name.** `event.toolName` in
  `delegation-barrier.mts` comes from Pi's own tool dispatch, not from model-authored text, and
  `restoreDelegationBarrierState` (`:408-439`) falls back to a closed barrier on any unusable
  snapshot. It is a sequencing mechanism rather than a security boundary, and nothing in it grants
  an op.
- **`askUserQuestion` holds are bounded to one per session.** `ask-user-question.ts:66-67` refuses a
  second concurrent questionnaire for the same conversation, so the deliberately timeout-free hold
  cannot be used to accumulate held requests (unlike CT-02).
- **Non-blocking ops are bounded on the app's side.** `dispatch-deadline.ts:32,41-46` applies a
  120 s deadline to every op except the four that block by contract, which is what makes the
  day-long client ceiling in `mcp-tool-timeout.ts:49` safe.
- **The progress heartbeat does not leak its timer.** `mcp-progress.ts:73-77` clears the interval in
  a `finally`, and a failed send clears it early (`:71`); a caller that sent no `progressToken` gets
  no timer at all (`:58`).
- **Per-request MCP server construction is cheap.** Measured over 200 sequential requests against a
  stub service: `tools/list` 1.82 ms each, `initialize` 0.77 ms each (24 KB payload). The stateless
  "fresh server and transport per request" design in `mcp-endpoint.ts:786-808` costs nothing worth
  optimising; the playbook concatenation in `instructionsFor` is not a hot spot.
- **Body size is capped.** `control-server.ts:113-128` streams and rejects past 1,000,000 bytes
  rather than trusting `Content-Length` (asserted at
  `tests/main/agent-control-control-server.test.ts:137`).
- **A caller hanging up cancels its op.** `control-server.ts:151-159` aborts on socket close and
  `replyUnlessGone` (`:168-177`) treats a vanished caller as routine; asserted at
  `tests/main/agent-control-control-server.test.ts:251` and
  `tests/main/agent-control-mcp-endpoint.test.ts:789`.

## Coverage

Read in full: `src/main/agent-control/control-server.ts`, `origin-registry.ts`, `guardrails.ts`,
`session-lineage.ts`, `sub-agent-marker.ts`, `started-terminals.ts`, `harness-launch-config.ts`,
`control-env-keys.ts`, `main-integration.ts`, `dispatch-deadline.ts`, `mcp-tool-timeout.ts`,
`mcp-progress.ts`; `src/main/claude-agent/claude-mcp-config.ts`;
`src/main/environment/launch-env.ts`, `environment-assembly.ts`, `environment-variable-keys.ts`,
`environment-variable-catalog.ts` (1–170); `src/main/pi-agent/cli-rpc/spawn-env.ts`;
`src/main/storage/repositories/agent-control-spawn-repository.ts`;
`resources/pi-extensions/delegation-barrier.mts`;
`src/shared/agent-control/subagent-policy.ts` (1–200).

Read in part: `src/main/agent-control/mcp-endpoint.ts` (handler tail 670–809; the ~480-line
`TOOL_DEFS` block skimmed), `agent-control-service.ts` (identity/gate/dispatch/audience paths:
1000–1140, 1255–1310, 1770–1820, 1940–1980, 2440–2480, 2630–2650, 3690–3864), `port-adapters.ts`
(730–840), `src/main/agent-providers/spawn-model-resolver.ts` (55–90, 190–265),
`src/main/agent-runtime/session/agent-control-wiring.ts` (200–284), `session-open.ts` (400–440,
760–820), `agent-session-persistence.ts` (25–235), `handle-runtime-event.ts` (290–345),
`src/main/terminal/terminal-service.ts` (1150–1260, 1395–1445), `src/main/main.ts` (1170–1215),
`resources/pi-extensions/ensemblr-control.mts` (1–120, 620–830, 978–1200),
`src/main/commands/command-redaction.ts` (1–60), `src/main/storage/database.ts` (1195–1216),
`docs/agent-control.md` (110–200).

Tests read: `tests/main/agent-control-control-server.test.ts` (all),
`tests/main/agent-control-mcp-endpoint.test.ts` (test names plus 280–320 and the stub at 67).

Reproduced with throwaway scripts under `/tmp` (since removed) against the real
`startControlServer`, `createGuardrails`, and `createOriginRegistry` with stub services: CT-01
(tool list and playbook on a bogus token), CT-02 (held SSE streams, response headers), CT-03
(quota exhaustion surviving a simulated restart), the 14 Host-header variants, the CORS probes,
and the per-request timings.

Not reached in my scope: the ~480-line `TOOL_DEFS` argument schemas one by one (per-op validation is
another auditor's dimension), `src/shared/agent-control/contracts.ts` and `awareness.ts` beyond the
op list and the withholding model, `linear-ports.ts` / `review-ports.ts` / `architecture-ports.ts`
internals, `src/main/agents/` harness detection and registry, and `docs/harnesses.md` beyond the
launch-decoration table.

## Open questions

1. **CT-01's severity depends on how the maintainer reads SECURITY.md.** "The loopback control
   server … accepting a request without a valid per-session bearer token" is listed in scope
   unconditionally, which argues for High; the actual impact is discovery of a playbook and a tool
   list with no op executed, which argues for Low. I ranked it Medium. Default taken: Medium, with
   the reproduction in the finding so it can be re-ranked.
2. **CT-03 is a functional bug in my scope rather than a security finding.** I reported it because
   the guardrail is my dimension, but if the audit's output is meant to be security-only it belongs
   in a tracker issue instead. Default taken: reported here.
3. **CT-05's fix changes behaviour.** Gating the control overlay on `harnessId` means a user who
   runs `claude` *by hand* in a plain terminal (rather than through the harness launcher) would no
   longer have `ENSEMBLR_CONTROL_TOKEN` in the environment, and the `--mcp-config` they might paste
   themselves would stop working. If that is a supported workflow, the fix has to narrow to the
   script terminals (setup/run/archive) only. Default taken: flagged, not decided.
