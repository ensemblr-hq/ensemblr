/**
 * MCP (streamable HTTP) surface over the agent-control service, for third-party
 * harnesses (Claude Code, Codex) that are native MCP clients. It exposes the
 * same ops as the Pi extension as MCP tools; each tool forwards to
 * {@link AgentControlService.invoke} with the per-request bearer token, so the
 * service remains the single validation/scope/permission authority. Stateless:
 * a fresh server + transport per request (no sessions), token read from the
 * request's Authorization header by the caller.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type ZodRawShape, z } from 'zod';

import {
	type AgentControlOp,
	type AgentControlResult,
	AWARENESS,
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
const TOOL_DEFS: readonly McpToolDef[] = [
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
			'Open (or reuse) a chat tab and start a Pi conversation. Set wait=true to block until it finishes.',
		shape: {
			chatTabId: z.string().optional(),
			prompt: z.string(),
			model: z.string().optional(),
			thinkingLevel: z.string().optional(),
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
		description: 'Get the last assistant message text of a Pi conversation.',
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
			'Block until delegated Pi sub-agents finish or need a decision, then return each one\'s status and last message. Prefer this over polling get_conversation_status. targets defaults to every child you spawned; mode "all" waits for all of them, mode "first" returns on the first to settle.',
		shape: {
			targets: z.array(z.string()).optional(),
			mode: z.enum(['first', 'all']).optional(),
			timeoutMs: z.number().optional(),
		},
	},
	{
		name: 'ensemblr_notify_orchestrator',
		op: 'notifyOrchestrator',
		description:
			'Sub-agents only: notify the orchestrator that spawned you. reason need_decision/blocked wakes its wait immediately so it can answer; progress/done are informational.',
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
		{ instructions: AWARENESS },
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
