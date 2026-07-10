/**
 * UI-facing timeline model produced by the pure reducer in
 * `lib/pi-timeline`. Decoupled from raw Pi RPC frames: streaming deltas fold
 * into growing items, tool calls carry a lifecycle status, consecutive tool
 * calls group, and noise frames never become items (they only update
 * `PiTimelineSessionMeta`). Derived from the fixture matrix in
 * `tests/fixtures/pi-captures/` — see `docs/pi/event-taxonomy.md`.
 */

import type { UIMessage } from 'ai';

import type { PiSessionStats } from '@/shared/pi-rpc';

/** Lifecycle of one tool call rendered as a card. */
export type PiToolCallStatus =
	| 'running'
	| 'awaiting-approval'
	| 'success'
	| 'error'
	| 'cancelled';

/** One user prompt echoed back by pi. */
interface PiUserMessageItem {
	id: string;
	kind: 'user-message';
	text: string;
	atMs: number;
}

/** One streamed assistant prose block (deltas fold into `text`). */
export interface PiAssistantMessageItem {
	id: string;
	kind: 'assistant-message';
	text: string;
	streaming: boolean;
	atMs: number;
}

/**
 * One reasoning block. Captures carry no reasoning text (only an encrypted
 * signature), so the item is duration-only: "Reasoned for Ns".
 */
export interface PiThinkingItem {
	id: string;
	kind: 'thinking';
	startedAtMs: number;
	endedAtMs: number | null;
}

/** Extension confirm-dialog handshake attached to a gated tool call. */
interface PiToolApproval {
	title: string;
	message: string | null;
	requestedAtMs: number;
	settledAtMs: number | null;
}

/** One tool call with its accumulated output and lifecycle status. */
export interface PiToolCallItem {
	id: string;
	kind: 'tool-call';
	toolCallId: string;
	toolName: string;
	args: Readonly<Record<string, unknown>>;
	/** Accumulated plain-text output (ANSI preserved; renderer decides). */
	output: string;
	/** Tool-specific result details (e.g. `diff` for edit). */
	details: Readonly<Record<string, unknown>> | null;
	status: PiToolCallStatus;
	approval: PiToolApproval | null;
	startedAtMs: number;
	endedAtMs: number | null;
}

/** Consecutive tool calls with no assistant text between them. */
export interface PiToolGroupItem {
	id: string;
	kind: 'tool-group';
	calls: readonly PiToolCallItem[];
}

/**
 * Marker appended when an assistant turn settles. Carries the turn duration
 * (prompt accepted → final event) and the clean-markdown answer text for the
 * copy button. `aborted` marks turns ended by the abort command.
 */
export interface PiTurnFooterItem {
	id: string;
	kind: 'turn-footer';
	durationMs: number;
	aborted: boolean;
	answerText: string;
}

export type PiTimelineItem =
	| PiUserMessageItem
	| PiAssistantMessageItem
	| PiThinkingItem
	| PiToolCallItem
	| PiToolGroupItem
	| PiTurnFooterItem;

/**
 * Session-level metadata fed by noise/metadata frames — the status-bar
 * source. Never rendered inside the timeline itself.
 */
export interface PiTimelineSessionMeta {
	model: string | null;
	/** Latest `get_session_stats` payload (tokens, cost, context usage). */
	stats: PiSessionStats | null;
	/** Extension `setStatus` texts by key, ANSI stripped. */
	statusTexts: Readonly<Record<string, string>>;
	/** True between `agent_start` and `agent_end`. */
	streaming: boolean;
	/** Capture timestamp of the live turn's acceptance, for ticking timers. */
	turnStartedAtMs: number | null;
}

/** Whole reducer state: flat ordered items plus session metadata. */
export interface PiTimelineState {
	items: readonly PiTimelineItem[];
	session: PiTimelineSessionMeta;
	/** Internal cursors — deterministic, exposed for snapshot tests. */
	cursor: PiTimelineCursor;
}

/** Reducer-internal bookkeeping between events. */
interface PiTimelineCursor {
	nextItemId: number;
	openAssistantId: string | null;
	openThinkingId: string | null;
	/** Maps running toolCallId → containing item id (tool-call or group). */
	runningTools: Readonly<Record<string, string>>;
	/** Prompt acceptance timestamp for the not-yet-started turn. */
	pendingTurnStartMs: number | null;
	/** Last sealed assistant prose text this turn — the copy target. */
	lastAnswerText: string;
	/** True once an assistant message ended with `stopReason: "aborted"`. */
	turnAborted: boolean;
}

/** Timestamped reducer input: one parsed frame plus its arrival time. */
export interface PiTimelineInput {
	atMs: number;
	event: import('@/shared/pi-rpc').PiRpcEvent;
}

/** UI-message role of a mapped Pi turn: user, assistant, or system. */
export type UIRole = UIMessage['role'];

/** A single part of a mapped `UIMessage` (text, reasoning, or dynamic-tool). */
export type UIMessagePart = UIMessage['parts'][number];

/** Text or reasoning part that is still streaming deltas. */
export type StreamingTextPart = Extract<
	UIMessagePart,
	{ type: 'text' | 'reasoning' }
> & { state: 'streaming' };

/**
 * Buffer for a consecutive same-role run of message events while it is being
 * collapsed into a single `UIMessage`. Event timestamps bound the turn so the
 * renderer can derive generation duration without re-walking the stream.
 */
export interface PendingGroup {
	firstEventAt: string;
	id: string;
	lastEventAt: string;
	/** Highest persisted-event ordinal folded into this group. */
	lastOrdinal: number;
	parts: UIMessagePart[];
	role: UIRole;
	groupKey: string;
	/** First persisted turn id seen in the group, if any. */
	turnId: string | null;
}

/** Turn timing carried on each mapped `UIMessage` for the timer feature. */
export interface PiTurnMetadata {
	/**
	 * Submit time of the user prompt that opened this turn, when known. Used as
	 * the turn-timer start so the elapsed time spans prompt → final answer
	 * (reasoning + tool calls included), not just the first assistant event.
	 * Only set on assistant turns.
	 */
	promptAt?: string;
	firstEventAt: string;
	lastEventAt: string;
	/** Highest persisted-event ordinal in the turn — the fork boundary. */
	lastOrdinal: number;
	/** Persisted `pi_turns` id backing this group; keys checkpoint lookups. */
	turnId: string | null;
}

/** One file attachment parsed from a persisted user prompt (path + inlined content). */
export interface ParsedPromptAttachment {
	content: string;
	path: string;
}

/** A parsed user prompt split into its leading file attachments and typed text. */
export interface ParsedPrompt {
	attachments: readonly ParsedPromptAttachment[];
	text: string;
}

/**
 * Compact one-line projection of a tool call for the activity-row renderer.
 * Mirrors the GIF reference: `[label]  [detail]  [optional chip]`.
 *
 * Unknown tools fall through to a generic projection — the tool name as label,
 * the first scalar input value as detail. Keeps the surface uniform.
 */
export interface ToolRowProjection {
	chipLabel: string | null;
	/** Full path backing the chip (as given in tool input), for preview opening. */
	chipPath: string | null;
	detail: string;
	label: string;
}
