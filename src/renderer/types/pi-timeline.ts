/**
 * UI-facing timeline model produced by the pure reducer in
 * `lib/pi-timeline`. Decoupled from raw Pi RPC frames: streaming deltas fold
 * into growing items, tool calls carry a lifecycle status, consecutive tool
 * calls group, and noise frames never become items (they only update
 * `PiTimelineSessionMeta`). Derived from the fixture matrix in
 * `tests/fixtures/pi-captures/` — see `docs/pi/event-taxonomy.md`.
 */

import type { PiSessionStats } from '@/shared/pi-rpc';

/** Lifecycle of one tool call rendered as a card. */
export type PiToolCallStatus =
	| 'running'
	| 'awaiting-approval'
	| 'success'
	| 'error'
	| 'cancelled';

/** One user prompt echoed back by pi. */
export interface PiUserMessageItem {
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
export interface PiToolApproval {
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
export interface PiTimelineCursor {
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
