import type { DatabaseSync } from 'node:sqlite';

import type { PiExecutableSnapshot } from '../pi-runtime';
import { renameChatTab } from '../storage/repositories/chat-tab-repository.ts';
import { extractAgentMessageText } from './agent-message-text.ts';
import type { PiAgentClient } from './pi-agent-client.ts';
import { appendChatTitleMetadataEvent } from './pi-session-persistence.ts';
import type { PiSessionEventSink } from './pi-session-types.ts';

export const CHAT_TITLE_TIMEOUT_MS = 20000;
const CHAT_TITLE_MAX_LENGTH = 32;
const CHAT_TITLE_FALLBACK_WORD_COUNT = 5;

/** Inputs for queuing best-effort chat-title generation for a session. */
interface QueueChatTitleGenerationArgs {
	branchId: string;
	chatTitleTimeoutMs: number;
	database: DatabaseSync;
	eventSink: PiSessionEventSink | undefined;
	executable: PiExecutableSnapshot;
	initialPrompt: string | null;
	/** Chat model to mirror in the ephemeral title session; `null` = Pi default. */
	model: string | null;
	piAgentClient: PiAgentClient;
	sessionId: string;
	tabId: string;
	workspaceCwd: string;
	workspaceId: string;
}

/** Starts best-effort LLM title generation without blocking the first prompt. */
export function queueChatTitleGeneration({
	branchId,
	chatTitleTimeoutMs,
	database,
	eventSink,
	executable,
	initialPrompt,
	model,
	piAgentClient,
	sessionId,
	tabId,
	workspaceCwd,
	workspaceId,
}: QueueChatTitleGenerationArgs): void {
	const prompt = initialPrompt?.trim();
	if (!prompt) {
		return;
	}

	void generateChatTitle({
		executable,
		model,
		piAgentClient,
		prompt,
		timeoutMs: chatTitleTimeoutMs,
		workspaceCwd,
	})
		.then((title) => {
			const finalTitle = title ?? buildFallbackChatTitle(prompt);
			if (!finalTitle) {
				return;
			}
			persistChatTitle({
				branchId,
				database,
				eventSink,
				sessionId,
				tabId,
				title: finalTitle,
				workspaceId,
			});
		})
		.catch((cause: unknown) => {
			// Last-ditch fallback: derive a title from the user's prompt so the
			// tab never stays stuck on the placeholder label.
			const fallback = buildFallbackChatTitle(prompt);
			if (fallback) {
				persistChatTitle({
					branchId,
					database,
					eventSink,
					sessionId,
					tabId,
					title: fallback,
					workspaceId,
				});
			}
			console.warn('[pi-session] chat title generation failed', {
				cause: cause instanceof Error ? cause.message : String(cause),
				tabId,
			});
		});
}

/** Persists a generated or fallback title and broadcasts the metadata refresh. */
function persistChatTitle({
	branchId,
	database,
	eventSink,
	sessionId,
	tabId,
	title,
	workspaceId,
}: {
	branchId: string;
	database: DatabaseSync;
	eventSink: PiSessionEventSink | undefined;
	sessionId: string;
	tabId: string;
	title: string;
	workspaceId: string;
}): void {
	renameChatTab({ database, id: tabId, title });
	broadcastChatTitle({
		branchId,
		database,
		eventSink,
		sessionId,
		title,
		workspaceId,
	});
}

/** Emits a metadata event so renderer chat-tab queries refetch after rename. */
function broadcastChatTitle({
	branchId,
	database,
	eventSink,
	sessionId,
	title,
	workspaceId,
}: {
	branchId: string;
	database: DatabaseSync;
	eventSink: PiSessionEventSink | undefined;
	sessionId: string;
	title: string;
	workspaceId: string;
}): void {
	const event = appendChatTitleMetadataEvent({ branchId, database, title });
	eventSink?.({ event, sessionId, workspaceId });
}

/**
 * Asks Pi for a super-short tab title and returns sanitized plain text.
 *
 * Collection rules:
 *  - Only `kind: 'text'` parts are accumulated; reasoning/thinking chunks are
 *    skipped so chain-of-thought tokens never leak into the title.
 *  - Streaming delta payloads are ignored — we use the final `message_end`
 *    text so the title reflects the model's settled output.
 *  - Resolution waits for `status === 'idle'` (turn complete) instead of
 *    resolving on the first chunk. The first chunk is frequently a partial
 *    sentence or a leading explanation and produces gibberish titles.
 *
 * On timeout, any partially-collected text is still sanitized and returned;
 * the caller falls back to a prompt-derived title only when we collected
 * nothing.
 */
async function generateChatTitle({
	executable,
	model,
	piAgentClient,
	prompt,
	timeoutMs,
	workspaceCwd,
}: {
	executable: PiExecutableSnapshot;
	model: string | null;
	piAgentClient: PiAgentClient;
	prompt: string;
	timeoutMs: number;
	workspaceCwd: string;
}): Promise<string | null> {
	const session = await piAgentClient.createSession({
		executable,
		label: 'ensemblr-chat-title',
		modelOverride: model,
		workspaceCwd,
	});
	const chunks: string[] = [];
	let resolveDone: () => void = () => undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	const subscription = session.subscribe((event) => {
		if (event.type === 'message' && event.role === 'agent') {
			const text = extractAgentMessageText(event);
			if (text) {
				chunks.push(text);
			}
			return;
		}
		if (event.type === 'status' && event.status === 'idle') {
			resolveDone();
			return;
		}
		if (event.type === 'shutdown') {
			resolveDone();
		}
	});

	try {
		await session.submit({ prompt: buildChatTitlePrompt(prompt) });
		try {
			await waitForTitle(done, timeoutMs);
		} catch (cause) {
			// On timeout we still want to use whatever the model produced. A
			// short partial chunk is usually a usable title; only when nothing
			// was collected do we surface the timeout to the caller.
			if (cause instanceof ChatTitleTimeoutError && chunks.length === 0) {
				throw cause;
			}
		}
		return sanitizeGeneratedChatTitle(chunks.join(' '));
	} finally {
		subscription.unsubscribe();
		await session.close().catch(() => undefined);
	}
}

/** Builds the LLM instruction for a terse, semantic chat title. */
function buildChatTitlePrompt(prompt: string): string {
	return [
		'Generate a short tab title for the user request below.',
		'',
		'Output rules:',
		'- 2 to 5 words, no more than 32 characters total.',
		'- Noun phrase or imperative; no trailing punctuation.',
		'- No quotes, no markdown, no code fences, no emoji.',
		'- No prefixes like "Title:", "Tab title:", or "Here is".',
		'- No reasoning, no explanation, no apology.',
		'- Reply with the title only on a single line.',
		'',
		'USER REQUEST:',
		prompt,
	].join('\n');
}

/**
 * Normalizes the generated title to a single short line. Strips code fences,
 * markdown emphasis, headings, list bullets, conversational prefixes
 * (`Title:`, `Here's the title:`), and trailing punctuation that LLMs add
 * when they treat the response as a sentence rather than a label.
 */
function sanitizeGeneratedChatTitle(text: string): string | null {
	if (!text) {
		return null;
	}
	const stripped = text.replace(/```[a-z]*\s*([\s\S]*?)```/gi, '$1').trim();

	const firstLine = stripped
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	if (!firstLine) {
		return null;
	}

	const cleaned = firstLine
		.replace(/^#+\s*/, '')
		.replace(/^[-*+]\s*/, '')
		.replace(/^\d+[.)]\s*/, '')
		.replace(/^title\s*[:\-—]\s*/i, '')
		.replace(
			/^(?:here(?:'s| is)? (?:the |a )?(?:title|tab title)|(?:the |a )?(?:title|tab title) is)\s*[:\-—]?\s*/i,
			'',
		)
		.replace(/[*_`~]/g, '')
		.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
		.replace(/[.!?,;:]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (!cleaned) {
		return null;
	}
	if (cleaned.length <= CHAT_TITLE_MAX_LENGTH) {
		return cleaned;
	}
	// Truncate at the nearest word boundary inside the cap when possible so
	// we don't end mid-word right before the ellipsis.
	const window = cleaned.slice(0, CHAT_TITLE_MAX_LENGTH - 1);
	const lastSpace = window.lastIndexOf(' ');
	const truncated =
		lastSpace > CHAT_TITLE_MAX_LENGTH / 2 ? window.slice(0, lastSpace) : window;
	return `${truncated.trimEnd()}…`;
}

/** Builds a short fallback title from the first words of the user's prompt. */
function buildFallbackChatTitle(prompt: string): string | null {
	const fallbackText = (prompt.match(/\S+/g) ?? [])
		.slice(0, CHAT_TITLE_FALLBACK_WORD_COUNT)
		.join(' ');
	return sanitizeGeneratedChatTitle(fallbackText);
}

/** Error raised when the title helper session exceeds its time budget. */
class ChatTitleTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Chat title generation timed out after ${timeoutMs}ms.`);
		this.name = 'ChatTitleTimeoutError';
	}
}

/** Rejects if the title session does not finish quickly. */
async function waitForTitle(
	done: Promise<void>,
	timeoutMs: number,
): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<void>((_, reject) => {
		timer = setTimeout(() => {
			reject(new ChatTitleTimeoutError(timeoutMs));
		}, timeoutMs);
	});
	try {
		await Promise.race([done, timeout]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}
