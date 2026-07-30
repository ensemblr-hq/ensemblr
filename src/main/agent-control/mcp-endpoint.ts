/**
 * MCP (streamable HTTP) surface over the agent-control service, for third-party
 * harnesses (Claude Code, Codex, Mistral Vibe) that are native MCP clients. It
 * exposes the ops a harness can actually use as MCP tools; each forwards to
 * {@link AgentControlService.invoke} with the per-request bearer token, so the
 * service remains the single validation/scope/permission authority. Stateless:
 * a fresh server + transport per request (no sessions), token read from the
 * request's Authorization header by the caller.
 *
 * The chat-tab ops are deliberately absent: a harness owns a terminal tab whose
 * title is derived from the harness's own session log, so `setName` would have
 * no tab to rename, and `setSummary`, `askUserQuestion`, and the Plan Mode ops
 * are gated to Pi callers in the service. Listing a tool the service would only
 * refuse teaches the model to keep reaching for it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type ZodRawShape, z } from 'zod';

import {
	type AgentControlOp,
	type AgentControlResult,
	HARNESS_AWARENESS,
	WORKSPACE_BOARD_STATUSES,
} from '../../shared/agent-control.ts';
import type { AgentControlService } from './agent-control-service.ts';

/** One MCP tool: its client-facing name, the control op, help text, and args. */
interface McpToolDef {
	name: string;
	op: AgentControlOp;
	description: string;
	shape: ZodRawShape;
}

const startStop = z.enum(['setup', 'run']);

/**
 * MCP tool definitions mirroring the control vocabulary. Input shapes are
 * advisory for the client; the service re-validates authoritatively.
 */
/**
 * Every tool this endpoint exposes. Exported so the parity test can hold each
 * description against the Pi extension's copy: the two registration sites cannot
 * share a module (the extension runs outside the app bundle), and these strings
 * carry behaviour — `stat=true FIRST` is the only thing stopping a model from
 * pulling a whole workspace diff it did not need.
 */
export const TOOL_DEFS: readonly McpToolDef[] = [
	{
		name: 'ensemblr_spawn_chat_tab',
		op: 'spawnChatTab',
		description: 'Open a new empty chat tab in the current workspace.',
		shape: { title: z.string().optional() },
	},
	{
		name: 'ensemblr_start_conversation',
		op: 'startConversation',
		description:
			"Open a fresh chat tab (or reuse one via chatTabId) and start a Pi conversation. Pass a short, descriptive title to name the sub-agent's tab. Brief it with what to deliver, not just what to look at: the question it answers, the defaults it should assume rather than come back and ask about, and whether it reports inline (the default) or writes a file at a path you name. Set wait=true to block until it finishes.",
		shape: {
			chatTabId: z.string().optional(),
			prompt: z.string(),
			model: z.string().optional(),
			thinkingLevel: z.string().optional(),
			title: z.string().optional(),
			wait: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_send_follow_up',
		op: 'sendFollowUp',
		description: 'Send a follow-up prompt into an existing Pi conversation.',
		shape: {
			piSessionId: z.string(),
			prompt: z.string(),
			wait: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_set_branch_name',
		op: 'setBranchName',
		description:
			'Name the work: renames this workspace AND its git branch together from one kebab-case slug (2-5 words, e.g. "add-dark-mode"), keeping any `prefix/` segment of the current branch. One-shot — it applies only while the workspace still carries its generated placeholder name; once named it reports that and changes nothing, so call it at most once. This names the workspace and branch, not your terminal tab, which titles itself from your own session log.',
		shape: { name: z.string() },
	},
	{
		name: 'ensemblr_close_tab',
		op: 'closeTab',
		description: 'Close a chat or terminal tab in the current workspace.',
		shape: { chatTabId: z.string() },
	},
	{
		name: 'ensemblr_launch_harness',
		op: 'launchHarness',
		description:
			'Launch a third-party agent harness (claude, codex, vibe) in a new terminal tab.',
		shape: { harnessId: z.string() },
	},
	{
		name: 'ensemblr_start_terminal',
		op: 'startTerminal',
		description:
			'Start a dock terminal: the setup script, the run script, or an interactive spawn terminal.',
		shape: { kind: z.enum(['setup', 'run', 'spawn']) },
	},
	{
		name: 'ensemblr_stop_terminal',
		op: 'stopTerminal',
		description: 'Stop a dock terminal by id, or the setup/run script by kind.',
		shape: {
			terminalId: z.string().optional(),
			kind: startStop.optional(),
		},
	},
	{
		name: 'ensemblr_write_terminal',
		op: 'writeTerminal',
		description: 'Write input into an existing terminal or harness.',
		shape: { terminalId: z.string(), input: z.string() },
	},
	{
		name: 'ensemblr_open_tab',
		op: 'openTab',
		description: 'Open a non-chat tab: a file preview, a diff, or a comment.',
		shape: {
			variant: z.enum(['file', 'diff', 'comment']),
			filePath: z.string().optional(),
			turnId: z.string().optional(),
			commentBody: z.string().optional(),
			prNumber: z.number().optional(),
		},
	},
	{
		name: 'ensemblr_focus_tab',
		op: 'focusTab',
		description:
			'Bring a session tab (chat/terminal/diff/file) to the foreground by id.',
		shape: { chatTabId: z.string() },
	},
	{
		name: 'ensemblr_focus_dock_tab',
		op: 'focusDockTab',
		description:
			'Focus a dock terminal by id, or the setup/run script tab by kind.',
		shape: {
			terminalId: z.string().optional(),
			kind: startStop.optional(),
		},
	},
	{
		name: 'ensemblr_focus_panel',
		op: 'focusPanel',
		description: 'Focus the Files, Changes, or Checks review panel.',
		shape: { panel: z.enum(['files', 'changes', 'checks']) },
	},
	{
		name: 'ensemblr_set_workspace_status',
		op: 'setWorkspaceStatus',
		description:
			'Move your workspace across the kanban board by setting its status (backlog, in-progress, in-review, done, canceled). Acts on your own workspace.',
		shape: { status: z.enum(WORKSPACE_BOARD_STATUSES) },
	},
	{
		name: 'ensemblr_get_workspace_status',
		op: 'getWorkspaceStatus',
		description:
			"Read your workspace's current kanban board status. Use ensemblr_list_workspaces to see every workspace's status.",
		shape: {},
	},
	{
		name: 'ensemblr_get_workspace_diff',
		op: 'getWorkspaceDiff',
		description:
			"Read this workspace's diff — every change on its branch, committed and uncommitted alike, the same set the Changes panel shows. Call it with stat=true FIRST: that returns the changed files with their +/- counts and no patch text, so you can see how big the diff is before you read it. Then read the whole diff, or pass file to read one file's patch on its own — file and stat are alternatives, not a pair. Every read is capped: a full read names what it dropped in omittedFiles for you to re-request by file, and a single file too large to carry is cut at a hunk boundary.",
		shape: { file: z.string().optional(), stat: z.boolean().optional() },
	},
	{
		name: 'ensemblr_get_diff_comments',
		op: 'getDiffComments',
		description:
			"Read the review comments on this workspace's diff — the ones the user left in the Changes panel and the ones agents filed there. Pass file to narrow it to one path. Comments synced from a GitHub pull request are not included.",
		shape: { file: z.string().optional() },
	},
	{
		name: 'ensemblr_add_diff_comments',
		op: 'addDiffComments',
		description:
			"File review comments on this workspace's diff, anchored to a file and optionally a line. They appear in the Changes panel labelled as yours, so use them to leave findings on the code itself rather than describing a location in prose. Batch a review's comments into one call.",
		shape: {
			comments: z.array(
				z.object({
					filePath: z.string(),
					lineNumber: z.number().nullable().optional(),
					body: z.string(),
				}),
			),
		},
	},
	{
		name: 'ensemblr_list_models',
		op: 'listModels',
		description:
			'List the Pi models available in this app (id, provider, display name) plus the default. Call this before setting a model on start_conversation; only pass a model id that appears here, preferably from the same provider.',
		shape: {},
	},
	{
		name: 'ensemblr_list_workspaces',
		op: 'listWorkspaces',
		description: 'List all open workspaces (id, name, cwd).',
		shape: {},
	},
	{
		name: 'ensemblr_list_tabs',
		op: 'listTabs',
		description: 'List open tabs, defaulting to the current workspace.',
		shape: { workspaceId: z.string().optional() },
	},
	{
		name: 'ensemblr_list_terminals',
		op: 'listTerminals',
		description: 'List terminals, defaulting to the current workspace.',
		shape: { workspaceId: z.string().optional() },
	},
	{
		name: 'ensemblr_get_conversation_status',
		op: 'getConversationStatus',
		description: 'Get the status of a Pi conversation by session id.',
		shape: { piSessionId: z.string() },
	},
	{
		name: 'ensemblr_get_last_message',
		op: 'getLastMessage',
		description:
			"Get a Pi conversation's report: every assistant message of its newest answered turn, joined in the order it was written. Persisted, so it survives the conversation closing and an app restart.",
		shape: { piSessionId: z.string() },
	},
	{
		name: 'ensemblr_read_terminal_output',
		op: 'readTerminalOutput',
		description: 'Read the current scrollback of a terminal or harness.',
		shape: { terminalId: z.string() },
	},
	{
		name: 'ensemblr_wait_for_agents',
		op: 'waitForAgents',
		description:
			'Block until delegated Pi sub-agents finish or need a decision, then return each settled one\'s status and report (its whole final turn), plus `pending` naming the children still running so you can wait on exactly those next. Prefer this over polling get_conversation_status. targets defaults to every child you spawned; mode defaults to "first", which returns on the first to settle — pass "all" to wait for every target. A need_decision/blocked signal wakes the wait whatever the mode. reports: "brief" returns each report\'s opening plus a pointer to ensemblr_get_last_message for the rest, instead of every child\'s whole turn at once — worth it on a wide fan-out, where reading four full reports to use one line of each is what makes delegation cost you more context than doing the work inline.',
		shape: {
			targets: z.array(z.string()).optional(),
			mode: z.enum(['first', 'all']).optional(),
			timeoutMs: z.number().optional(),
			reports: z.enum(['full', 'brief']).optional(),
		},
	},
	{
		name: 'ensemblr_notify_orchestrator',
		op: 'notifyOrchestrator',
		description:
			'Sub-agents only: notify the orchestrator that spawned you. reason need_decision/blocked wakes its wait immediately so it can answer, so use it when the answer changes what you do next; a decision that only bites after you report belongs in your report as options and tradeoffs. progress/done are informational.',
		shape: {
			reason: z.enum(['need_decision', 'blocked', 'progress', 'done']),
			message: z.string(),
		},
	},
];

/**
 * Renders a control result as MCP tool content.
 * @param result - The control envelope from the service.
 * @returns MCP tool result content with an error flag.
 */
function toMcpResult(result: AgentControlResult<unknown>) {
	const text = result.ok
		? JSON.stringify(result.data ?? { ok: true })
		: `Error (${result.code}): ${result.error}`;
	return { content: [{ type: 'text' as const, text }], isError: !result.ok };
}

/**
 * Builds a fresh MCP server whose tools forward to the control service under a
 * fixed token.
 * @param service - Agent-control service every tool delegates to.
 * @param token - Per-request bearer token identifying the caller.
 * @returns A configured, not-yet-connected MCP server.
 */
function buildMcpServer(
	service: AgentControlService,
	token: string,
): McpServer {
	const server = new McpServer(
		{ name: 'ensemblr-control', version: '1.0.0' },
		{ instructions: HARNESS_AWARENESS },
	);
	for (const def of TOOL_DEFS) {
		server.registerTool(
			def.name,
			{ description: def.description, inputSchema: def.shape },
			async (args: unknown) =>
				toMcpResult(
					await service.invoke({ op: def.op, token, rawArgs: args ?? {} }),
				),
		);
	}
	return server;
}

/**
 * Handles a single MCP streamable-HTTP request end to end (stateless).
 * @param req - Incoming request.
 * @param res - Server response.
 * @param body - Parsed JSON-RPC body.
 * @param service - Agent-control service the tools delegate to.
 * @param token - Bearer token extracted from the request.
 */
export async function handleMcpRequest(
	req: IncomingMessage,
	res: ServerResponse,
	body: unknown,
	service: AgentControlService,
	token: string,
): Promise<void> {
	const server = buildMcpServer(service, token);
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	res.on('close', () => {
		transport.close().catch(() => undefined);
		server.close().catch(() => undefined);
	});
	await server.connect(transport);
	await transport.handleRequest(req, res, body);
}
