/**
 * Provider-neutral conversation model shared by every agent runtime. The
 * mappers in `lib/agent-timeline` project persisted `AgentPersistedEnvelope`
 * events onto the AI SDK `UIMessage` shape defined here, and the live
 * conversation panel renders the result. Nothing in this module knows how a
 * particular runtime spells its wire frames.
 */

import type { DynamicToolUIPart, UIMessage } from 'ai';

/** UI-message role of a mapped agent turn: user, assistant, or system. */
export type UIRole = UIMessage['role'];

/** A single part of a mapped `UIMessage` (text, reasoning, or dynamic-tool). */
export type UIMessagePart = UIMessage['parts'][number];

/**
 * A timeline part carrying the subagent link the runtime may stamp on it.
 *
 * Claude Code forwards a `Task`'s messages flat alongside the main thread's, so
 * the link is the only thing that says which rows ran inside which delegation.
 * It is absent on runtimes without subagents and on rows persisted before it
 * shipped, where absent always means the main thread — read it through
 * `parentToolCallIdOf` rather than trusting the field.
 */
export type ParentedUIMessagePart = UIMessagePart & {
	parentToolCallId?: string | null;
};

/** A tool part carrying the subagent link, as {@link ParentedUIMessagePart}. */
export type ParentedDynamicToolUIPart = DynamicToolUIPart & {
	parentToolCallId?: string | null;
};

/** One activity row and, for a subagent call, the rows that ran inside it. */
export interface TimelineActivityNode {
	children: readonly TimelineActivityNode[];
	/** React key: the tool call's id, or the part's position when it has none. */
	key: string;
	part: UIMessagePart;
}

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
export interface AgentTurnMetadata {
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
	/** Persisted `agent_turns` id backing this group; keys checkpoint lookups. */
	turnId: string | null;
}

/**
 * Marks a system-role timeline message as a lifecycle notice rather than a
 * runtime failure, so the renderer can style a deliberate interruption calmly
 * instead of dressing it up as an error.
 */
export interface AgentNoticeMetadata {
	notice: 'interrupted';
}

/** One file attachment parsed from a persisted user prompt (path + inlined content). */
export interface ParsedPromptAttachment {
	content: string;
	path: string;
}

/** One run of a parsed prompt: a stretch of the typed message, or an attachment. */
export type ParsedPromptPart =
	| { attachment: ParsedPromptAttachment; kind: 'attachment' }
	| { kind: 'text'; text: string };

/**
 * A parsed user prompt, as the message renders it back: the typed runs and the
 * attachments in the order the composer sent them, with the scaffolding that
 * describes the chat rather than the message already dropped.
 */
export interface ParsedPrompt {
	parts: readonly ParsedPromptPart[];
}

/**
 * A `/skill:name` invocation, which Pi expands into a `<skill>` block wrapping
 * the whole skill body before echoing the prompt back.
 */
export interface ParsedSkillInvocation {
	/** The skill's markdown body, frontmatter already stripped by Pi. */
	content: string;
	name: string;
}

/** A persisted prompt split into the skill it invoked and the arguments left over. */
export interface ParsedSkillPrompt {
	skill: ParsedSkillInvocation | null;
	text: string;
}

/**
 * One extension-injected Pi message, carried on a `data-pi-custom` message part
 * so the timeline can tell background context apart from assistant prose.
 */
export interface PiCustomMessageData {
	customType: string;
	/** The injector's visibility hint; false means it never asked to be read. */
	display: boolean;
	text: string;
}

/**
 * The skill named by a `data-pi-skill` part — the marker the mapper lifts out
 * of a skill prompt and drops into the assistant turn it opened, so the turn
 * shows "Skill activated" instead of the whole `SKILL.md`.
 */
export interface AgentSkillPartData {
	name: string;
}

/**
 * Normalized result of one tool call: the MCP-style `{ content: [...] }`
 * envelope flattened to text, alongside the tool-specific `details` bag it
 * shipped with.
 *
 * `details` is what makes a rich body possible — `edit` puts its unified patch
 * there, `lsp_diagnostics` its diagnostic list — so it is carried rather than
 * dropped during flattening.
 */
export interface AgentToolOutput {
	details: Readonly<Record<string, unknown>> | null;
	text: string;
}
