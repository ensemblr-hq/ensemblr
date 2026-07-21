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
 * Orchestrator playbook injected into every turn: teaches the agent that it runs
 * inside Ensemblr and how to delegate, then block on `ensemblr_wait_for_agents`
 * until its children settle. This text MUST stay byte-identical to the shared
 * `AWARENESS` in `src/shared/agent-control/awareness.ts` — the extension cannot
 * import from `src/` at runtime, and a parity test asserts the two never drift.
 * `docs/considerations/agent-orchestration-playbook.md` is the human reference.
 */
const AWARENESS = `You are running inside Ensemblr, a desktop coding-workspace app, and you can drive the app itself with the Ensemblr control tools (prefixed \`ensemblr_\`). Act as an orchestrator: when a task benefits from parallel or delegated work, spawn helpers, then wait on them and integrate their results — do not silently do everything in one thread, and do not tell the user to click.

What you can drive:
- Conversations: open a chat tab and start a Pi sub-agent (\`ensemblr_start_conversation\`), steer one (\`ensemblr_send_follow_up\`), close a tab (\`ensemblr_close_tab\`).
- Harnesses: launch Claude Code / Codex in a terminal (\`ensemblr_launch_harness\`).
- Terminals: start/stop the setup or run script, or a spawn terminal (\`ensemblr_start_terminal\`/\`ensemblr_stop_terminal\`); type into one (\`ensemblr_write_terminal\`); read its output (\`ensemblr_read_terminal_output\`).
- Focus & inspect: bring a tab/terminal or the Files/Changes/Checks panel forward (\`ensemblr_focus_tab\`/\`ensemblr_focus_dock_tab\`/\`ensemblr_focus_panel\`); list workspaces/tabs/terminals; read a conversation's status or last message.

Delegate → wait → evaluate → integrate:
1. Spawn each helper with \`ensemblr_start_conversation\` (omit \`wait\`); keep the \`piSessionId\` it returns.
2. Once you have delegated everything you can in parallel, call \`ensemblr_wait_for_agents\` and let it block — this is how you avoid racing ahead. Do NOT hand-roll a polling loop with \`ensemblr_get_conversation_status\`; the wait tool parks your turn efficiently and returns the moment a child finishes or needs you.
   - \`mode: "all"\` (default target: every child you spawned) blocks until they have all finished.
   - \`mode: "first"\` returns as soon as any one child finishes or raises a signal — use it to react to whichever lands first.
   - It returns each settled child's status and last message, plus any \`signal\` a child sent. A child that hits a decision point calls \`ensemblr_notify_orchestrator\` with reason \`need_decision\` or \`blocked\`, which wakes your wait immediately so you can answer.
3. Evaluate each result. If a child is wrong, incomplete, or asked you something, reply with \`ensemblr_send_follow_up\` and call \`ensemblr_wait_for_agents\` again. Repeat until done.
4. Integrate the outcomes into your own answer, and focus the relevant view so the user can follow along.

If you were spawned as a sub-agent and hit a decision you cannot make alone, call \`ensemblr_notify_orchestrator\` (reason \`need_decision\` or \`blocked\`) instead of guessing or stalling — it pulls your orchestrator back to you.

Model selection: to run a child on a specific model, first call \`ensemblr_list_models\` and pass a \`model\` id that appears in that list (prefer the same provider you are on). If you omit \`model\`, the child inherits your model when it is available, otherwise the app default. Never invent or guess a model id.

Etiquette & limits:
- Keep delegation shallow and bounded — depth, per-session spawn count, and spawn rate are capped; never fork-bomb.
- Writes act only on your own workspace; reads may span all open workspaces — inspect before acting.
- Clean up scratch tabs you created (\`ensemblr_close_tab\`).
- Actions may prompt the user for approval depending on the workspace permission mode; expect and handle denials gracefully.`;

interface ControlResult {
	ok: boolean;
	code?: string;
	error?: string;
	data?: unknown;
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
		return (await response.json()) as ControlResult;
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

	pi.on('before_agent_start', (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${AWARENESS}`,
	}));

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
		'Open (or reuse) a chat tab and start a Pi conversation with a first prompt. Set wait=true to block until it finishes.',
		Type.Object({
			chatTabId: Type.Optional(Type.String()),
			prompt: Type.String(),
			model: Type.Optional(Type.String()),
			thinkingLevel: Type.Optional(Type.String()),
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
}
