/**
 * Wire contract for Claude's per-tool approval prompt. In `approval-required`
 * mode the Agent SDK holds a tool call open on `canUseTool`, main broadcasts the
 * request here, and the chat tab bound to `agentSessionId` shows the card in its
 * composer slot until the user decides.
 *
 * Claude only. Pi keeps full workspace control and never raises one of these.
 */
import { z } from 'zod';

/** Caps on the tool input main forwards, so a huge `Write` never crosses IPC. */
const TOOL_APPROVAL_INPUT_LIMITS = {
	maxFields: 8,
	maxValueLength: 400,
} as const;

/**
 * How the user answered a prompt. `allow-for-session` also adds the tool name to
 * an in-memory, session-scoped allow list, so the same tool stops asking for the
 * rest of that session — nothing is written to disk or shared across sessions.
 */
export type ToolApprovalDecision =
	| { kind: 'allow' }
	| { kind: 'allow-for-session' }
	| { kind: 'deny'; reason?: string };

/**
 * Main → renderer request to put a tool call to the user. Only the chat tab
 * bound to `agentSessionId` renders it, so the decision is made in the
 * conversation whose agent is blocked.
 */
export interface ToolApprovalRequestedBroadcast {
	requestId: string;
	agentSessionId: string;
	toolName: string;
	/** Scalar fields of the tool input, stringified and truncated for display. */
	input: Readonly<Record<string, string>>;
	/** Claude Code's own prompt sentence, when the bridge supplied one. */
	title?: string;
	/** Short noun phrase for the action, e.g. "Read file". */
	displayName?: string;
	/** Human-readable subtitle from Claude Code. */
	description?: string;
}

/**
 * Main → renderer signal that a pending prompt is no longer answerable — the
 * turn was interrupted, the session stopped, or the app is quitting — so the
 * renderer drops the card instead of leaving a dead prompt on screen.
 */
export interface ToolApprovalClosedBroadcast {
	requestId: string;
}

/** Renderer → main answer that unblocks the tool call. */
export interface ToolApprovalReply {
	requestId: string;
	decision: ToolApprovalDecision;
}

const decisionSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('allow') }),
	z.strictObject({ kind: z.literal('allow-for-session') }),
	z.strictObject({
		kind: z.literal('deny'),
		reason: z.string().trim().min(1).optional(),
	}),
]);

const replySchema = z.strictObject({
	decision: decisionSchema,
	requestId: z.string().trim().min(1),
});

/**
 * Validates a renderer-supplied decision before it settles a blocked tool call.
 * @param raw - Untrusted reply payload from the renderer.
 * @returns The parsed reply, or null when the payload is malformed.
 */
export function parseToolApprovalReply(raw: unknown): ToolApprovalReply | null {
	const parsed = replySchema.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

/**
 * Reduces a raw tool input to the scalar fields worth showing on the card,
 * stringified and truncated. Nested structures are dropped rather than
 * serialized: the card exists to name the action, and a `Write` payload would
 * otherwise push a whole file across IPC on every prompt.
 * @param input - The tool input the SDK handed to `canUseTool`.
 * @returns Display-ready field map, capped in both field count and value length.
 */
export function toToolApprovalInputPreview(
	input: Record<string, unknown>,
): Readonly<Record<string, string>> {
	const preview: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) {
		if (Object.keys(preview).length >= TOOL_APPROVAL_INPUT_LIMITS.maxFields) {
			break;
		}
		const rendered = renderScalar(value);
		if (rendered !== null) {
			preview[key] = rendered;
		}
	}
	return preview;
}

/**
 * Renders one tool-input value for the card, or null when it is not a scalar.
 * @param value - A single field of the tool input.
 * @returns The truncated string form, or null to drop the field.
 */
function renderScalar(value: unknown): string | null {
	if (typeof value === 'string') {
		return truncate(value);
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return null;
}

/**
 * Clips a value to the display cap, marking that it was clipped.
 * @param value - The raw string.
 * @returns The value, or its head followed by an ellipsis.
 */
function truncate(value: string): string {
	const { maxValueLength } = TOOL_APPROVAL_INPUT_LIMITS;
	return value.length <= maxValueLength
		? value
		: `${value.slice(0, maxValueLength)}…`;
}
