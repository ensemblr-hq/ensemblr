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
	/** Input keys whose value is appended to the title, first match winning. */
	detailKeys?: readonly string[];
}

/**
 * The label each control tool answers to. Titles read as the action taken rather
 * than the tool called, because the user is watching the app being driven and
 * has no use for the name of the lever.
 */
const ENSEMBLR_TOOL_LABELS: Record<string, EnsemblrToolLabel> = {
	ensemblr_ask_user_question: {
		glyph: 'message-circle-question',
		object: 'you a question',
		verb: ['Asked', 'Asking'],
	},
	ensemblr_close_tab: {
		glyph: 'panels-top-left',
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
		glyph: 'panels-top-left',
		object: 'a panel',
		verb: ['Opened', 'Opening'],
	},
	ensemblr_focus_panel: {
		glyph: 'panels-top-left',
		object: 'a panel',
		verb: ['Opened', 'Opening'],
	},
	ensemblr_focus_tab: {
		glyph: 'panels-top-left',
		object: 'a tab',
		verb: ['Focused', 'Focusing'],
	},
	ensemblr_add_diff_comments: {
		glyph: 'message-square-text',
		object: 'review comments',
		verb: ['Left', 'Leaving'],
	},
	ensemblr_resolve_diff_comments: {
		glyph: 'message-square-text',
		object: 'review comments',
		verb: ['Resolved', 'Resolving'],
	},
	ensemblr_get_conversation_status: {
		glyph: 'bot',
		object: 'a sub-agent',
		verb: ['Checked', 'Checking'],
	},
	ensemblr_get_diff_comments: {
		detailKeys: ['file'],
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
		detailKeys: ['file'],
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
		detailKeys: ['harness', 'agent'],
		glyph: 'terminal',
		object: 'a harness',
		verb: ['Launched', 'Launching'],
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
		glyph: 'bot',
		object: 'the orchestrator',
		verb: ['Notified', 'Notifying'],
	},
	ensemblr_open_tab: {
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
		glyph: 'terminal',
		object: 'terminal output',
		verb: ['Read', 'Reading'],
	},
	ensemblr_send_follow_up: {
		glyph: 'bot',
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
		glyph: 'terminal',
		object: 'a terminal',
		verb: ['Started', 'Starting'],
	},
	ensemblr_stop_terminal: {
		glyph: 'terminal',
		object: 'a terminal',
		verb: ['Stopped', 'Stopping'],
	},
	ensemblr_wait_for_agents: {
		glyph: 'bot',
		object: 'for sub-agents',
		verb: ['Waited', 'Waiting'],
	},
	ensemblr_write_terminal: {
		detailKeys: ['data', 'text'],
		glyph: 'terminal',
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
	if (!part.toolName.toLowerCase().startsWith(CONTROL_TOOL_PREFIX)) {
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
	return BOOKKEEPING_TOOL_NAMES.has(part.toolName.toLowerCase());
}

/**
 * Reads the first non-empty string among the given input keys, trimmed to a
 * length that fits a row title.
 * @param input - The tool call's input bag
 * @param keys - Input keys to try, in order
 * @returns The detail to append to the title, or null when none is usable
 */
function detailOf(
	input: Record<string, unknown>,
	keys: readonly string[],
): string | null {
	for (const key of keys) {
		const value = input[key];
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
 * @param toolName - The raw wire tool name
 * @param input - The tool call's input bag
 * @param isRunning - Whether the call has yet to return
 * @returns The title and glyph, or null when the name is not a control tool
 */
export function ensemblrToolLabel(
	toolName: string,
	input: Record<string, unknown>,
	isRunning: boolean,
): { glyph: ToolGlyph; title: string } | null {
	const label = ENSEMBLR_TOOL_LABELS[toolName.toLowerCase()];
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
 * @param toolName - The raw wire tool name
 * @returns The glyph, or null when the name is not a control tool
 */
export function ensemblrToolGlyph(toolName: string): ToolGlyph | null {
	return ENSEMBLR_TOOL_LABELS[toolName.toLowerCase()]?.glyph ?? null;
}
