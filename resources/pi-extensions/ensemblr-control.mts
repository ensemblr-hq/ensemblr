/**
 * Ensemblr Control — a Pi extension that lets a Pi agent drive the Ensemblr app
 * it runs inside. Each tool forwards to the app's loopback control server
 * (`ENSEMBLR_CONTROL_URL`) authenticated by the per-workspace token
 * (`ENSEMBLR_CONTROL_TOKEN`) injected into the Pi child's environment. The app
 * validates, scopes, permission-gates, and guardrails every call — this file is
 * only a thin typed surface the model can invoke.
 *
 * Loaded via `pi --mode rpc -e <this file>`. Requires `typebox` resolvable at
 * runtime (declared in the sibling package.json).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { type Static, type TSchema, Type } from 'typebox';

const CONTROL_URL = process.env.ENSEMBLR_CONTROL_URL;
const CONTROL_TOKEN = process.env.ENSEMBLR_CONTROL_TOKEN;

/**
 * Role-aware control-layer playbooks injected into every turn. The app tells the
 * extension which role it is via `ENSEMBLR_CONTROL_ROLE`: an orchestrator (root)
 * that may delegate, or a sub-agent (spawned child) that does its delegated work
 * itself and never fans out. Both strings MUST stay byte-identical to the shared
 * `ORCHESTRATOR_AWARENESS` / `SUBAGENT_AWARENESS` in
 * `src/shared/agent-control/awareness.ts` — the extension cannot import from
 * `src/` at runtime, and a parity test asserts the two never drift.
 * `docs/considerations/agent-orchestration-playbook.md` is the human reference.
 */
const ORCHESTRATOR_AWARENESS = `You are running inside Ensemblr, a desktop coding-workspace app, and you can drive the app itself with the Ensemblr control tools (prefixed \`ensemblr_\`).

What you can drive:
- Conversations: open a chat tab and start a Pi sub-agent (\`ensemblr_start_conversation\`), steer one (\`ensemblr_send_follow_up\`), name your own tab (\`ensemblr_set_name\`), close a tab (\`ensemblr_close_tab\`).
- Harnesses: launch Claude Code / Codex in a terminal (\`ensemblr_launch_harness\`).
- Terminals: start/stop the setup or run script, or a spawn terminal (\`ensemblr_start_terminal\`/\`ensemblr_stop_terminal\`); type into one (\`ensemblr_write_terminal\`); read its output (\`ensemblr_read_terminal_output\`).
- Focus & inspect: bring a tab/terminal or the Files/Changes/Checks panel forward (\`ensemblr_focus_tab\`/\`ensemblr_focus_dock_tab\`/\`ensemblr_focus_panel\`); list workspaces/tabs/terminals; read a conversation's status or last message.
- Board: move your workspace across the kanban board and read its status (\`ensemblr_set_workspace_status\`/\`ensemblr_get_workspace_status\`); \`ensemblr_list_workspaces\` shows every workspace's board status.
- Ask the user: when a decision is genuinely theirs — ambiguous requirements, a fork in the approach, a destructive step — put it to them with \`ensemblr_ask_user_question\` (up to 4 questions, each with 2-6 concrete options) instead of guessing or stalling. It blocks until they answer, and they can type their own answer or dismiss it.

Name your own conversation tab early with a short, descriptive title via \`ensemblr_set_name\` so it is easy to identify at a glance.

Write every file path you mention in prose as its full path from the workspace root, in backticks — \`src/renderer/components/message.tsx\`, never a bare \`message.tsx\` or a trailing fragment like \`components/message.tsx\`. The app renders those as chips the user clicks to open the file, and it can only do that for a path it can place in the file tree.

Do the work yourself by default — one agent in one thread is the right tool for almost every task. Delegate ONLY when the task genuinely splits into two or more independent, substantial workstreams that can run in parallel. Never spawn a helper to do a single unit of work you could do in one pass, and never delegate a task just because you can. Do not tell the user to click; drive the app yourself.

When delegation is warranted — delegate → wait → evaluate → integrate:
1. Spawn each helper with \`ensemblr_start_conversation\` in its own fresh tab — pass a short, descriptive \`title\` and do NOT pass \`chatTabId\` (reusing a prior tab keeps its old title); omit \`wait\` and keep the \`piSessionId\` it returns.
2. Once you have delegated everything you can in parallel, call \`ensemblr_wait_for_agents\` and let it block — this is how you avoid racing ahead. Do NOT hand-roll a polling loop with \`ensemblr_get_conversation_status\`; the wait tool parks your turn efficiently and returns the moment a child finishes or needs you.
   - \`mode: "all"\` (default target: every child you spawned) blocks until they have all finished.
   - \`mode: "first"\` returns as soon as any one child finishes or raises a signal — use it to react to whichever lands first.
   - It returns each settled child's status and last message, plus any \`signal\` a child sent. A child that hits a decision point calls \`ensemblr_notify_orchestrator\` with reason \`need_decision\` or \`blocked\`, which wakes your wait immediately so you can answer.
3. Evaluate each result. If a child is wrong, incomplete, or asked you something, reply with \`ensemblr_send_follow_up\` and call \`ensemblr_wait_for_agents\` again. Repeat until done.
4. Integrate the outcomes into your own answer, and focus the relevant view so the user can follow along.

A child's last message is its report and is persisted permanently — it survives the child closing and even an app restart. If your wait is ever interrupted (for example the app restarts) and a child then shows a \`closed\` or \`idle\` status, read its result with \`ensemblr_get_last_message\` before reacting — \`closed\` means the child ended, not that its work was lost, and \`ensemblr_get_conversation_status\` reports \`hasFinalMessage: true\` whenever that report is still there. Never re-spawn a child to redo work whose report you can still read.

Model selection: to run a child on a specific model, first call \`ensemblr_list_models\` and pass a \`model\` id that appears in that list (prefer the same provider you are on). If you omit \`model\`, the child inherits your model when it is available, otherwise the app default. Never invent or guess a model id.

Etiquette & limits:
- Delegation is shallow by design — only you, the root, may spawn; children do their own work and cannot delegate onward. Depth, per-session spawn count, and spawn rate are capped; never fork-bomb.
- Writes act only on your own workspace; reads may span all open workspaces — inspect before acting.
- Clean up scratch tabs you created (\`ensemblr_close_tab\`).
- Actions may prompt the user for approval depending on the workspace permission mode; expect and handle denials gracefully.`;

const SUBAGENT_AWARENESS = `You are running inside Ensemblr, a desktop coding-workspace app, and you can drive the app itself with the Ensemblr control tools (prefixed \`ensemblr_\`).

What you can drive:
- Conversations: open a chat tab and start a Pi sub-agent (\`ensemblr_start_conversation\`), steer one (\`ensemblr_send_follow_up\`), name your own tab (\`ensemblr_set_name\`), close a tab (\`ensemblr_close_tab\`).
- Harnesses: launch Claude Code / Codex in a terminal (\`ensemblr_launch_harness\`).
- Terminals: start/stop the setup or run script, or a spawn terminal (\`ensemblr_start_terminal\`/\`ensemblr_stop_terminal\`); type into one (\`ensemblr_write_terminal\`); read its output (\`ensemblr_read_terminal_output\`).
- Focus & inspect: bring a tab/terminal or the Files/Changes/Checks panel forward (\`ensemblr_focus_tab\`/\`ensemblr_focus_dock_tab\`/\`ensemblr_focus_panel\`); list workspaces/tabs/terminals; read a conversation's status or last message.
- Board: move your workspace across the kanban board and read its status (\`ensemblr_set_workspace_status\`/\`ensemblr_get_workspace_status\`); \`ensemblr_list_workspaces\` shows every workspace's board status.
- Ask the user: when a decision is genuinely theirs — ambiguous requirements, a fork in the approach, a destructive step — put it to them with \`ensemblr_ask_user_question\` (up to 4 questions, each with 2-6 concrete options) instead of guessing or stalling. It blocks until they answer, and they can type their own answer or dismiss it.

Name your own conversation tab early with a short, descriptive title via \`ensemblr_set_name\` so it is easy to identify at a glance.

Write every file path you mention in prose as its full path from the workspace root, in backticks — \`src/renderer/components/message.tsx\`, never a bare \`message.tsx\` or a trailing fragment like \`components/message.tsx\`. The app renders those as chips the user clicks to open the file, and it can only do that for a path it can place in the file tree.

You were spawned as a sub-agent to carry out one delegated unit of work. Name your own tab first with \`ensemblr_set_name\` — a short label for your task — so the user can tell your tab apart. Then do the work yourself, end to end — the last message you leave is your report back to the orchestrator that spawned you. Do NOT spawn further sub-agents, launch harnesses, or delegate onward; that is the orchestrator's job and nested delegation is blocked. If you are blocked, or you hit a decision you genuinely cannot make alone, call \`ensemblr_notify_orchestrator\` (reason \`need_decision\` or \`blocked\`) instead of guessing or stalling — it pulls your orchestrator back to you; use \`progress\`/\`done\` to keep it informed. Do not tell the user to click; drive the app yourself.

You may still read and inspect freely — list workspaces/tabs/terminals, read a conversation's status or last message, read terminal output — and focus a view so the user can follow along.

Etiquette & limits:
- Writes act only on your own workspace; reads may span all open workspaces — inspect before acting.
- Clean up scratch tabs you created (\`ensemblr_close_tab\`).
- Actions may prompt the user for approval depending on the workspace permission mode; expect and handle denials gracefully.`;

/**
 * Self-contained playbook served in place of the role playbook for every turn
 * the conversation spends in Plan Mode. MUST stay byte-identical to
 * `PLAN_MODE_AWARENESS` in `src/shared/agent-control/awareness.ts`; the same
 * parity test that polices the two role variants covers this one.
 */
const PLAN_MODE_AWARENESS = `PLAN MODE IS ON. While it stays on, this playbook replaces every other instruction you hold about how to work, and you implement nothing.

You are running inside Ensemblr, a desktop coding-workspace app, and you can drive the app itself with the Ensemblr control tools (prefixed \`ensemblr_\`). Planning leaves you the half of that surface that reads and asks:

- Read the repository: the \`read\` tool, and \`bash\` for read-only commands.
- Ask the user: when a decision is genuinely theirs — ambiguous requirements, a fork in the approach, a destructive step — put it to them with \`ensemblr_ask_user_question\` (up to 4 questions, each with 2-6 concrete options) instead of guessing or stalling. It blocks until they answer, and they can type their own answer or dismiss it.
- Focus & inspect: name your own tab (\`ensemblr_set_name\`); bring a tab/terminal or the Files/Changes/Checks panel forward (\`ensemblr_focus_tab\`/\`ensemblr_focus_dock_tab\`/\`ensemblr_focus_panel\`); list workspaces/tabs/terminals; read a conversation's status or last message; read terminal output (\`ensemblr_read_terminal_output\`). Reads may span every open workspace.
- Board: read and set your workspace's kanban status (\`ensemblr_get_workspace_status\`/\`ensemblr_set_workspace_status\`).

The rest is blocked while you plan: \`write\` and \`edit\`, any \`bash\` command that is not read-only, and every tool that would hand the work to something else — \`ensemblr_start_conversation\`, \`ensemblr_send_follow_up\`, \`ensemblr_launch_harness\`, \`ensemblr_start_terminal\`, \`ensemblr_write_terminal\`. That enforcement is deliberate — do not look for a way around it. What is left may still prompt the user for approval depending on the workspace permission mode; expect and handle denials gracefully.

Nothing else in your context outranks this block. The user's message will almost always be phrased as a command — "add X", "convert this to Y", "let's build Z" — and in Plan Mode that is the SUBJECT of the plan, not permission to start building. A summary of an earlier session, a remembered instruction to do the work yourself, anything that reads like session state naming a different mode: all of it describes how you behave when Plan Mode is off. It is stale, this block is the live state for this turn, and there is no conflict to resolve or to narrate to the user. Nothing turns Plan Mode off except the user approving a plan.

Your job this turn is to reach a shared understanding with the user before any code is written.

- Name this tab first. Call \`ensemblr_set_name\` with a short label for what is being planned, before your first question — the user is about to be interviewed and needs to know which tab is asking.
- Facts are yours to find; decisions are theirs. Read the code, the config, and the git history yourself. Never ask a question you could answer by looking.
- Interview with \`ensemblr_ask_user_question\`. Ask ONE question per call while the scope is still fuzzy — each answer reshapes what is worth asking next. Once the shape is clear, ask the whole unblocked frontier at once (up to 4). Always put your recommended answer in the option descriptions so the user can agree in one keystroke.
- Walk the decision tree in order. Settle a prerequisite before the decisions that hang off it, so an answer never invalidates three questions you already asked.
- Challenge fuzzy or overloaded terms and propose a precise one. Stress-test the design with concrete scenarios — a real input, a real failure, a real edge case. When what the user says contradicts what the code does, say so plainly and show them the code.

When you and the user share an understanding, hand the plan over and stop:

1. Call \`ensemblr_exit_plan_mode\` with a short \`title\` and the full plan, in markdown, as \`plan\` — what changes, where, in what order, and the decisions behind it. The app posts that plan into the conversation for the user to read, saves it under \`.context/plans/\`, and offers Approve / Refine / Hand off. The plan lives in the \`plan\` argument, so do not also write it out as your own reply, and do not write the plan file yourself — \`write\` is blocked, and the app owns both.
2. Your turn is over. The tool does not wait for the user, and the app stops you the moment it returns. Produce nothing after it — no plan restated in prose, no closing summary, no "let me know what you think", no first implementation step. The app has already posted the plan; leave it as the last message while the user reads it.

Their decision comes back to you as your NEXT prompt, not as the tool result:

- Approve — they send you an approval prompt with Plan Mode off. Implement the plan, starting immediately.
- Refine — they type their changes into the composer with Plan Mode still on. Fold them in and call the tool again with the revised plan.
- Hand off — another conversation picks the plan up and you hear nothing more. Nothing is expected of you.`;

/**
 * Selects the role playbook for this Pi child from the app-injected role env
 * var; a missing or unrecognized value defaults to the orchestrator playbook.
 * Plan Mode replaces this playbook rather than stacking on top of it.
 */
const AWARENESS =
	process.env.ENSEMBLR_CONTROL_ROLE === 'subagent'
		? SUBAGENT_AWARENESS
		: ORCHESTRATOR_AWARENESS;

/**
 * Built-in Pi tools Plan Mode restricts; everything else runs untouched. MUST
 * hold the same members as `PLAN_MODE_GUARDED_TOOLS` in
 * `src/shared/plan-mode/tool-guard.ts` (this file cannot import from `src/` at
 * runtime); a parity test enforces it. A mutation tool missing from both is
 * never forwarded and bypasses Plan Mode silently.
 */
const PLAN_MODE_GUARDED_TOOLS = new Set(['bash', 'edit', 'write']);

interface ControlResult {
	ok: boolean;
	code?: string;
	error?: string;
	data?: unknown;
}

/**
 * Type guard for the app's control envelope, so an HTTP error body that is not
 * a well-formed envelope is not mistaken for a valid result.
 * @param value - Parsed response body.
 * @returns True when the value has the `{ ok: boolean }` envelope shape.
 */
function isControlResult(value: unknown): value is ControlResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { ok?: unknown }).ok === 'boolean'
	);
}

/**
 * Posts a control op to the Ensemblr app and returns its result envelope.
 * @param op - Canonical control op name (e.g. `spawnChatTab`).
 * @param args - Validated tool arguments.
 * @returns The app's `{ ok, data | code, error }` envelope.
 */
async function invoke(
	op: string,
	args: unknown,
	callerModel: string | undefined,
): Promise<ControlResult> {
	if (!CONTROL_URL || !CONTROL_TOKEN) {
		return {
			ok: false,
			code: 'internal',
			error: 'Control channel not configured.',
		};
	}
	try {
		const response = await fetch(`${CONTROL_URL}/invoke`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${CONTROL_TOKEN}`,
			},
			body: JSON.stringify({ op, args, callerModel }),
		});
		if (!response.ok) {
			// The app answers 4xx/5xx with the same JSON envelope, so parse the
			// error body for its reason instead of treating the status alone.
			const errorBody = await response.json().catch(() => undefined);
			if (isControlResult(errorBody)) {
				return errorBody;
			}
			return {
				ok: false,
				code: 'internal',
				error: `Control channel returned HTTP ${response.status} with an unexpected body.`,
			};
		}
		const body = await response.json().catch(() => undefined);
		if (isControlResult(body)) {
			return body;
		}
		return {
			ok: false,
			code: 'internal',
			error: 'Control channel returned an unexpected body.',
		};
	} catch (error) {
		return {
			ok: false,
			code: 'internal',
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Reads the calling agent's current model id from the extension context, so a
 * spawned conversation can inherit the master's model when none is specified.
 * @param ctx - The Pi extension context passed to a tool's execute.
 * @returns The model id, or undefined when unavailable.
 */
function callerModelId(ctx: { model?: { id?: string } } | undefined) {
	return ctx?.model?.id;
}

/**
 * Asks the app whether this conversation is in Plan Mode, so the planning
 * playbook stands in for the role one only while planning. A transport failure
 * reports "not planning": the prompt text is cosmetic, and real enforcement
 * lives in the `tool_call` hook, which asks the app per call and fails closed on
 * its own.
 * @returns True when the app reports Plan Mode is on.
 */
async function fetchPlanMode(): Promise<boolean> {
	const result = await invoke('getPlanMode', {}, undefined);
	if (!result.ok) {
		return false;
	}
	return (result.data as { active?: boolean } | undefined)?.active === true;
}

/**
 * Renders a control result as a Pi tool result.
 * @param result - The app's control envelope.
 * @returns A tool result with text content and structured details.
 */
function toToolResult(result: ControlResult) {
	const text = result.ok
		? JSON.stringify(result.data ?? { ok: true })
		: `Error (${result.code ?? 'internal'}): ${result.error ?? 'unknown'}`;
	return { content: [{ type: 'text' as const, text }], details: result };
}

/**
 * Ensemblr Control extension entry point. Registers one tool per control op.
 * @param pi - The Pi extension API.
 */
export default function ensemblrControl(pi: ExtensionAPI): void {
	if (!CONTROL_URL || !CONTROL_TOKEN) {
		return;
	}

	pi.on('before_agent_start', async (event) => {
		const planning = await fetchPlanMode();
		const playbook = planning ? PLAN_MODE_AWARENESS : AWARENESS;
		return { systemPrompt: `${event.systemPrompt}\n\n${playbook}` };
	});

	// Enforcement asks the app on every guarded call rather than trusting a
	// per-turn cache: the user can approve a plan mid-turn, and a stale "not
	// planning" cache would silently let the agent edit files it was told not to.
	pi.on('tool_call', async (event) => {
		if (!PLAN_MODE_GUARDED_TOOLS.has(event.toolName)) {
			return;
		}
		const result = await invoke(
			'checkPlanModeTool',
			{
				command: (event.input as { command?: string } | undefined)?.command,
				tool: event.toolName,
			},
			undefined,
		);
		if (!result.ok) {
			return {
				block: true,
				reason: `Ensemblr could not confirm whether Plan Mode is on (${result.error ?? 'control channel unavailable'}), so this tool call was blocked. Retry, or tell the user the app is unreachable.`,
			};
		}
		const verdict = result.data as { blocked?: boolean; reason?: string };
		return verdict.blocked
			? { block: true, reason: verdict.reason }
			: undefined;
	});

	const tool = <TParams extends TSchema>(
		name: string,
		op: string,
		description: string,
		parameters: TParams,
	): void => {
		pi.registerTool<TParams>({
			name,
			description,
			parameters,
			execute: async (
				_toolCallId: string,
				params: Static<TParams>,
				_signal: unknown,
				_onUpdate: unknown,
				ctx: { model?: { id?: string } },
			) => toToolResult(await invoke(op, params, callerModelId(ctx))),
		});
	};

	const empty = Type.Object({});

	tool(
		'ensemblr_spawn_chat_tab',
		'spawnChatTab',
		'Open a new empty chat tab in the current workspace.',
		Type.Object({ title: Type.Optional(Type.String()) }),
	);
	tool(
		'ensemblr_start_conversation',
		'startConversation',
		"Open a fresh chat tab (or reuse one via chatTabId) and start a Pi conversation with a first prompt. Pass a short, descriptive title to name the sub-agent's tab. Set wait=true to block until it finishes.",
		Type.Object({
			chatTabId: Type.Optional(Type.String()),
			prompt: Type.String(),
			model: Type.Optional(Type.String()),
			thinkingLevel: Type.Optional(Type.String()),
			title: Type.Optional(Type.String()),
			wait: Type.Optional(Type.Boolean()),
		}),
	);
	tool(
		'ensemblr_send_follow_up',
		'sendFollowUp',
		'Send a follow-up prompt into an existing Pi conversation.',
		Type.Object({
			piSessionId: Type.String(),
			prompt: Type.String(),
			wait: Type.Optional(Type.Boolean()),
		}),
	);
	tool(
		'ensemblr_set_name',
		'setName',
		'Set a short, descriptive name for your own conversation tab so it is easy to identify.',
		Type.Object({ name: Type.String() }),
	);
	tool(
		'ensemblr_close_tab',
		'closeTab',
		'Close a chat or terminal tab in the current workspace.',
		Type.Object({ chatTabId: Type.String() }),
	);
	tool(
		'ensemblr_launch_harness',
		'launchHarness',
		'Launch a third-party agent harness (e.g. claude, codex, vibe) in a new terminal tab.',
		Type.Object({ harnessId: Type.String() }),
	);
	tool(
		'ensemblr_start_terminal',
		'startTerminal',
		'Start a dock terminal: the setup script, the run script, or an interactive spawn terminal.',
		Type.Object({
			kind: Type.Union([
				Type.Literal('setup'),
				Type.Literal('run'),
				Type.Literal('spawn'),
			]),
		}),
	);
	tool(
		'ensemblr_stop_terminal',
		'stopTerminal',
		'Stop a dock terminal by id, or stop the setup/run script by kind.',
		Type.Object({
			terminalId: Type.Optional(Type.String()),
			kind: Type.Optional(
				Type.Union([Type.Literal('setup'), Type.Literal('run')]),
			),
		}),
	);
	tool(
		'ensemblr_write_terminal',
		'writeTerminal',
		'Write input into an existing terminal or harness (drives its stdin).',
		Type.Object({ terminalId: Type.String(), input: Type.String() }),
	);
	tool(
		'ensemblr_open_tab',
		'openTab',
		'Open a non-chat tab: a file preview, a diff, or a PR-comment preview.',
		Type.Object({
			variant: Type.Union([
				Type.Literal('file'),
				Type.Literal('diff'),
				Type.Literal('comment'),
			]),
			filePath: Type.Optional(Type.String()),
			turnId: Type.Optional(Type.String()),
			commentBody: Type.Optional(Type.String()),
			prNumber: Type.Optional(Type.Number()),
		}),
	);
	tool(
		'ensemblr_focus_tab',
		'focusTab',
		'Bring a session tab (chat/terminal/diff/file) to the foreground by id.',
		Type.Object({ chatTabId: Type.String() }),
	);
	tool(
		'ensemblr_focus_dock_tab',
		'focusDockTab',
		'Focus a dock terminal by id, or the setup/run script tab by kind.',
		Type.Object({
			terminalId: Type.Optional(Type.String()),
			kind: Type.Optional(
				Type.Union([Type.Literal('setup'), Type.Literal('run')]),
			),
		}),
	);
	tool(
		'ensemblr_focus_panel',
		'focusPanel',
		'Focus the Files, Changes, or Checks review panel.',
		Type.Object({
			panel: Type.Union([
				Type.Literal('files'),
				Type.Literal('changes'),
				Type.Literal('checks'),
			]),
		}),
	);
	tool(
		'ensemblr_set_workspace_status',
		'setWorkspaceStatus',
		'Move your workspace across the kanban board by setting its status (backlog, in-progress, in-review, done, canceled). Acts on your own workspace.',
		Type.Object({
			status: Type.Union([
				Type.Literal('backlog'),
				Type.Literal('in-progress'),
				Type.Literal('in-review'),
				Type.Literal('done'),
				Type.Literal('canceled'),
			]),
		}),
	);
	tool(
		'ensemblr_get_workspace_status',
		'getWorkspaceStatus',
		"Read your workspace's current kanban board status. Use ensemblr_list_workspaces to see every workspace's status.",
		empty,
	);
	tool(
		'ensemblr_list_models',
		'listModels',
		'List the Pi models available in this app (id, provider, display name) plus the default. Call this before setting a model on start_conversation; only pass a model id that appears here, preferably from the same provider.',
		empty,
	);
	tool(
		'ensemblr_list_workspaces',
		'listWorkspaces',
		'List all open workspaces (id, name, cwd).',
		empty,
	);
	tool(
		'ensemblr_list_tabs',
		'listTabs',
		'List open tabs, defaulting to the current workspace.',
		Type.Object({ workspaceId: Type.Optional(Type.String()) }),
	);
	tool(
		'ensemblr_list_terminals',
		'listTerminals',
		'List terminals, defaulting to the current workspace.',
		Type.Object({ workspaceId: Type.Optional(Type.String()) }),
	);
	tool(
		'ensemblr_get_conversation_status',
		'getConversationStatus',
		'Get the status of a Pi conversation by session id.',
		Type.Object({ piSessionId: Type.String() }),
	);
	tool(
		'ensemblr_get_last_message',
		'getLastMessage',
		'Get the last assistant message text of a Pi conversation.',
		Type.Object({ piSessionId: Type.String() }),
	);
	tool(
		'ensemblr_read_terminal_output',
		'readTerminalOutput',
		'Read the current scrollback of a terminal or harness.',
		Type.Object({ terminalId: Type.String() }),
	);
	tool(
		'ensemblr_wait_for_agents',
		'waitForAgents',
		'Block until delegated Pi sub-agents finish or need a decision, then return each one\'s status and last message. Prefer this over polling get_conversation_status. targets defaults to every child you spawned; mode "all" waits for all of them, mode "first" returns on the first to settle.',
		Type.Object({
			targets: Type.Optional(Type.Array(Type.String())),
			mode: Type.Optional(
				Type.Union([Type.Literal('first'), Type.Literal('all')]),
			),
			timeoutMs: Type.Optional(Type.Number()),
		}),
	);
	tool(
		'ensemblr_notify_orchestrator',
		'notifyOrchestrator',
		'Sub-agents only: notify the orchestrator that spawned you. reason need_decision/blocked wakes its wait immediately so it can answer; progress/done are informational.',
		Type.Object({
			reason: Type.Union([
				Type.Literal('need_decision'),
				Type.Literal('blocked'),
				Type.Literal('progress'),
				Type.Literal('done'),
			]),
			message: Type.String(),
		}),
	);
	tool(
		'ensemblr_ask_user_question',
		'askUserQuestion',
		"Ask the human a multiple-choice question and block until they answer. Use this whenever a decision is genuinely the user's to make — ambiguous requirements, a fork in the approach, a destructive step, or missing context you cannot infer — instead of guessing or stopping to ask in prose. Every question needs 2-6 concrete options; the user can also type a free-text answer or dismiss the dialog. Ask up to 4 related questions at once rather than calling this repeatedly. Do not use it for questions you can answer by reading the codebase.",
		Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({
						description: 'The full question, phrased for a human.',
					}),
					header: Type.Optional(
						Type.String({
							description:
								'Short pager label, 16 characters or fewer, distinct from the other questions’ headers.',
						}),
					),
					options: Type.Array(
						Type.Object({
							label: Type.String({
								description:
									'Short, concrete choice — a few words, 80 characters at most, distinct within the question. Do not use "Other" or "Next": the dialog always offers a free-text row of its own, and those labels are rejected.',
							}),
							description: Type.Optional(
								Type.String({
									description: 'The trade-off this choice implies.',
								}),
							),
						}),
						{ minItems: 2, maxItems: 6 },
					),
					multiSelect: Type.Optional(
						Type.Boolean({
							description: 'Let the user pick several options.',
						}),
					),
				}),
				{ minItems: 1, maxItems: 4 },
			),
		}),
	);
	pi.registerTool({
		name: 'ensemblr_exit_plan_mode',
		description:
			'Plan Mode only: hand the finished plan to the user and END YOUR TURN. Pass the full plan, in markdown, as `plan`; the app posts it into the conversation for the user to read and saves it to `.context/plans/`, so do NOT also write the plan out as your own reply and do NOT write the file yourself. It then shows the user Approve / Refine / Hand off. This call does not wait for them: it returns at once and your turn is over. Produce no output after it — whatever the user decides arrives as your next prompt. Call it only once you and the user share an understanding, never as an opening move.',
		parameters: Type.Object({
			title: Type.String({
				description:
					'Short label for the plan, 80 characters at most. Also becomes the saved filename.',
			}),
			plan: Type.String({
				description:
					'The full plan in markdown: what changes, where, in what order, and the decisions behind it.',
			}),
		}),
		execute: async (
			_toolCallId: string,
			params: { title: string; plan: string },
			_signal: unknown,
			_onUpdate: unknown,
			ctx: { model?: { id?: string }; abort?: () => void },
		) => {
			const result = await invoke('exitPlanMode', params, callerModelId(ctx));
			// Ending the turn is the contract, so enforce it rather than trusting
			// the model to stop on its own. Deferred by a tick so this tool result
			// is delivered first and the plan stays the last message.
			if (result.ok) {
				setTimeout(() => ctx.abort?.(), 0);
			}
			return toToolResult(result);
		},
	});
}
