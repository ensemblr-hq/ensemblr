import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PiSessionEventWire } from '../../shared/ipc/contracts/pi-session.ts';
import type { PiExecutableSnapshot } from '../pi-runtime/pi-executable.ts';
import type { PiAgentClient } from './pi-agent-client.ts';
import type { PiAgentEvent } from './pi-agent-types.ts';

/** Input passed to {@link writeSessionSummary}. */
export interface WriteSessionSummaryInput {
	branchId: string | null;
	chatTabId: string;
	closedAt: string;
	events: readonly PiSessionEventWire[];
	piSessionId: string | null;
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
const STUB_BODY = '_Empty tab — no Pi session was opened._\n';

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
	const filePath = path.join(sessionsDir, `${input.chatTabId}.md`);

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

	if (piAgentClient && executable) {
		const llm = await tryLlmSummary({
			executable,
			piAgentClient,
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

	// Deterministic fallback: title from first user prompt, body = full transcript.
	const fallbackTitle = extractFirstUserPrompt(transcriptEvents);
	const fallbackBody = renderDeterministicBody({
		title: fallbackTitle,
		transcript,
	});
	const frontmatter = renderFrontmatter({
		branchId: input.branchId,
		chatTabId: input.chatTabId,
		closedAt: input.closedAt,
		messageCount,
		piSessionId: input.piSessionId,
		summaryModel: null,
		turnCount,
	});
	await writeFileImpl(filePath, `${frontmatter}\n${fallbackBody}`);
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
	if (!payload || payload.kind !== 'message') {
		return null;
	}
	return payload.role;
}

function extractText(event: PiSessionEventWire): string {
	const payload = event.payload;
	if (!payload || payload.kind !== 'message') {
		return '';
	}
	const inner = payload.payload;
	switch (inner.kind) {
		case 'text':
		case 'reasoning':
			return inner.text;
		case 'prompt':
			return inner.prompt;
		case 'message':
			return inner.parts
				.map((part) =>
					part.kind === 'text' || part.kind === 'reasoning' ? part.text : '',
				)
				.filter((value) => value.length > 0)
				.join('\n');
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
	piAgentClient: PiAgentClient;
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
	const prompt = buildSummaryPrompt(args.transcript);

	try {
		const session = await args.piAgentClient.createSession({
			executable: args.executable,
			label: 'ensemble-session-summary',
			workspaceCwd: args.workspaceCwd,
		});

		const collected: string[] = [];
		let resolveAgent: () => void = () => undefined;
		const agentDone = new Promise<void>((resolve) => {
			resolveAgent = resolve;
		});

		const subscription = session.subscribe((event) => {
			if (
				event.type === 'message' &&
				(event.role === 'agent' || event.role === 'tool')
			) {
				const text = extractTextFromAgentEvent(event);
				if (text) {
					collected.push(text);
				}
			}
			if (event.type === 'status' && event.status === 'idle') {
				resolveAgent();
			}
			if (event.type === 'shutdown') {
				resolveAgent();
			}
		});

		try {
			await session.submit({ prompt });
			await raceWithTimeout(agentDone, args.timeoutMs);
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

function buildSummaryPrompt(transcript: string): string {
	return [
		'Summarize the following Conductor workspace conversation in markdown (max 200 words). Lead with a 1-line topic title. Then 3-6 bullet points covering decisions, code touched, and outstanding follow-ups.',
		'',
		'TRANSCRIPT:',
		transcript,
	].join('\n');
}

function extractTextFromAgentEvent(event: PiAgentEvent): string {
	if (event.type !== 'message') {
		return '';
	}
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
				.filter((value) => value.length > 0)
				.join('\n');
		case 'prompt':
			return payload.prompt;
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
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return { body: '', title: null };
	}
	const newlineIndex = trimmed.indexOf('\n');
	const firstLineRaw =
		newlineIndex === -1 ? trimmed : trimmed.slice(0, newlineIndex);
	const remainder =
		newlineIndex === -1 ? '' : trimmed.slice(newlineIndex + 1).trimStart();
	const title = stripMarkdownHeading(firstLineRaw).trim();
	const body =
		remainder.length === 0
			? `# ${title || 'Session Summary'}\n`
			: `# ${title || 'Session Summary'}\n\n${remainder}\n`;
	return { body, title: title.length > 0 ? title : null };
}

function stripMarkdownHeading(line: string): string {
	return line.replace(/^#+\s*/, '').trim();
}
