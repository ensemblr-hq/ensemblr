import type { DatabaseSync } from 'node:sqlite';

import type { PiExecutableSnapshot } from '../pi-runtime/pi-executable.ts';
import { renameChatTab } from '../storage/repositories/chat-tab-repository.ts';
import type { PiAgentClient } from './pi-agent-client.ts';
import type { PiAgentEvent } from './pi-agent-types.ts';
import { appendChatTitleMetadataEvent } from './pi-session-persistence.ts';
import type { PiSessionEventSink } from './pi-session-types.ts';

export const CHAT_TITLE_TIMEOUT_MS = 8000;
const CHAT_TITLE_MAX_LENGTH = 32;
const CHAT_TITLE_FALLBACK_WORD_COUNT = 5;

export interface QueueChatTitleGenerationArgs {
	branchId: string;
	chatTitleTimeoutMs: number;
	database: DatabaseSync;
	eventSink: PiSessionEventSink | undefined;
	executable: PiExecutableSnapshot;
	initialPrompt: string | null;
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
		piAgentClient,
		prompt,
		timeoutMs: chatTitleTimeoutMs,
		workspaceCwd,
	})
		.then((title) => {
			if (!title) {
				return;
			}
			persistChatTitle({
				branchId,
				database,
				eventSink,
				sessionId,
				tabId,
				title,
				workspaceId,
			});
		})
		.catch((cause: unknown) => {
			if (cause instanceof ChatTitleTimeoutError) {
				const title = buildFallbackChatTitle(prompt);
				if (title) {
					persistChatTitle({
						branchId,
						database,
						eventSink,
						sessionId,
						tabId,
						title,
						workspaceId,
					});
				}
				return;
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

/** Asks Pi for a super-short tab title and returns sanitized plain text. */
async function generateChatTitle({
	executable,
	piAgentClient,
	prompt,
	timeoutMs,
	workspaceCwd,
}: {
	executable: PiExecutableSnapshot;
	piAgentClient: PiAgentClient;
	prompt: string;
	timeoutMs: number;
	workspaceCwd: string;
}): Promise<string | null> {
	const session = await piAgentClient.createSession({
		executable,
		label: 'ensemble-chat-title',
		workspaceCwd,
	});
	const chunks: string[] = [];
	let resolveDone: () => void = () => undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	const subscription = session.subscribe((event) => {
		if (event.type === 'message' && event.role === 'agent') {
			const text = extractTitleText(event);
			if (text) {
				chunks.push(text);
				resolveDone();
			}
		}
		if (event.type === 'status' && event.status === 'idle') {
			resolveDone();
		}
		if (event.type === 'shutdown') {
			resolveDone();
		}
	});

	try {
		await session.submit({ prompt: buildChatTitlePrompt(prompt) });
		await waitForTitle(done, timeoutMs);
		return sanitizeGeneratedChatTitle(chunks.join('\n'));
	} finally {
		subscription.unsubscribe();
		await session.close().catch(() => undefined);
	}
}

/** Builds the LLM instruction for a terse, semantic chat title. */
function buildChatTitlePrompt(prompt: string): string {
	return [
		'Create a super-short chat tab title for this user request.',
		'Rules: 2-5 words, max 32 characters, noun phrase, no quotes, no punctuation unless needed.',
		'Return only the title.',
		'',
		'USER REQUEST:',
		prompt,
	].join('\n');
}

/** Pulls plain text out of a normalized Pi agent message payload. */
function extractTitleText(
	event: Extract<PiAgentEvent, { type: 'message' }>,
): string {
	const payload = event.payload;
	switch (payload.kind) {
		case 'text':
		case 'reasoning':
			return payload.text;
		case 'message':
			return payload.parts
				.map((part) =>
					part.kind === 'text' || part.kind === 'reasoning' ? part.text : '',
				)
				.join(' ')
				.trim();
		case 'prompt':
			return payload.prompt;
		default:
			return '';
	}
}

/** Normalizes the generated title to a single short line. */
function sanitizeGeneratedChatTitle(text: string): string | null {
	const firstLine = text
		.trim()
		.split(/\r?\n/)[0]
		?.replace(/^#+\s*/, '')
		.replace(/^[-*]\s*/, '')
		.replace(/^title:\s*/i, '')
		.replace(/["'“”]/g, '')
		.trim();
	if (!firstLine) {
		return null;
	}
	if (firstLine.length <= CHAT_TITLE_MAX_LENGTH) {
		return firstLine;
	}
	return `${firstLine.slice(0, CHAT_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
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
