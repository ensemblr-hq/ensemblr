import type { DatabaseSync } from 'node:sqlite';
import { listTurns } from '../../storage/repositories/agent-session-repository.ts';
import {
	getChatTabById,
	renameChatTab,
	setChatTabMetadata,
} from '../../storage/repositories/chat-tab-repository.ts';
import type { AgentSession } from '../agent-client.ts';
import { appendChatTitleMetadataEvent } from '../agent-session-persistence.ts';
import type { AgentSessionEventSink } from '../agent-session-types.ts';
import { deriveTitleSource } from './derive-title-source.ts';
import { type ChatTitle, sanitizeChatTitle } from './sanitize-title.ts';
import {
	type ChatTitleProvenance,
	canSetTitle,
	readTitleProvenance,
} from './title-provenance.ts';

/**
 * Per-session payload for one titling attempt. Built at session open (with the
 * user's first prompt) and again on each turn-idle (with `initialPrompt` null,
 * so the coordinator recovers the prompt from the first persisted turn).
 */
export interface SessionNamingInput {
	branchId: string;
	chatTabId: string;
	database: DatabaseSync;
	eventSink: AgentSessionEventSink | undefined;
	/** The first user prompt when known; null on idle retries. */
	initialPrompt: string | null;
	/** Live agent session for the tab, polled for its user-set name; null when unavailable. */
	liveSession: AgentSession | null;
	sessionId: string;
	workspaceId: string;
}

/**
 * Builds the coordinator that gives a fresh chat tab a title to carry until
 * somebody chooses a better one. It is deliberately dumb and instant: the title
 * is Pi's session name when the user has set one, else the first message with
 * its scaffolding and slash command stripped. No model runs, so a slow or
 * unreachable provider can never leave a tab unlabeled.
 *
 * A real title is the agent's job, through `ensemblr_set_name` — this only has
 * to beat the untitled placeholder until that lands, and the provenance ladder guarantees it
 * yields the moment it does. The write is gated so firing at open and again at
 * every turn-idle can never clobber a settled name; it simply retries a
 * derivation that had nothing to work with. An in-flight guard keyed by chat
 * tab drops overlapping attempts (the open-time fire and the first turn-idle
 * fire race for the same tab).
 * @returns A fire-and-forget `queueNaming(input)` to call from open and idle.
 */
export function createSessionNaming(): (input: SessionNamingInput) => void {
	const inFlight = new Set<string>();
	return (input) => {
		if (inFlight.has(input.chatTabId)) {
			return;
		}
		inFlight.add(input.chatTabId);
		void runNaming(input)
			.catch((cause: unknown) => {
				console.warn('[agent-session] session naming failed', {
					cause: cause instanceof Error ? cause.message : String(cause),
					chatTabId: input.chatTabId,
				});
			})
			.finally(() => {
				inFlight.delete(input.chatTabId);
			});
	};
}

/** Runs one gated titling attempt: derive the title, then persist it. */
async function runNaming(input: SessionNamingInput): Promise<void> {
	const prompt = resolvePrompt(input);
	if (!prompt || !titleNeedsNaming(input.database, input.chatTabId)) {
		return;
	}
	const derived = await deriveDeterministicTitle(input, prompt);
	if (derived) {
		persistTitle({ input, ...derived });
	}
}

/**
 * Resolves the deterministic tab title without an LLM, and reports who chose
 * it. Pi's session name is only ever set by the user typing `/name`, so a title
 * drawn from it is theirs and outranks anything an agent later picks; a title
 * derived from the first message is the app's own guess and yields to both. A
 * `get_state` miss/error falls back to the message and never blocks.
 * @param input - The naming payload carrying the live session and first prompt.
 * @param prompt - The already-resolved first user prompt.
 * @returns The sanitized title with its provenance, or null when nothing usable remains.
 */
async function deriveDeterministicTitle(
	input: SessionNamingInput,
	prompt: string,
): Promise<{ provenance: ChatTitleProvenance; title: ChatTitle } | null> {
	const sessionName = (
		await input.liveSession?.getState().catch(() => null)
	)?.sessionName?.trim();
	if (sessionName) {
		const title = sanitizeChatTitle(sessionName);
		return title ? { provenance: 'user', title } : null;
	}
	const title = sanitizeChatTitle(deriveTitleSource(prompt));
	return title ? { provenance: 'auto', title } : null;
}

/** Uses the passed first prompt, else recovers it from the first persisted turn. */
function resolvePrompt(input: SessionNamingInput): string | null {
	const passed = input.initialPrompt?.trim();
	if (passed) {
		return passed;
	}
	const firstTurn = listTurns({
		branchId: input.branchId,
		database: input.database,
	}).at(0);
	const recovered = firstTurn?.promptText.trim();
	return recovered && recovered.length > 0 ? recovered : null;
}

/**
 * True when the tab still carries a derived title nobody has claimed. The
 * one-shot `titleAutoNamed` flag stops the namer re-deriving every turn; the
 * provenance check stops it overwriting a title the agent or the user chose.
 */
function titleNeedsNaming(database: DatabaseSync, chatTabId: string): boolean {
	const tab = getChatTabById({ database, id: chatTabId });
	if (!tab) {
		return false;
	}
	return (
		tab.metadata.titleAutoNamed !== true &&
		canSetTitle(readTitleProvenance(tab.metadata), 'auto')
	);
}

/**
 * Persists a derived title, re-checking both gates at write time so a title
 * that landed (or a rename that arrived) between the pre-flight check and now
 * is never overwritten. Stamps the derivation's provenance and broadcasts the
 * rename.
 */
function persistTitle({
	input,
	provenance,
	title,
}: {
	input: SessionNamingInput;
	provenance: ChatTitleProvenance;
	title: ChatTitle;
}): void {
	if (!titleNeedsNaming(input.database, input.chatTabId)) {
		return;
	}
	const tab = getChatTabById({ database: input.database, id: input.chatTabId });
	if (!tab || !canSetTitle(readTitleProvenance(tab.metadata), provenance)) {
		return;
	}
	renameChatTab({
		database: input.database,
		fullTitle: title.full,
		id: input.chatTabId,
		title: title.display,
	});
	setChatTabMetadata({
		database: input.database,
		id: input.chatTabId,
		metadata: {
			...tab.metadata,
			titleAutoNamed: true,
			titleProvenance: provenance,
		},
	});
	const event = appendChatTitleMetadataEvent({
		branchId: input.branchId,
		database: input.database,
		title: title.display,
	});
	input.eventSink?.({
		event,
		sessionId: input.sessionId,
		workspaceId: input.workspaceId,
	});
}
