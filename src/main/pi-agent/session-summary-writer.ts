import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PiSessionEventWire } from '../../shared/ipc/contracts/pi-session';
import type { PiExecutableSnapshot } from '../pi-runtime/pi-executable.ts';
import type { PiAgentClient } from './pi-agent-client.ts';
import type { PiAgentEvent } from './pi-agent-types.ts';

/** Input passed to {@link writeSessionSummary}. */
export interface WriteSessionSummaryInput {
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
	/**
	 * Model the chat session is on, forwarded to the ephemeral summary session
	 * so the summary runs on the same provider/model as the conversation — no
	 * surprise fallback to Pi's default provider. `null` keeps the Pi default.
	 */
	model?: string | null;
	piSessionId: string | null;
	/**
	 * Shapes the LLM prompt: `archive` (default) writes a closed-tab session
	 * record; `fork` writes a tight handoff brief a fresh session can continue
	 * from.
	 */
	purpose?: 'archive' | 'fork';
	workspaceCwd: string;
}

/** Outcome of a {@link writeSessionSummary} call. */
export interface WriteSessionSummaryResult {
	path: string;
	title: string | null;
	usedLlm: boolean;
}

/** Optional dependencies for {@link createSessionSummaryWriter}. */
export interface CreateSessionSummaryWriterOptions {
	/** Ephemeral Pi client used for LLM-backed summaries. When `null` we fall back to deterministic output. */
	piAgentClient?: PiAgentClient | null;
	/**
	 * Resolver for the Pi executable. Called once per summary so the writer can
	 * pick up override changes without rebuilding the client.
	 */
	resolveExecutable?: () => Promise<PiExecutableSnapshot | null>;
	/** Pi response timeout. Default 30 seconds. */
	timeoutMs?: number;
	/** Override clock for testability. */
	now?: () => Date;
	/** Override fs writers for testability. */
	writeFile?: (filePath: string, contents: string) => Promise<void>;
	mkdir?: (dirPath: string) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
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
/**
 * Upper bound on the transcript sent to the LLM. Long sessions otherwise eat
 * full context windows and either time out or are silently truncated by the
 * runtime. We keep the opening prompt for topic anchoring and the tail for
 * recent state; the middle is replaced with an explicit `[…]` marker so the
 * summarizer knows context was elided.
 */
const TRANSCRIPT_MAX_CHARS = 18_000;
const TRANSCRIPT_HEAD_CHARS = 4_000;
const TRANSCRIPT_TAIL_CHARS = 13_500;

/** Public surface of the summary writer. */
export interface SessionSummaryWriter {
	writeSessionSummary: (
		input: WriteSessionSummaryInput,
	) => Promise<WriteSessionSummaryResult>;
}

/**
 * Builds a session-summary writer. Pass a `piAgentClient` + executable to
 * enable LLM-backed summaries; without those, the writer always emits the
 * deterministic transcript fallback.
 */
export function createSessionSummaryWriter(
	options: CreateSessionSummaryWriterOptions = {},
): SessionSummaryWriter {
	const piAgentClient = options.piAgentClient ?? null;
	const resolveExecutable =
		options.resolveExecutable ?? (() => Promise.resolve(null));
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const writeFileImpl =
		options.writeFile ?? ((p, c) => writeFile(p, c, 'utf8'));
	const mkdirImpl =
		options.mkdir ??
		((p) => mkdir(p, { recursive: true }).then(() => undefined));

	return {
		writeSessionSummary: async (input) => {
			const executable = piAgentClient ? await resolveExecutable() : null;
			return runWriteSummary({
				executable,
				input,
				mkdirImpl,
				piAgentClient,
				timeoutMs,
				writeFileImpl,
			});
		},
	};
}

/**
 * Convenience entry point matching the signature requested by the WS-A spec.
 * Builds an ad-hoc writer that runs deterministically; production wiring uses
 * {@link createSessionSummaryWriter} so dependencies are injected once.
 */
export async function writeSessionSummary(
	input: WriteSessionSummaryInput,
	options: CreateSessionSummaryWriterOptions = {},
): Promise<WriteSessionSummaryResult> {
	const writer = createSessionSummaryWriter(options);
	return writer.writeSessionSummary(input);
}

interface RunWriteSummaryArgs {
	executable: PiExecutableSnapshot | null;
	input: WriteSessionSummaryInput;
	mkdirImpl: (dirPath: string) => Promise<void>;
	piAgentClient: PiAgentClient | null;
	timeoutMs: number;
	writeFileImpl: (filePath: string, contents: string) => Promise<void>;
}

async function runWriteSummary({
	executable,
	input,
	mkdirImpl,
	piAgentClient,
	timeoutMs,
	writeFileImpl,
}: RunWriteSummaryArgs): Promise<WriteSessionSummaryResult> {
	const sessionsDir = path.join(input.workspaceCwd, SESSIONS_SUBDIR);
	const filePath = resolveSessionSummaryPath({
		fileBaseName: input.fileBaseName ?? input.chatTabId,
		workspaceCwd: input.workspaceCwd,
	});

	await mkdirImpl(sessionsDir);

	const transcriptEvents = filterTranscriptEvents(input.events);
	const messageCount = transcriptEvents.length;
	const turnCount = countTurns(transcriptEvents);

	if (input.piSessionId === null || transcriptEvents.length === 0) {
		const stubFrontmatter = renderFrontmatter({
			branchId: input.branchId,
			chatTabId: input.chatTabId,
			closedAt: input.closedAt,
			messageCount: 0,
			piSessionId: input.piSessionId,
			summaryModel: null,
			turnCount: 0,
		});
		await writeFileImpl(filePath, `${stubFrontmatter}\n${STUB_BODY}`);
		return { path: filePath, title: null, usedLlm: false };
	}

	const transcript = renderTranscript(transcriptEvents);
	const fallbackTitle = extractFirstUserPrompt(transcriptEvents);

	// Write a deterministic transcript first so a crash during LLM summarization
	// still leaves the latest conversation on disk.
	const fallbackFrontmatter = renderFrontmatter({
		branchId: input.branchId,
		chatTabId: input.chatTabId,
		closedAt: input.closedAt,
		messageCount,
		piSessionId: input.piSessionId,
		summaryModel: null,
		turnCount,
	});
	const fallbackBody = renderDeterministicBody({
		title: fallbackTitle,
		transcript,
	});
	await writeFileImpl(filePath, `${fallbackFrontmatter}\n${fallbackBody}`);

	if (piAgentClient && executable) {
		const llm = await tryLlmSummary({
			executable,
			model: input.model ?? null,
			piAgentClient,
			purpose: input.purpose ?? 'archive',
			timeoutMs,
			transcript,
			workspaceCwd: input.workspaceCwd,
		});
		if (llm) {
			const frontmatter = renderFrontmatter({
				branchId: input.branchId,
				chatTabId: input.chatTabId,
				closedAt: input.closedAt,
				messageCount,
				piSessionId: input.piSessionId,
				summaryModel: llm.model,
				turnCount,
			});
			await writeFileImpl(filePath, `${frontmatter}\n${llm.body}`);
			return { path: filePath, title: llm.title, usedLlm: true };
		}
	}

	return { path: filePath, title: fallbackTitle, usedLlm: false };
}

interface RenderFrontmatterInput {
	branchId: string | null;
	chatTabId: string;
	closedAt: string;
	messageCount: number;
	piSessionId: string | null;
	summaryModel: string | null;
	turnCount: number;
}

function renderFrontmatter(input: RenderFrontmatterInput): string {
	const lines = [
		'---',
		`chatTabId: ${yamlString(input.chatTabId)}`,
		`piSessionId: ${yamlNullable(input.piSessionId)}`,
		`branchId: ${yamlNullable(input.branchId)}`,
		`closedAt: ${yamlString(input.closedAt)}`,
		`messageCount: ${input.messageCount}`,
		`turnCount: ${input.turnCount}`,
		`summaryModel: ${yamlNullable(input.summaryModel)}`,
		'---',
	];
	return `${lines.join('\n')}\n`;
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function yamlNullable(value: string | null): string {
	return value === null ? 'null' : yamlString(value);
}

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

function countTurns(events: readonly PiSessionEventWire[]): number {
	const turns = new Set<string>();
	for (const event of events) {
		if (event.turnId) {
			turns.add(event.turnId);
		}
	}
	return turns.size;
}

function renderTranscript(events: readonly PiSessionEventWire[]): string {
	return events
		.map((event) => {
			const role = extractRole(event) ?? 'agent';
			const text = extractText(event);
			return `[${role}]: ${text}`;
		})
		.join('\n');
}

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

function extractRole(
	event: PiSessionEventWire,
): 'agent' | 'tool' | 'user' | null {
	const payload = event.payload;
	if (payload?.kind !== 'message') {
		return null;
	}
	return payload.role;
}

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

function firstLine(text: string): string {
	const lineEnd = text.indexOf('\n');
	const slice = lineEnd === -1 ? text : text.slice(0, lineEnd);
	return slice.trim().slice(0, 120);
}

interface TryLlmSummaryArgs {
	executable: PiExecutableSnapshot;
	/** Chat model to mirror; `null` falls back to the Pi default. */
	model: string | null;
	piAgentClient: PiAgentClient;
	purpose: 'archive' | 'fork';
	timeoutMs: number;
	transcript: string;
	workspaceCwd: string;
}

interface LlmSummaryResult {
	body: string;
	model: string | null;
	title: string | null;
}

async function tryLlmSummary(
	args: TryLlmSummaryArgs,
): Promise<LlmSummaryResult | null> {
	const cappedTranscript = capTranscript(args.transcript);
	const prompt =
		args.purpose === 'fork'
			? buildForkSummaryPrompt(cappedTranscript)
			: buildSummaryPrompt(cappedTranscript);

	try {
		const session = await args.piAgentClient.createSession({
			executable: args.executable,
			label: 'ensemblr-session-summary',
			modelOverride: args.model,
			workspaceCwd: args.workspaceCwd,
		});

		const collected: string[] = [];
		let resolveAgent: () => void = () => undefined;
		const agentDone = new Promise<void>((resolve) => {
			resolveAgent = resolve;
		});

		// Subscribe to agent text only — tool outputs are excluded inside
		// `extractTextFromAgentEvent` so file dumps and command output never
		// land inside the summary or get parsed as the title.
		const subscription = session.subscribe((event) => {
			if (event.type === 'message' && event.role === 'agent') {
				const text = extractTextFromAgentEvent(event);
				if (text) {
					collected.push(text);
				}
				return;
			}
			if (event.type === 'status' && event.status === 'idle') {
				resolveAgent();
				return;
			}
			if (event.type === 'shutdown') {
				resolveAgent();
			}
		});

		try {
			await session.submit({ prompt });
			try {
				await raceWithTimeout(agentDone, args.timeoutMs);
			} catch (cause) {
				// On timeout we still attempt to use whatever the model produced.
				// A partial 100-word summary beats falling all the way back to
				// the raw transcript dump.
				if (collected.length === 0) {
					throw cause;
				}
			}
		} finally {
			subscription.unsubscribe();
			await session.close().catch(() => undefined);
		}

		const text = collected.join('\n').trim();
		if (!text) {
			return null;
		}
		const { body, title } = splitTitle(text);
		const metadataModel = session.getMetadata().model?.id ?? null;
		return { body, model: metadataModel, title };
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		console.warn(
			'[session-summary-writer] LLM summary failed, falling back to deterministic dump.',
			{ detail },
		);
		return null;
	}
}

/**
 * Caps the transcript at {@link TRANSCRIPT_MAX_CHARS} by keeping the head
 * (topic anchor) and tail (recent state) and replacing the middle with an
 * explicit elision marker so the summarizer knows context was dropped.
 */
function capTranscript(transcript: string): string {
	if (transcript.length <= TRANSCRIPT_MAX_CHARS) {
		return transcript;
	}
	const head = transcript.slice(0, TRANSCRIPT_HEAD_CHARS);
	const tail = transcript.slice(transcript.length - TRANSCRIPT_TAIL_CHARS);
	const omitted = transcript.length - head.length - tail.length;
	return `${head}\n\n[… ${omitted.toLocaleString()} characters omitted …]\n\n${tail}`;
}

function buildSummaryPrompt(transcript: string): string {
	return [
		'Write a session summary for the conversation below.',
		'',
		'Output format (markdown, plain text — no code fences around the response):',
		'  Line 1: A topic title, 3 to 7 words, no markdown, no quotes, no trailing punctuation.',
		'  Line 2: blank line.',
		'  Lines 3+: 3 to 6 bullet points covering decisions made, code or files touched, and outstanding follow-ups.',
		'',
		'Strict rules:',
		'- Hard cap of 200 words across the entire response.',
		'- No preamble like "Here is the summary" or "Sure".',
		'- No explanation, no apology, no chain-of-thought.',
		'- Do not wrap the response in ``` fences.',
		'- If the transcript was truncated, infer state from what is present; do not mention the truncation in the output.',
		'',
		'TRANSCRIPT:',
		transcript,
	].join('\n');
}

/**
 * Fork variant of the summary prompt: a terse handoff brief a fresh agent
 * session can act on immediately, rather than an archival record.
 */
function buildForkSummaryPrompt(transcript: string): string {
	return [
		'Write a fork handoff brief for the conversation below. A new agent session will continue this work in a fresh context with ONLY your output as background.',
		'',
		'Output format (markdown, plain text — no code fences around the response):',
		'  Line 1: A topic title, 3 to 7 words, no markdown, no quotes, no trailing punctuation.',
		'  Line 2: blank line.',
		'  Lines 3+: 4 to 8 tight bullet points covering: the goal, key decisions and constraints, exact file paths / branches / commands involved, current state, and the immediate next step.',
		'',
		'Strict rules:',
		'- Hard cap of 250 words across the entire response.',
		'- Be concrete: prefer file paths, identifiers, and commands over prose.',
		'- No preamble, no explanation, no chain-of-thought.',
		'- Do not wrap the response in ``` fences.',
		'- If the transcript was truncated, infer state from what is present; do not mention the truncation in the output.',
		'',
		'TRANSCRIPT:',
		transcript,
	].join('\n');
}

function extractTextFromAgentEvent(event: PiAgentEvent): string {
	if (event.type !== 'message' || event.role !== 'agent') {
		return '';
	}
	const payload = event.payload;
	switch (payload.kind) {
		case 'text':
			return payload.text;
		case 'message':
			return payload.parts
				.flatMap((part) =>
					part.kind === 'text' && part.text.length > 0 ? [part.text] : [],
				)
				.join('\n');
		default:
			return '';
	}
}

async function raceWithTimeout(
	promise: Promise<void>,
	timeoutMs: number,
): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<void>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`Pi summary timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});
	try {
		await Promise.race([promise, timeout]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

function splitTitle(text: string): { body: string; title: string | null } {
	const stripped = text.replace(/```[a-z]*\s*([\s\S]*?)```/gi, '$1').trim();
	if (stripped.length === 0) {
		return { body: '', title: null };
	}
	const lines = stripped.split(/\r?\n/);
	const firstLineIndex = lines.findIndex((line) => line.trim().length > 0);
	if (firstLineIndex === -1) {
		return { body: '', title: null };
	}
	const firstLineRaw = lines[firstLineIndex] ?? '';
	const title = sanitizeSummaryTitle(firstLineRaw);
	const remainder = lines
		.slice(firstLineIndex + 1)
		.join('\n')
		.trimStart();
	const heading = title ?? 'Session Summary';
	const body =
		remainder.length === 0
			? `# ${heading}\n`
			: `# ${heading}\n\n${remainder}\n`;
	return { body, title };
}

/**
 * Cleans the LLM's first line so a conversational preamble (e.g.
 * "Here's a summary:") does not become the tab title.
 */
function sanitizeSummaryTitle(line: string): string | null {
	const cleaned = line
		.replace(/^#+\s*/, '')
		.replace(/^[-*+]\s*/, '')
		.replace(/^\d+[.)]\s*/, '')
		.replace(/^title\s*[:\-—]\s*/i, '')
		.replace(
			/^(?:here(?:'s| is)? (?:the |a )?(?:summary|session summary|title)|(?:the |a )?(?:summary|title) is)\s*[:\-—]?\s*/i,
			'',
		)
		.replace(/[*_`~]/g, '')
		.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
		.replace(/[.!?,;:]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned.length > 0 ? cleaned : null;
}
