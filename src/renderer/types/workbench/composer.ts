import type { EditorState } from 'lexical';

import type { MatchRange } from '@/renderer/lib/workbench/fuzzy-score';
import type { ConciergeReference } from '@/shared/concierge-references';
import type {
	AgentProviderSlashCommandScope,
	AgentProviderSlashCommandSource,
} from '@/shared/ipc/contracts/agent-provider';

import type {
	CommentPreviewPayload,
	ComposerModelOption,
	WorkspaceFileSummary,
} from './workspace';

/**
 * One selectable row in the model selector: a model plus whether the chat's
 * agent-runtime pin locks it out. Locked rows stay in the list and render
 * disabled — dropping them would make the list silently shrink from one chat to
 * the next, which reads as a bug.
 */
export interface ModelPickerRow {
	locked: boolean;
	model: ComposerModelOption;
}

/** One provider group inside the model selector menu. */
export interface GroupedOptions {
	provider: string;
	providerLabel: string;
	models: ModelPickerRow[];
}

/** Describes a slash command surfaced in the composer autocomplete. */
export interface SlashCommandDescriptor {
	/** Bare command name without the leading slash. */
	command: string;
	description: string;
	/** What registered the command; unset for a runtime that reports no provenance. */
	source?: AgentProviderSlashCommandSource;
	/** Scope used to rank project skills before global skills in autocomplete. */
	sourceScope?: AgentProviderSlashCommandScope;
	/** When true, command runs immediately on pick (no args expected). */
	autoSubmit: boolean;
}

/** One ranked slash-command row plus the spans of its name that matched the query. */
export interface SlashCommandMatch {
	item: SlashCommandDescriptor;
	ranges: readonly MatchRange[];
}

/** One ranked mention row plus the spans of its name and path that matched the query. */
export interface MentionMatch {
	entry: WorkspaceFileSummary;
	nameRanges: readonly MatchRange[];
	pathRanges: readonly MatchRange[];
}

/**
 * One ranked Concierge reference row plus the spans of its label that matched
 * the query. Sits beside {@link MentionMatch} rather than in a concern of its
 * own because it is the same row in the same menu, differing only in what the
 * row stands for.
 */
export interface ConciergeReferenceMatch {
	labelRanges: readonly MatchRange[];
	reference: ConciergeReference;
}

/**
 * The surface a stored block of text was taken off. `label` is what that pane
 * calls itself — the dock tab's name, a harness conversation's live title — so
 * the chip says which terminal the output came from rather than only that some
 * terminal did. Empty when the pane has no name yet, which the chip falls back
 * on rather than rendering a blank.
 */
export interface ComposerTextSource {
	kind: 'terminal';
	label: string;
}

/**
 * Everything the composer can carry alongside the typed message, in one ordered
 * list. `id` dedupes an add for the kinds whose content is inlined, and targets
 * the first chip carrying it on a remove; a reference chip may repeat within one
 * draft, so its id is not unique there. `label` is what the chip reads. The
 * variants differ only in where their content lives — a repo-relative path, an
 * absolute path outside the tree, an in-memory file awaiting its first write, or
 * a surface of the app's own that has no content at all.
 */
export type ComposerAttachment =
	| {
			id: string;
			/** True when git ignores the file; the chip dims to match the file tree. */
			isIgnored?: boolean;
			kind: 'workspace-file';
			label: string;
			path: string;
	  }
	| {
			id: string;
			kind: 'workspace-directory';
			label: string;
			path: string;
	  }
	| {
			absolutePath: string;
			id: string;
			kind: 'external-file';
			label: string;
			sizeBytes: number;
	  }
	| {
			id: string;
			kind: 'pasted-text';
			label: string;
			/** How many lines the pasted block ran to, for the chip's meta row. */
			lineCount: number;
			path: string;
			/** Opening of the pasted text, capped so the chip can show what it holds. */
			preview: string;
			/**
			 * Which surface the block was taken off, naming it on the chip. Unset for
			 * an ordinary clipboard paste, which has no surface behind it.
			 */
			source?: ComposerTextSource;
	  }
	| {
			id: string;
			/**
			 * True when the chat was spawned as somebody's sub-agent, which is what
			 * its chip wears a robot for instead of the sparkle an ordinary chat gets.
			 */
			isSubAgent: boolean;
			kind: 'chat-transcript';
			/** The chat's own title, since the summary file is named by a bare id. */
			label: string;
			/** Repo-relative path of the `.context/sessions` summary the agent reads. */
			path: string;
	  }
	| {
			id: string;
			kind: 'issue';
			label: string;
			/** Path of the markdown document the issue was written out to. */
			path: string;
			/** Which tracker the issue came from; the chip wears its brand mark. */
			provider: 'github' | 'linear';
	  }
	| {
			/** Workspace-relative path the patch was taken against, for the tooltip. */
			filePath: string;
			id: string;
			kind: 'file-diff';
			label: string;
			/** Path of the markdown document the patch was written out to. */
			path: string;
	  }
	| {
			/**
			 * The whole comment, so the chip opens its preview without going back to
			 * GitHub or the database for a thread the user is already looking at.
			 */
			comment: CommentPreviewPayload;
			id: string;
			kind: 'review-comment';
			label: string;
			/** Path of the markdown document the comment was written out to. */
			path: string;
	  }
	| {
			id: string;
			kind: 'artifact-ref' | 'project-ref' | 'workspace-ref' | 'chat-ref';
			label: string;
			/**
			 * What the chip stands for and the ids it serializes to. Carried whole
			 * rather than flattened into fields because the same value crosses to the
			 * agent as a prompt block and comes back out of a markdown link, and one
			 * shape for all four passes is what keeps those two ends in step.
			 */
			reference: ConciergeReference;
	  };

/**
 * One run of the composer draft, in the order it sits in the document: a stretch
 * of typed text, or a chip standing where the user put it. The send pipeline
 * walks these so the outgoing prompt reads in the order the user arranged, rather
 * than hoisting every attachment to one end of the message.
 */
export type ComposerDraftSegment =
	| { attachment: ComposerAttachment; kind: 'attachment' }
	| { kind: 'text'; text: string };

/**
 * What a send will do right now. `send` covers every idle send and a mid-turn
 * `steer`; `queue` and `hold` are the two mid-turn holds, differing only in
 * whether the queue drains on its own. One value drives all four of the
 * composer's status surfaces, so they cannot disagree.
 */
export type ComposerSendIntent = 'hold' | 'queue' | 'send';

/**
 * Where a queued follow-up came from, which decides both how its row reads and
 * whether it drains on its own. A `user` message queued under the `block`
 * behavior waits for the user to send it; a `chore` was already announced as
 * handed over by the Checks panel, so it always drains when the agent frees up.
 */
export type QueuedFollowUpSource = 'chore' | 'user';

/**
 * Why a chat's follow-up queue is paused, so the strip can say which pause it
 * was rather than only that one happened. `turn-stopped` is the turn the user
 * interrupted, whose queued messages must not go out as if the interruption
 * never happened; `send-failed` is a session that would not take the message, so
 * draining the rest would empty the queue into the void. A composer that merely
 * cannot accept a send this instant is neither — that send is retried.
 */
export type FollowUpQueueHoldReason = 'send-failed' | 'turn-stopped';

/**
 * A paused follow-up queue: why it stopped, and which messages the pause is
 * actually about.
 *
 * A stop names the entries it parked in `entryIds` and covers nothing else. A
 * message queued afterwards was typed with the interruption already on screen,
 * so it is fresh intent rather than something to protect the user from, and a
 * pause that outlived the messages it was guarding is what made every later
 * queue need the resume button pressed by hand.
 *
 * `send-failed` names no entries because it is not about any: a session that
 * would not take the last message has no more reason to take the next one, so
 * the pause covers whatever the queue holds until the user says otherwise.
 */
export type FollowUpQueueHold =
	| { entryIds: readonly string[]; reason: 'turn-stopped' }
	| { reason: 'send-failed' };

/**
 * One message waiting to go to the agent once the current turn ends.
 *
 * Carries the whole draft rather than a serialized prompt: attachment content is
 * read at send time, so freezing it at queue time would hand the agent a file as
 * it looked several minutes earlier, and putting an entry back in the composer
 * to edit needs the document to restore chips where the user left them.
 */
export interface QueuedFollowUp {
	id: string;
	/** ISO timestamp the entry was queued at, for ordering and for the row's meta. */
	queuedAt: string;
	segments: readonly ComposerDraftSegment[];
	/** Lexical document to restore on edit; null for a text-only enqueue. */
	snapshot: EditorState | null;
	source: QueuedFollowUpSource;
	/** Flattened draft text, for the row preview and the emptiness check. */
	text: string;
}

/**
 * A directory outside the workspace that a chat has been given access to. Unlike
 * a {@link ComposerAttachment} this is not cleared on send: it stays linked for
 * the chat until the user removes it, and rides every `openAgentSession` call so
 * the runtime can grant the agent real read access.
 */
export interface LinkedDirectory {
	/** Basename of the directory, shown as the chip's title. */
	name: string;
	/** Absolute path, exactly as the user picked it. */
	path: string;
}

/** Discrete thinking-effort strength from 0 (off) to 5 (extra-high). */
export type ThinkingBarStrength = 0 | 1 | 2 | 3 | 4 | 5;

/** Minimal linked-issue shape needed to seed the composer draft's headline. */
export interface LinkedIssueComposerSeedInput {
	reference: string;
	title: string;
}
