import type { DynamicToolUIPart } from 'ai';
import type { ToolGlyph } from '@/renderer/types/tool-presentation';

/**
 * How the app's own control tools read in the timeline.
 *
 * The `ensemblr_*` tools drive the app rather than the repository, so the
 * generic extension row serves them badly: it titles the row with the raw wire
 * name and unfolds the whole argument payload, which for a session summary means
 * pretty-printing several thousand characters of markdown the user already has.
 * This module supplies the label and mark each one deserves, and names the three
 * that should not appear at all.
 *
 * The hidden set is the bookkeeping the app asks for on its own behalf — naming
 * the tab, naming the workspace and branch, recording the session summary. The
 * user did not request it, its result is already visible as the tab title or the
 * branch name, and a row for it costs the turn a line of attention. Hiding it
 * also keeps a turn's closing prose where the user can read it: the timeline
 * promotes only the run of text that follows the turn's last visible tool call,
 * so a summary call filed after the answer would fold that answer away.
 *
 * A failed call is never hidden. The denial codes these tools return —
 * `denied-permission`, `denied-scope`, `invalid-args` — are exactly what a user
 * needs to see, so only a call that succeeded disappears. A refusal reaches the
 * timeline as an ordinary result rather than as a transport error, so it is the
 * `{ ok: false }` envelope on the result's `details`, not the error text, that
 * separates the two.
 *
 * Every lookup here goes through {@link canonicalEnsemblrToolName} rather than
 * the reported name, because only one of the two runtimes reports the name the
 * control extension registered.
 */

/** Wire-name prefix shared by every tool the app's control extension registers. */
const CONTROL_TOOL_PREFIX = 'ensemblr_';

/** Wire names of the bookkeeping calls the timeline omits when they succeed. */
const BOOKKEEPING_TOOL_NAMES: ReadonlySet<string> = new Set([
	'ensemblr_set_branch_name',
	'ensemblr_set_name',
	'ensemblr_set_summary',
]);

/**
 * Title and mark for one control tool, before its arguments are read.
 *
 * The verb is held as a pair rather than as a finished title so that a call
 * still in flight reads in the present participle — `ensemblr_wait_for_agents`
 * blocks for as long as its children run, and "Waited for sub-agents" over a
 * turn that is still working describes something that has not happened yet.
 * Pairing the two forms in a tuple makes a missing tense a type error.
 */
interface EnsemblrToolLabel {
	glyph: ToolGlyph;
	/** What the verb acts on, e.g. `for sub-agents`. */
	object: string;
	/** The verb as `[settled, in flight]`, e.g. `['Waited', 'Waiting']`. */
	verb: readonly [string, string];
	/**
	 * Input paths whose value is appended to the title, first match winning. A
	 * path may step into a batch — `comments.0.filePath` — so a call that carries
	 * its subject inside an array still names it.
	 */
	detailKeys?: readonly string[];
}

/**
 * The label each control tool answers to. Titles read as the action taken rather
 * than the tool called, because the user is watching the app being driven and
 * has no use for the name of the lever. Glyphs name the action too, so a folded
 * turn's strip of marks distinguishes starting a terminal from stopping one.
 *
 * Detail keys are the canonical argument names from
 * `src/shared/agent-control/arg-naming.ts`, followed by the near-misses that
 * table forgives — the boundary rewrites `file` to `filePath` before the op
 * runs, but the timeline records the arguments as the model actually sent them.
 */
const ENSEMBLR_TOOL_LABELS: Record<string, EnsemblrToolLabel> = {
	ensemblr_ask_user_question: {
		detailKeys: ['questions.0.question'],
		glyph: 'message-circle-question',
		object: 'you a question',
		verb: ['Asked', 'Asking'],
	},
	ensemblr_close_tab: {
		glyph: 'square-x',
		object: 'a tab',
		verb: ['Closed', 'Closing'],
	},
	ensemblr_exit_plan_mode: {
		detailKeys: ['title'],
		glyph: 'clipboard-list',
		object: 'a plan',
		verb: ['Submitted', 'Submitting'],
	},
	ensemblr_focus_dock_tab: {
		detailKeys: ['kind'],
		glyph: 'crosshair',
		object: 'a terminal',
		verb: ['Focused', 'Focusing'],
	},
	ensemblr_focus_panel: {
		detailKeys: ['panel'],
		glyph: 'crosshair',
		object: 'a panel',
		verb: ['Focused', 'Focusing'],
	},
	ensemblr_focus_tab: {
		glyph: 'crosshair',
		object: 'a tab',
		verb: ['Focused', 'Focusing'],
	},
	ensemblr_add_diff_comments: {
		detailKeys: ['comments.0.filePath'],
		glyph: 'message-square-plus',
		object: 'review comments',
		verb: ['Left', 'Leaving'],
	},
	ensemblr_resolve_diff_comments: {
		glyph: 'message-square-check',
		object: 'review comments',
		verb: ['Resolved', 'Resolving'],
	},
	ensemblr_get_conversation_status: {
		glyph: 'bot',
		object: 'a sub-agent',
		verb: ['Checked', 'Checking'],
	},
	ensemblr_get_diff_comments: {
		detailKeys: ['filePath', 'file', 'path'],
		glyph: 'message-square-text',
		object: 'review comments',
		verb: ['Read', 'Reading'],
	},
	ensemblr_get_last_message: {
		glyph: 'bot',
		object: "a sub-agent's report",
		verb: ['Read', 'Reading'],
	},
	ensemblr_get_workspace_diff: {
		detailKeys: ['filePath', 'file', 'path'],
		glyph: 'file-diff',
		object: 'the diff',
		verb: ['Read', 'Reading'],
	},
	ensemblr_get_workspace_status: {
		glyph: 'kanban',
		object: 'board status',
		verb: ['Read', 'Reading'],
	},
	ensemblr_launch_harness: {
		detailKeys: ['harnessId'],
		glyph: 'square-terminal',
		object: 'a harness',
		verb: ['Launched', 'Launching'],
	},
	ensemblr_linear_create_comment: {
		detailKeys: ['issueId', 'id', 'identifier'],
		glyph: 'message-square-plus',
		object: 'a Linear issue',
		verb: ['Commented on', 'Commenting on'],
	},
	ensemblr_linear_get_issue: {
		detailKeys: ['issueId', 'id', 'identifier'],
		glyph: 'ticket',
		object: 'a Linear issue',
		verb: ['Read', 'Reading'],
	},
	ensemblr_linear_get_metadata: {
		glyph: 'list',
		object: 'Linear teams and states',
		verb: ['Read', 'Reading'],
	},
	ensemblr_linear_list_issues: {
		detailKeys: ['query', 'search'],
		glyph: 'ticket',
		object: 'Linear issues',
		verb: ['Searched', 'Searching'],
	},
	ensemblr_linear_update_issue: {
		detailKeys: ['issueId', 'id', 'identifier'],
		glyph: 'ticket-check',
		object: 'a Linear issue',
		verb: ['Updated', 'Updating'],
	},
	ensemblr_list_models: {
		glyph: 'list',
		object: 'models',
		verb: ['Listed', 'Listing'],
	},
	ensemblr_list_run_scripts: {
		glyph: 'list',
		object: 'run scripts',
		verb: ['Listed', 'Listing'],
	},
	ensemblr_list_tabs: {
		glyph: 'list',
		object: 'tabs',
		verb: ['Listed', 'Listing'],
	},
	ensemblr_list_terminals: {
		glyph: 'list',
		object: 'terminals',
		verb: ['Listed', 'Listing'],
	},
	ensemblr_list_workspaces: {
		glyph: 'list',
		object: 'workspaces',
		verb: ['Listed', 'Listing'],
	},
	ensemblr_notify_orchestrator: {
		detailKeys: ['reason'],
		glyph: 'bell',
		object: 'the orchestrator',
		verb: ['Notified', 'Notifying'],
	},
	ensemblr_open_tab: {
		detailKeys: ['filePath', 'file', 'path', 'variant'],
		glyph: 'panels-top-left',
		object: 'a tab',
		verb: ['Opened', 'Opening'],
	},
	ensemblr_read_conversation: {
		glyph: 'bot',
		object: "a sub-agent's transcript",
		verb: ['Read', 'Reading'],
	},
	ensemblr_read_terminal_output: {
		glyph: 'scroll-text',
		object: 'terminal output',
		verb: ['Read', 'Reading'],
	},
	ensemblr_send_follow_up: {
		glyph: 'send',
		object: 'a sub-agent',
		verb: ['Steered', 'Steering'],
	},
	ensemblr_set_workspace_status: {
		detailKeys: ['status'],
		glyph: 'kanban',
		object: 'the workspace',
		verb: ['Moved', 'Moving'],
	},
	ensemblr_spawn_chat_tab: {
		detailKeys: ['title'],
		glyph: 'panels-top-left',
		object: 'a chat tab',
		verb: ['Opened', 'Opening'],
	},
	ensemblr_start_conversation: {
		detailKeys: ['title'],
		glyph: 'bot',
		object: 'a sub-agent',
		verb: ['Started', 'Starting'],
	},
	ensemblr_start_terminal: {
		detailKeys: ['scriptName', 'kind'],
		glyph: 'play',
		object: 'a terminal',
		verb: ['Started', 'Starting'],
	},
	ensemblr_stop_terminal: {
		detailKeys: ['kind'],
		glyph: 'circle-stop',
		object: 'a terminal',
		verb: ['Stopped', 'Stopping'],
	},
	ensemblr_wait_for_agents: {
		glyph: 'hourglass',
		object: 'for sub-agents',
		verb: ['Waited', 'Waiting'],
	},
	ensemblr_write_terminal: {
		detailKeys: ['input'],
		glyph: 'keyboard',
		object: 'into a terminal',
		verb: ['Typed', 'Typing'],
	},
};

/**
 * Every control tool the timeline has a label for, so a test can hold the whole
 * registry to the same contract rather than a hand-copied sample of it.
 */
export const ENSEMBLR_CONTROL_TOOL_NAMES: readonly string[] =
	Object.keys(ENSEMBLR_TOOL_LABELS);

/** Every name the control extension registers, label-bearing or bookkeeping. */
const CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set([
	...ENSEMBLR_CONTROL_TOOL_NAMES,
	...BOOKKEEPING_TOOL_NAMES,
]);

/**
 * Reduces the name a runtime reported to the name the control extension
 * registered the tool under.
 *
 * The two runtimes disagree about what to call the same tool. Pi loads the
 * extension in-process and reports `ensemblr_set_name`; Claude Code reaches the
 * control server over MCP, where the SDK namespaces every tool by its server and
 * reports `mcp__ensemblr__ensemblr_set_name`. Matching only the bare form left
 * every call from the second runtime titled with its wire name and marked with
 * the generic wrench.
 *
 * Taking the last `ensemblr_` segment resolves both shapes, and the registry
 * check keeps that slice honest: an unrelated tool whose name happens to carry
 * the prefix resolves to nothing rather than borrowing a label.
 * @param toolName - The tool name as the runtime reported it
 * @returns The registered name, or null when the tool is not a control tool
 */
export function canonicalEnsemblrToolName(toolName: string): string | null {
	const lowered = toolName.toLowerCase();
	const start = lowered.lastIndexOf(CONTROL_TOOL_PREFIX);
	if (start === -1) {
		return null;
	}
	const registered = lowered.slice(start);
	return CONTROL_TOOL_NAMES.has(registered) ? registered : null;
}

/** Longest detail suffix kept on a title before it crowds the row. */
const MAX_DETAIL_LENGTH = 48;

/**
 * Why the app refused a control call, as the call itself reported it.
 *
 * The control channel answers a refusal with `{ ok: false, code, error }` on the
 * result's `details` and leaves the transport's error flag unset, so this is the
 * only signal a denial ever raises.
 */
export interface EnsemblrControlFailure {
	/** Denial code, e.g. `denied-permission`; null when the envelope omits one. */
	code: string | null;
	/** The reason to show the user; null when the envelope gave none. */
	error: string | null;
}

/**
 * Narrows a value to the app's control envelope, which is stamped by its boolean
 * `ok` field rather than by any payload key.
 * @param value - The `details` bag carried on a tool result
 * @returns True when the value is a control envelope
 */
function isControlEnvelope(
	value: unknown,
): value is { code?: unknown; error?: unknown; ok: boolean } {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		'ok' in value &&
		typeof value.ok === 'boolean'
	);
}

/**
 * Reads the `details` bag a tool result carries, tolerating the pre-envelope
 * shape where `output` held a bare string.
 * @param part - The tool part to read
 * @returns The details value, or null when the result carries none
 */
function detailsOf(part: DynamicToolUIPart): unknown {
	if (!('output' in part)) {
		return null;
	}
	const output = part.output;
	if (typeof output !== 'object' || output === null || !('details' in output)) {
		return null;
	}
	return output.details;
}

/**
 * Reads the refusal a control call reported inside an otherwise ordinary result.
 *
 * Only the app's own tools are read this way: an `ok` field on any other tool's
 * payload is that tool's business and says nothing about a denial.
 * @param part - The tool part to inspect
 * @returns The reported failure, or null when this is not a refused control call
 */
export function ensemblrControlFailure(
	part: DynamicToolUIPart,
): EnsemblrControlFailure | null {
	if (canonicalEnsemblrToolName(part.toolName) === null) {
		return null;
	}
	const details = detailsOf(part);
	if (!isControlEnvelope(details) || details.ok) {
		return null;
	}
	return {
		code: nonEmptyString(details.code),
		error: nonEmptyString(details.error),
	};
}

/**
 * Keeps a value only when it is a string with something in it.
 * @param value - The envelope field to read
 * @returns The string, or null when it is absent or blank
 */
function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Whether a tool call is the app's own bookkeeping and should not be rendered.
 * A failed call always renders, so a denial or a malformed argument stays
 * visible — including the denials the control channel reports as a normal
 * result carrying `ok: false`.
 * @param part - The tool part to classify
 * @returns True when the row should be omitted from the timeline
 */
export function isHiddenEnsemblrToolCall(part: DynamicToolUIPart): boolean {
	if ('errorText' in part && part.errorText) {
		return false;
	}
	if (ensemblrControlFailure(part) !== null) {
		return false;
	}
	const registered = canonicalEnsemblrToolName(part.toolName);
	return registered !== null && BOOKKEEPING_TOOL_NAMES.has(registered);
}

/**
 * Walks a dotted path into a tool call's arguments, stepping through arrays by
 * numeric segment so a batched call's first item is reachable.
 * @param input - The tool call's input bag
 * @param path - Dotted path, e.g. `comments.0.filePath`
 * @returns The value at that path, or null when any segment is missing
 */
function valueAtPath(input: Record<string, unknown>, path: string): unknown {
	let current: unknown = input;
	for (const segment of path.split('.')) {
		if (Array.isArray(current)) {
			current = current[Number(segment)];
			continue;
		}
		if (typeof current !== 'object' || current === null) {
			return null;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/**
 * Reads the first non-empty string among the given input paths, trimmed to a
 * length that fits a row title.
 * @param input - The tool call's input bag
 * @param keys - Input paths to try, in order
 * @returns The detail to append to the title, or null when none is usable
 */
function detailOf(
	input: Record<string, unknown>,
	keys: readonly string[],
): string | null {
	for (const key of keys) {
		const value = valueAtPath(input, key);
		if (typeof value !== 'string') {
			continue;
		}
		const collapsed = value.replace(/\s+/g, ' ').trim();
		if (collapsed.length === 0) {
			continue;
		}
		return collapsed.length > MAX_DETAIL_LENGTH
			? `${collapsed.slice(0, MAX_DETAIL_LENGTH).trimEnd()}…`
			: collapsed;
	}
	return null;
}

/**
 * Resolves the human-readable title and glyph for a control tool call, folding
 * in the one argument that says which tab, sub-agent, or status it acted on. A
 * call still in flight reads in the present participle, so a blocking wait does
 * not claim to have finished while the turn is still working.
 * @param toolName - The tool name as the runtime reported it
 * @param input - The tool call's input bag
 * @param isRunning - Whether the call has yet to return
 * @returns The title and glyph, or null when the name is not a control tool
 */
export function ensemblrToolLabel(
	toolName: string,
	input: Record<string, unknown>,
	isRunning: boolean,
): { glyph: ToolGlyph; title: string } | null {
	const registered = canonicalEnsemblrToolName(toolName);
	const label = registered ? ENSEMBLR_TOOL_LABELS[registered] : undefined;
	if (!label) {
		return null;
	}
	const action = `${label.verb[isRunning ? 1 : 0]} ${label.object}`;
	const detail = label.detailKeys ? detailOf(input, label.detailKeys) : null;
	return {
		glyph: label.glyph,
		title: detail ? `${action}: ${detail}` : action,
	};
}

/**
 * Resolves a control tool's glyph without reading its arguments, for the summary
 * strip that paints one mark per folded call.
 * @param toolName - The tool name as the runtime reported it
 * @returns The glyph, or null when the name is not a control tool
 */
export function ensemblrToolGlyph(toolName: string): ToolGlyph | null {
	const registered = canonicalEnsemblrToolName(toolName);
	return registered ? (ENSEMBLR_TOOL_LABELS[registered]?.glyph ?? null) : null;
}
