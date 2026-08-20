/**
 * How long an MCP client Ensemblr launches may let one control tool call run
 * before it gives up on the server.
 *
 * Three control ops block by design: `askUserQuestion` until the human answers,
 * `waitForAgents` for up to the five minutes its guardrail allows, and a
 * `wait: true` spawn until the child settles. Ensemblr holds all three on its
 * own side — the control server's `requestTimeout` bounds receiving a request
 * rather than answering it — but every MCP client applies a per-call timeout of
 * its own, and each defaults to 60 seconds: Codex's and Vibe's
 * `tool_timeout_sec`, and for Claude the HTTP request timeout it derives from
 * the same per-server `timeout` key, which is what actually aborts an
 * http-transport call long before its own tool-call default does. Because
 * Ensemblr launches these processes itself, this is a knob it already has its
 * hand on.
 *
 * The exposure differs by caller, and the fix does not. `askUserQuestion` is
 * served only to a caller with a chat tab, so over MCP that is Claude's
 * first-class runtime (`claude-mcp-config.ts`), where its own tool description
 * promises the agent the call "has no time limit" — a user who steps away for
 * lunch would come back to a question the app is still holding open and an agent
 * that abandoned it minutes in. The three terminal harnesses
 * (`harness-launch-config.ts`) hold the two waits instead, and `waitForAgents`
 * alone already outlives a 60-second default five times over.
 *
 * None of these clients extends its limit on `notifications/progress` — Claude
 * documents its `timeout` as a hard wall-clock limit, and Vibe hands the value
 * to the Python SDK's `read_timeout_seconds`, which does not reset either — so
 * raising it at launch is the defence, and the progress heartbeat in
 * `mcp-progress.ts` is the second line for clients that do reset.
 *
 * The value is a day rather than the acceptance floor of an hour, because the
 * promise the ask makes is "however long that takes" and the nearest thing to
 * unbounded is what keeps it. It applies per server rather than per tool, since
 * no client exposes a per-tool knob — which is why the per-op bound is applied
 * on this side instead: `dispatch-deadline.ts` answers for any op that is not
 * one of the three above, so raising the ceiling for the ask does not leave a
 * wedged terminal or git call hanging an agent for a day.
 *
 * Verified against the shipped clients rather than assumed: Claude Code 2.1.224
 * clamps its `timeout` to `[1000, 2147483647]` ms, so a day passes through
 * untouched but anything past ~24.8 days would be silently cut; Codex 0.147.0
 * reports `tool_timeout_sec: 86400.0` back from `codex mcp get --json`, and
 * rejects the same number quoted; Vibe 2.24.1 parses the launch JSON into an
 * `MCPStreamableHttp` with `tool_timeout_sec = 86400.0` against a default of 60.
 */

/** The per-call ceiling in milliseconds, the unit Claude Code's config takes. */
export const MCP_TOOL_CALL_TIMEOUT_MS = 86_400_000;

/** The same ceiling in seconds, the unit Codex and Vibe both take. */
export const MCP_TOOL_CALL_TIMEOUT_SEC = MCP_TOOL_CALL_TIMEOUT_MS / 1000;
