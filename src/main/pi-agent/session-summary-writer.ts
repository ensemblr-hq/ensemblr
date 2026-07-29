/**
 * Projects a chat tab's session record to
 * `<workspaceCwd>/.context/sessions/<stem>.md`.
 *
 * The body is whatever the agent recorded through `ensemblr_set_summary`. When
 * it recorded nothing, the transcript is dumped instead — legible, but only a
 * fallback. No model runs here: summarizing used to spawn an ephemeral Pi
 * session per turn, which on a local provider was slow enough to time out and
 * throw the work away. The agent already holds the context a summary needs, so
 * it writes one as part of its turn and this module only formats and stores it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PiSessionEventWire } from '../../shared/ipc/contracts/pi-session';

/** Input passed to {@link writeSessionSummary}. */
export interface WriteSessionSummaryInput {
	/**
	 * The summary the agent recorded for this tab, or null to fall back to the
	 * transcript.
	 */
	agentSummary?: { body: string; title: string } | null;
	branchId: string | null;
	chatTabId: string;
	/** Close timestamp, or the live update time while the tab is still open. */
	closedAt: string;
	events: readonly PiSessionEventWire[];
	/**
	 * Filename stem for the summary markdown; defaults to `chatTabId`. Used by
	 * fork summaries so they never collide with the live per-tab summary file.
	 */
	fileBaseName?: string;
	piSessionId: string | null;
	/**
	 * Records what the file is for: `archive` (default) is a tab's own session
	 * record, `fork` a handoff brief a fresh session continues from.
	 */
	purpose?: 'archive' | 'fork';
	workspaceCwd: string;
}

/** Where a summary's body came from. */
export type SessionSummarySource = 'agent' | 'transcript';

/** Outcome of a {@link writeSessionSummary} call. */
export interface WriteSessionSummaryResult {
	path: string;
	source: SessionSummarySource;
	title: string | null;
}

/** Optional dependencies for {@link createSessionSummaryWriter}. */
export interface CreateSessionSummaryWriterOptions {
	/** Override clock for testability. */
	now?: () => Date;
	/** Override fs writers for testability. */
	writeFile?: (filePath: string, contents: string) => Promise<void>;
	mkdir?: (dirPath: string) => Promise<void>;
}

const SESSIONS_SUBDIR = path.join('.context', 'sessions');

/**
 * Single owner of the session-summary file convention:
 * `<workspaceCwd>/.context/sessions/<fileBaseName>.md`.
 */
export function resolveSessionSummaryPath({
	fileBaseName,
	workspaceCwd,
}: {
	fileBaseName: string;
	workspaceCwd: string;
}): string {
	// basename() guards against path traversal in caller-supplied stems.
	return path.join(
		workspaceCwd,
		SESSIONS_SUBDIR,
		`${path.basename(fileBaseName)}.md`,
	);
}
const STUB_BODY = '_Empty tab — no Pi session was opened._\n';

/** Public surface of the summary writer. */
export interface SessionSummaryWriter {
	writeSessionSummary: (
		input: WriteSessionSummaryInput,
	) => Promise<WriteSessionSummaryResult>;
}

/**
 * Builds a session-summary writer. Formatting and one file write; the fs seams
 * exist so tests can observe both without touching disk.
 * @param options - Optional clock and fs overrides.
 * @returns The writer.
 */
export function createSessionSummaryWriter(
	options: CreateSessionSummaryWriterOptions = {},
): SessionSummaryWriter {
	const writeFileImpl =
		options.writeFile ?? ((p, c) => writeFile(p, c, 'utf8'));
	const mkdirImpl =
		options.mkdir ??
		((p) => mkdir(p, { recursive: true }).then(() => undefined));

	return {
		writeSessionSummary: async (input) =>
			runWriteSummary({ input, mkdirImpl, writeFileImpl }),
	};
}

/**
 * Writes one session summary with an ad-hoc writer.
 * @param input - The summary to render and where to put it.
 * @param options - Optional clock and fs overrides.
 * @returns The written path, resolved title, and where the body came from.
 */
export async function writeSessionSummary(
	input: WriteSessionSummaryInput,
	options: CreateSessionSummaryWriterOptions = {},
): Promise<WriteSessionSummaryResult> {
	const writer = createSessionSummaryWriter(options);
	return writer.writeSessionSummary(input);
}

/** Internal arguments threaded into {@link runWriteSummary}. */
interface RunWriteSummaryArgs {
	input: WriteSessionSummaryInput;
	mkdirImpl: (dirPath: string) => Promise<void>;
	writeFileImpl: (filePath: string, contents: string) => Promise<void>;
}

/**
 * Renders and writes the session-summary markdown in a single pass: the agent's
 * own summary when it recorded one, else the transcript.
 * @param args - Summary input and the fs writers.
 * @returns The written path, resolved title, and where the body came from.
 */
async function runWriteSummary({
	input,
	mkdirImpl,
	writeFileImpl,
}: RunWriteSummaryArgs): Promise<WriteSessionSummaryResult> {
	const sessionsDir = path.join(input.workspaceCwd, SESSIONS_SUBDIR);
	const filePath = resolveSessionSummaryPath({
		fileBaseName: input.fileBaseName ?? input.chatTabId,
		workspaceCwd: input.workspaceCwd,
	});

	await mkdirImpl(sessionsDir);

	const transcriptEvents = filterTranscriptEvents(input.events);
	const frontmatter = (source: SessionSummarySource): string =>
		renderFrontmatter({
			branchId: input.branchId,
			chatTabId: input.chatTabId,
			closedAt: input.closedAt,
			messageCount: transcriptEvents.length,
			piSessionId: input.piSessionId,
			purpose: input.purpose ?? 'archive',
			source,
			turnCount: countTurns(transcriptEvents),
		});

	if (input.piSessionId === null || transcriptEvents.length === 0) {
		await writeFileImpl(filePath, `${frontmatter('transcript')}\n${STUB_BODY}`);
		return { path: filePath, source: 'transcript', title: null };
	}

	const agentSummary = input.agentSummary ?? null;
	if (agentSummary) {
		const body = `# ${agentSummary.title}\n\n${agentSummary.body.trim()}\n`;
		await writeFileImpl(filePath, `${frontmatter('agent')}\n${body}`);
		return { path: filePath, source: 'agent', title: agentSummary.title };
	}

	const title = extractFirstUserPrompt(transcriptEvents);
	const body = renderDeterministicBody({
		title,
		transcript: renderTranscript(transcriptEvents),
	});
	await writeFileImpl(filePath, `${frontmatter('transcript')}\n${body}`);
	return { path: filePath, source: 'transcript', title };
}

/** Fields rendered into a summary file's YAML frontmatter. */
interface RenderFrontmatterInput {
	branchId: string | null;
	chatTabId: string;
	closedAt: string;
	messageCount: number;
	piSessionId: string | null;
	purpose: 'archive' | 'fork';
	source: SessionSummarySource;
	turnCount: number;
}

/**
 * Renders the YAML frontmatter block for a summary file.
 * @param input - Metadata fields to emit
 * @returns The frontmatter block, terminated with a newline
 */
function renderFrontmatter(input: RenderFrontmatterInput): string {
	const lines = [
		'---',
		`chatTabId: ${yamlString(input.chatTabId)}`,
		`piSessionId: ${yamlNullable(input.piSessionId)}`,
		`branchId: ${yamlNullable(input.branchId)}`,
		`closedAt: ${yamlString(input.closedAt)}`,
		`messageCount: ${input.messageCount}`,
		`turnCount: ${input.turnCount}`,
		`purpose: ${yamlString(input.purpose)}`,
		`source: ${yamlString(input.source)}`,
		'---',
	];
	return `${lines.join('\n')}\n`;
}

/**
 * Encodes a string as a double-quoted YAML scalar.
 * @param value - Raw string value
 * @returns The JSON-quoted representation, safe as a YAML scalar
 */
function yamlString(value: string): string {
	return JSON.stringify(value);
}

/**
 * Encodes a nullable string as a YAML scalar, emitting `null` when absent.
 * @param value - String value or null
 * @returns `null` or the quoted string
 */
function yamlNullable(value: string | null): string {
	return value === null ? 'null' : yamlString(value);
}

/**
 * Keeps only protocol `message` events that carry a role, dropping non-transcript frames.
 * @param events - Full session event stream
 * @returns The transcript-relevant subset
 */
function filterTranscriptEvents(
	events: readonly PiSessionEventWire[],
): readonly PiSessionEventWire[] {
	return events.filter((event) => {
		if (event.stream !== 'protocol') {
			return false;
		}
		if (event.eventType !== 'message') {
			return false;
		}
		return extractRole(event) !== null;
	});
}

/**
 * Counts the distinct turns represented in the events.
 * @param events - Session events to scan
 * @returns The number of unique turn ids
 */
function countTurns(events: readonly PiSessionEventWire[]): number {
	const turns = new Set<string>();
	for (const event of events) {
		if (event.turnId) {
			turns.add(event.turnId);
		}
	}
	return turns.size;
}

/**
 * Renders events as newline-separated `[role]: text` lines.
 * @param events - Transcript events to render
 * @returns The plain-text transcript
 */
function renderTranscript(events: readonly PiSessionEventWire[]): string {
	return events
		.map((event) => {
			const role = extractRole(event) ?? 'agent';
			const text = extractText(event);
			return `[${role}]: ${text}`;
		})
		.join('\n');
}

/**
 * Builds the deterministic markdown body from an optional title and transcript.
 * @param title - Heading title; falls back to a generic heading when null
 * @param transcript - Rendered transcript body
 * @returns The markdown body
 */
function renderDeterministicBody({
	title,
	transcript,
}: {
	title: string | null;
	transcript: string;
}): string {
	const heading = title ? `# ${title}\n\n` : '# Session Transcript\n\n';
	return `${heading}${transcript}\n`;
}

/**
 * Extracts the message role from a session event.
 * @param event - Session event to inspect
 * @returns The role, or null when the event is not a message payload
 */
function extractRole(
	event: PiSessionEventWire,
): 'agent' | 'tool' | 'user' | null {
	const payload = event.payload;
	if (payload?.kind !== 'message') {
		return null;
	}
	return payload.role;
}

/**
 * Extracts the human-readable text from a message event for the transcript.
 * @param event - Session event to inspect
 * @returns The rendered text, or an empty string when there is none
 */
function extractText(event: PiSessionEventWire): string {
	const payload = event.payload;
	if (payload?.kind !== 'message') {
		return '';
	}
	const inner = payload.payload;
	switch (inner.kind) {
		case 'text':
			return inner.text;
		case 'prompt':
			return inner.prompt;
		case 'message':
			return inner.parts
				.flatMap((part) =>
					part.kind === 'text' && part.text.length > 0 ? [part.text] : [],
				)
				.join('\n');
		case 'tool-call':
			return `(tool call: ${inner.name})`;
		case 'tool-result':
			return inner.isError ? '(tool error)' : '';
		// Reasoning, streaming deltas, tool calls fall through. Reasoning is
		// excluded so chain-of-thought text doesn't bloat or distort the
		// summary; deltas are non-canonical and `message_end` carries the
		// authoritative version.
		default:
			return '';
	}
}

/**
 * Finds the first user message and returns its first line as a fallback title.
 * @param events - Transcript events to scan
 * @returns The first user prompt's first line, or null when none exists
 */
function extractFirstUserPrompt(
	events: readonly PiSessionEventWire[],
): string | null {
	for (const event of events) {
		if (extractRole(event) === 'user') {
			const text = extractText(event).trim();
			if (text.length > 0) {
				return firstLine(text);
			}
		}
	}
	return null;
}

/**
 * Returns the first line of the text, trimmed and capped at 120 characters.
 * @param text - Source text
 * @returns The truncated first line
 */
function firstLine(text: string): string {
	const lineEnd = text.indexOf('\n');
	const slice = lineEnd === -1 ? text : text.slice(0, lineEnd);
	return slice.trim().slice(0, 120);
}
