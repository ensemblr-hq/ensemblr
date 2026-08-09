/**
 * MCP (streamable HTTP) surface over the agent-control service, for every caller
 * that speaks MCP rather than the Pi extension protocol: third-party harnesses
 * (Claude Code, Codex, Mistral Vibe) and first-class runtimes wired to the same
 * loopback server. Each tool forwards to {@link AgentControlService.invoke} with
 * the per-request bearer token, so the service remains the single
 * validation/scope/permission authority. Stateless: a fresh server + transport
 * per request (no sessions), token read from the request's Authorization header
 * by the caller.
 *
 * The tool list and the playbook are both cut to the caller. A harness owns a
 * terminal tab that titles itself from its own session log, so the four chat-tab
 * ops have nothing there to act on and the service refuses them; a spawned
 * sub-agent loses the delegation surface it is refused on top of that. Listing a
 * tool the service would only refuse teaches the model to keep reaching for it,
 * which is why {@link withheldControlOps} answers both axes in one place rather
 * than each bridge inventing its own answer.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type ZodRawShape, z } from 'zod';

import {
	type AgentControlOp,
	type AgentControlResult,
	ASK_USER_QUESTION_LIMITS,
	awarenessForAudience,
	type ControlAudience,
	EXIT_PLAN_MODE_LIMITS,
	LINEAR_AGENT_LIMITS,
	WORKSPACE_BOARD_STATUSES,
	withheldControlOps,
} from '../../shared/agent-control.ts';
import type { AgentControlService } from './agent-control-service.ts';

/** One MCP tool: its client-facing name, the control op, help text, and args. */
export interface McpToolDef {
	name: string;
	op: AgentControlOp;
	description: string;
	shape: ZodRawShape;
}

const startStop = z.enum(['setup', 'run']);

/** One `askUserQuestion` choice, mirroring the shared questionnaire schema. */
const askOption = z.object({
	label: z.string().max(ASK_USER_QUESTION_LIMITS.maxLabelLength),
	description: z.string().optional(),
});

/** One question in an `askUserQuestion` call, with its two-to-six choices. */
const askQuestion = z.object({
	question: z.string(),
	header: z.string().optional(),
	options: z
		.array(askOption)
		.min(ASK_USER_QUESTION_LIMITS.minOptions)
		.max(ASK_USER_QUESTION_LIMITS.maxOptions),
	multiSelect: z.boolean().optional(),
});

/**
 * Every tool this endpoint knows how to serve, in the whole control vocabulary
 * rather than one audience's slice of it — {@link toolDefsFor} cuts it down per
 * caller. Input shapes are advisory for the client; the service re-validates
 * authoritatively.
 *
 * Exported so the parity test can hold each description against the Pi
 * extension's copy: the two registration sites cannot share a module (the
 * extension runs outside the app bundle), and these strings carry behaviour —
 * `stat=true FIRST` is the only thing stopping a model from pulling a whole
 * workspace diff it did not need.
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
			"Open a fresh chat tab (or reuse one via chatTabId) and start a conversation. A chat tab spawns children on its own agent runtime and may omit `model` to inherit its own; a terminal harness has no runtime the app can name, so it must pass a `model` from ensemblr_list_models and is refused without one. Pass a short, descriptive title to name the sub-agent's tab. Brief it with what to deliver, not just what to look at: the question it answers, the defaults it should assume rather than come back and ask about, and whether it reports inline (the default) or writes a file at a path you name. Set wait=true to block until it finishes.",
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
			agentSessionId: z.string(),
			prompt: z.string(),
			wait: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_set_name',
		op: 'setName',
		description:
			'Set a short, descriptive title for your own conversation tab so it is easy to identify. The label goes in `title`, the same key ensemblr_start_conversation names a tab with. This is the tab label, not the workspace or branch name — ensemblr_set_branch_name owns that.',
		shape: { title: z.string() },
	},
	{
		name: 'ensemblr_set_branch_name',
		op: 'setBranchName',
		description:
			'Name the work: renames this workspace AND its git branch together from one kebab-case slug (2-5 words, e.g. "add-dark-mode"), keeping any `prefix/` segment of the current branch. Call it once, early, as soon as you know what the work is called. It applies while the git branch still carries the name it was cut with; a workspace the user has already titled keeps that title and only its branch moves. A reply saying nothing changed is a settled outcome, not a fault to retry — except when the USER asks for a different branch name in so many words, which is what userRequested: true is for. Renaming the branch any other way, `git branch -m` included, desyncs the workspace from git. This names the workspace and branch, not your terminal tab, which titles itself from your own session log.',
		shape: { name: z.string(), userRequested: z.boolean().optional() },
	},
	{
		name: 'ensemblr_set_summary',
		op: 'setSummary',
		description:
			"Record the session summary the app keeps for this chat tab, replacing whatever is on file. Call it once the turn's work is done: `title` is a short topic line and `summary` is markdown covering the decisions made, the files touched, and what is still open. Writing it yourself is what keeps the record useful — the app's fallback only dumps the raw transcript. This does NOT rename the tab.",
		shape: { title: z.string(), summary: z.string() },
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
			'Start a dock terminal: the setup script, a run script, or an interactive spawn terminal. A repository can configure several named run scripts (a dev server, a playground, an unsigned build), so with kind=run call ensemblr_list_run_scripts FIRST and pass the scriptName you actually want — omitting it silently starts whichever one the repository marks default, which is rarely the one you meant. Only one run script runs per workspace at a time.',
		shape: {
			kind: z.enum(['setup', 'run', 'spawn']),
			scriptName: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_list_run_scripts',
		op: 'listRunScripts',
		description:
			"List the run scripts this workspace's repository configures (name, command, and which one is the default), so you can start the right one by name with ensemblr_start_terminal. An empty list means the repository configures none and kind=run has nothing to start.",
		shape: {},
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
			"Read this workspace's diff — every change on its branch, committed and uncommitted alike, the same set the Changes panel shows. Call it with stat=true FIRST: that returns the changed files with their +/- counts and no patch text, so you can see how big the diff is before you read it. Then read the whole diff, or pass filePath to read one file's patch on its own — filePath and stat are alternatives, not a pair. Every read is capped: a full read names what it dropped in omittedFiles for you to re-request by filePath, and a single file too large to carry is cut at a hunk boundary.",
		shape: { filePath: z.string().optional(), stat: z.boolean().optional() },
	},
	{
		name: 'ensemblr_get_diff_comments',
		op: 'getDiffComments',
		description:
			"Read the review comments on this workspace's diff — the ones the user left in the Changes panel and the ones agents filed there. Pass filePath to narrow it to one path. Comments synced from a GitHub pull request are not included.",
		shape: { filePath: z.string().optional() },
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
		name: 'ensemblr_resolve_diff_comments',
		op: 'resolveDiffComments',
		description:
			"Mark review comments on this workspace's diff as resolved, by the ids ensemblr_get_diff_comments and ensemblr_add_diff_comments hand back. Resolve a comment in the same turn you make the fix it asked for, and batch a whole review pass into one call. Resolve only what you actually fixed: a comment you deferred or disagree with stays open, and you say so in your reply. This only ever resolves — it cannot reopen a comment the user closed, and an id that matches no open comment here is reported back rather than failing the call.",
		shape: { commentIds: z.array(z.string()) },
	},
	{
		name: 'ensemblr_linear_list_issues',
		op: 'linearListIssues',
		description:
			"Search the connected Linear account's issues. This is NOT scoped to your workspace — Linear is an app-level integration and one account can span several teams, so narrow with query (free text over identifier, title, and description) or teamId rather than reading the whole list as the work in front of you. Reads a local cache and syncs from Linear when it has gone stale, so it is cheap to call; pass refresh=true only when you need the very latest. Descriptions are NOT returned — read one issue with ensemblr_linear_get_issue. Check `status` before acting on the result: `not-connected` means the user has not linked Linear at all, which is a different answer from an empty list.",
		shape: {
			query: z.string().optional(),
			teamId: z.string().optional(),
			refresh: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_linear_get_issue',
		op: 'linearGetIssue',
		description:
			'Read one Linear issue with its description, labels, and comment thread. issueId takes either the uuid or the human identifier (THE-106); an identifier always goes to Linear rather than the local cache. The description is truncated and only the most recent comments are returned — the result says how many were dropped. Check `status`: `not-found` means the id is wrong, `not-connected` means Linear is not linked.',
		shape: { issueId: z.string(), refresh: z.boolean().optional() },
	},
	{
		name: 'ensemblr_linear_get_metadata',
		op: 'linearGetMetadata',
		description:
			'List the Linear teams, projects, workflow states, labels, and users the connected account can see, each with the id ensemblr_linear_update_issue takes. The account is not scoped to your workspace, so expect teams that have nothing to do with the work here. Call this FIRST whenever you are about to set a state, an assignee, or a project — those arguments are ids, not names, and this is the only place to turn one into the other. Cycles are not returned; nothing on this surface sets one.',
		shape: { refresh: z.boolean().optional() },
	},
	{
		name: 'ensemblr_linear_create_comment',
		op: 'linearCreateComment',
		description:
			'Post a comment on a Linear issue. The whole team reads it and nothing here can edit or delete it afterwards, so write it as you would a comment of your own: what you did, what you found, what is still open. Use it to record progress on a ticket rather than to talk to the user, who reads your reply instead.',
		shape: {
			issueId: z.string(),
			commentBody: z.string().max(LINEAR_AGENT_LIMITS.maxCommentLength),
		},
	},
	{
		name: 'ensemblr_linear_update_issue',
		op: 'linearUpdateIssue',
		description:
			'Change a Linear issue: its workflow state, assignee, priority (0 none, 1 urgent, 2 high, 3 medium, 4 low), title, or description. Pass at least one of those alongside issueId. stateId and assigneeId are ids from ensemblr_linear_get_metadata, never names. A state whose type is `completed` or `canceled` is REFUSED whatever you pass — agent work never closes a ticket here, and marking one canceled is the same call under a different label. Take it to In Review and say in your reply that it is ready; the user decides whether it is done.',
		shape: {
			issueId: z.string(),
			stateId: z.string().optional(),
			assigneeId: z.string().optional(),
			priority: z.number().int().min(0).max(4).optional(),
			title: z.string().max(LINEAR_AGENT_LIMITS.maxTitleLength).optional(),
			description: z
				.string()
				.max(LINEAR_AGENT_LIMITS.maxDescriptionLength)
				.optional(),
		},
	},
	{
		name: 'ensemblr_list_models',
		op: 'listModels',
		description:
			'List the models you can spawn a child on (id, runtime, vendor, display name) plus the default. `runtime` is the agent runtime that would drive the child and is the axis a spawn may not cross; `vendor` is only who serves the model. Called from a chat tab the list is already cut to your own runtime, because a child always runs the runtime you do. Called from a terminal harness it carries every runtime, because the app cannot tell which one you are — which is also why `model` is mandatory there. Call this before setting a model on start_conversation and pass an id that appears here; one from another runtime is refused, not substituted.',
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
		shape: { agentSessionId: z.string() },
	},
	{
		name: 'ensemblr_get_last_message',
		op: 'getLastMessage',
		description:
			"Get a Pi conversation's report: every assistant message of its newest answered turn, joined in the order it was written. Persisted, so it survives the conversation closing and an app restart.",
		shape: { agentSessionId: z.string() },
	},
	{
		name: 'ensemblr_read_conversation',
		op: 'readConversation',
		description:
			'Read what a Pi conversation actually did — its prompts, its answers, and every tool call with its arguments and result — rather than only the report ensemblr_get_last_message hands back. This is how you audit a sub-agent: confirm it ran what it claims to have run before you act on its findings. Call it with stat=true FIRST: that returns the entry count, the turn count, and the ordinal range with no content, so you know how much there is before you read it. Then page forward with fromOrdinal, resuming from the nextOrdinal each page returns, or pass ordinal to read a single entry whole — stat, ordinal, and fromOrdinal are alternatives, not a combination. Long fields are cut and marked with the ordinal that reads them in full.',
		shape: {
			agentSessionId: z.string(),
			stat: z.boolean().optional(),
			fromOrdinal: z.number().optional(),
			ordinal: z.number().optional(),
		},
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
	{
		name: 'ensemblr_ask_user_question',
		op: 'askUserQuestion',
		description:
			"Ask the human a multiple-choice question and block until they answer. Use this whenever a decision is genuinely the user's to make — ambiguous requirements, a fork in the approach, a destructive step, or missing context you cannot infer — instead of guessing or stopping to ask in prose. This call has no time limit: it stays open until the user answers or dismisses it, however long that takes, so treat it as a real wait rather than something that comes back on its own. Every question needs 2-6 concrete options; the user can also type a free-text answer or dismiss the dialog. Ask up to 4 related questions at once rather than calling this repeatedly. Do not use it for questions you can answer by reading the codebase.",
		shape: {
			questions: z
				.array(askQuestion)
				.min(1)
				.max(ASK_USER_QUESTION_LIMITS.maxQuestions),
		},
	},
	{
		name: 'ensemblr_exit_plan_mode',
		op: 'exitPlanMode',
		description:
			'Plan Mode only: hand the finished plan to the user and END YOUR TURN. Pass the full plan, in markdown, as `plan`; the app posts it into the conversation for the user to read and saves it to `.context/plans/`, so do NOT also write the plan out as your own reply and do NOT write the file yourself. It then shows the user Approve / Refine / Hand off. This call does not wait for them: it returns at once and your turn is over. Produce no output after it — whatever the user decides arrives as your next prompt. Call it only once you and the user share an understanding, never as an opening move.',
		shape: {
			title: z.string().max(EXIT_PLAN_MODE_LIMITS.maxTitleLength),
			plan: z.string().max(EXIT_PLAN_MODE_LIMITS.maxPlanLength),
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
 * The tools one caller's list carries, cut from the full vocabulary by the same
 * withholding policy the Pi extension applies to its own registrations.
 * @param audience - Whether the caller has a chat tab, and its lineage role.
 * @returns The definitions to register for that caller.
 */
export function toolDefsFor(audience: ControlAudience): readonly McpToolDef[] {
	const withheld = withheldControlOps(audience);
	return TOOL_DEFS.filter((def) => !withheld.has(def.op));
}

/**
 * Resolves the `instructions` a connection carries: the caller's playbook, plus
 * the language directive for a caller with no per-turn channel to receive it on.
 * A caller with a chat tab is one the app prompts itself and already appends the
 * directive per turn, so adding it here would only say the same thing twice.
 * @param service - Agent-control service holding the resolved app language.
 * @param audience - Whether the caller has a chat tab, and its lineage role.
 * @returns The instructions to serve alongside this caller's tool list.
 */
function instructionsFor(
	service: AgentControlService,
	audience: ControlAudience,
): string {
	const playbook = awarenessForAudience(audience);
	if (audience.hasChatTab) {
		return playbook;
	}
	const directive = service.readLanguageDirective();
	return directive ? `${playbook}\n\n${directive}` : playbook;
}

/**
 * Builds a fresh MCP server whose tools forward to the control service under a
 * fixed token, carrying the tool list and playbook this caller should hold.
 * @param service - Agent-control service every tool delegates to.
 * @param token - Per-request bearer token identifying the caller.
 * @param audience - Whether the caller has a chat tab, and its lineage role.
 * @returns A configured, not-yet-connected MCP server.
 */
function buildMcpServer(
	service: AgentControlService,
	token: string,
	audience: ControlAudience,
): McpServer {
	const server = new McpServer(
		{ name: 'ensemblr-control', version: '1.0.0' },
		{ instructions: instructionsFor(service, audience) },
	);
	for (const def of toolDefsFor(audience)) {
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
 * Handles a single MCP streamable-HTTP request end to end (stateless). The
 * caller's audience is resolved per request because the server is rebuilt per
 * request; the service owns that resolution, so identity is never re-derived
 * here from anything the caller supplied.
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
	const server = buildMcpServer(
		service,
		token,
		await service.describeAudience(token),
	);
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
