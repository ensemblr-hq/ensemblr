/**
 * Derives an agent harness's conversation title from the session log it writes to
 * disk, for harnesses whose OSC window title is not the conversation title. Codex
 * puts its working directory in the window title and Mistral Vibe emits a static
 * "Vibe", so their tabs need a title sourced from the harness's own session file.
 * Each reader locates the newest session whose recorded cwd matches the tab's cwd
 * AND started at/after the tab's launch, so a freshly opened tab never adopts a
 * previous conversation's title. (Busy state is not read here: Vibe writes its log
 * only at turn end, so the terminal derives busy from live PTY spinner output.)
 */

import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { ConversationTitleSource } from '../../shared/agents/harness-registry.ts';

/** Options for the conversation-title readers, injectable for tests. */
export interface ReadAgentConversationTitleOptions {
	/** Home directory to resolve harness log paths against; defaults to the OS home. */
	home?: string;
	/**
	 * ISO timestamp of when the tab's harness launched. Only sessions that started
	 * at/after this (minus a small clock-skew tolerance) are considered, so a new
	 * tab does not adopt the previous conversation's title. Omitted → no gate.
	 */
	since?: string;
}

/** Longest title we surface on a tab; longer harness prompts are truncated. */
const MAX_TITLE_LENGTH = 80;

/** Most recent session directories/files to probe before giving up on a cwd match. */
const MAX_SESSION_CANDIDATES = 60;

/** Lines to scan inside a matched Codex rollout before abandoning the title hunt. */
const MAX_CODEX_LINES = 120;

/**
 * Clock-skew tolerance (ms) applied to the `since` gate. A new session's log is
 * written just after the tab spawns, so its start is at/after `since`; the slack
 * only absorbs sub-second rounding and never re-admits a prior conversation, which
 * is minutes older.
 */
const SESSION_START_SKEW_MS = 3_000;

/**
 * Reports whether a session that started at `startedAt` is recent enough to belong
 * to the tab launched at `since`. Always true when either timestamp is missing, so
 * a log lacking a start time is not silently dropped.
 * @param startedAt - ISO start time recorded in the session log.
 * @param since - ISO launch time of the tab, or undefined to disable the gate.
 * @returns True when the session is not older than the tab's launch.
 */
function startedSinceLaunch(
	startedAt: string | null,
	since: string | undefined,
): boolean {
	if (!since || !startedAt) {
		return true;
	}
	const started = Date.parse(startedAt);
	const launched = Date.parse(since);
	if (Number.isNaN(started) || Number.isNaN(launched)) {
		return true;
	}
	return started >= launched - SESSION_START_SKEW_MS;
}

/**
 * Collapses a raw title to a single trimmed line capped at {@link MAX_TITLE_LENGTH}.
 * @param raw - The raw title text pulled from a session log.
 * @returns The cleaned title, or null when nothing meaningful remains.
 */
function normalizeTitle(raw: string): string | null {
	const firstLine = raw.split('\n', 1)[0]?.trim() ?? '';
	if (!firstLine) {
		return null;
	}
	return firstLine.length > MAX_TITLE_LENGTH
		? `${firstLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
		: firstLine;
}

/**
 * Reports whether two absolute paths refer to the same directory, tolerating a
 * trailing separator difference between the spawned cwd and the logged one.
 * @param a - First absolute path.
 * @param b - Second absolute path.
 * @returns True when the paths are equivalent.
 */
function sameCwd(a: string, b: string): boolean {
	return a === b || path.normalize(a) === path.normalize(b);
}

/**
 * Narrows an unknown value to a plain record for safe property access when reading
 * untrusted session-log JSON.
 * @param value - The value to narrow.
 * @returns The value as a keyed record, or null when it is not an object.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object'
		? (value as Record<string, unknown>)
		: null;
}

/**
 * Returns a value only when it is a string, collapsing everything else to null so
 * callers avoid repeating the `typeof x === 'string'` guard.
 * @param value - The value to check.
 * @returns The string, or null.
 */
function asString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/**
 * Parses one JSONL line into a record, swallowing malformed lines. Only object
 * records are returned; scalars and arrays collapse to null.
 * @param line - A raw JSONL line.
 * @returns The parsed record, or null when the line is not a JSON object.
 */
function parseJsonRecord(line: string): Record<string, unknown> | null {
	try {
		return asRecord(JSON.parse(line));
	} catch {
		return null;
	}
}

/**
 * Lists candidate session entries under a directory, newest first, capped to a
 * bounded probe window. Names that embed a timestamp sort lexicographically by
 * recency, so a descending name sort yields newest-first without stat calls.
 * @param directory - Directory to list.
 * @param predicate - Keeps only entries whose name matches (e.g. a rollout prefix).
 * @returns Absolute paths of the newest matching entries, newest first.
 */
async function listRecentEntries(
	directory: string,
	predicate: (name: string) => boolean,
): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const names: string[] = [];
	for (const entry of entries) {
		if (predicate(entry.name)) {
			names.push(entry.name);
		}
	}
	names.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
	return names
		.slice(0, MAX_SESSION_CANDIDATES)
		.map((name) => path.join(directory, name));
}

/**
 * Recursively collects Codex rollout files beneath the sessions root, which Codex
 * nests under `YYYY/MM/DD/`. Directory names sort by recency, so a descending walk
 * visits the newest days first and stops once enough candidates are gathered.
 * @param root - The `~/.codex/sessions` directory.
 * @returns Absolute rollout paths, newest first, capped to the probe window.
 */
async function collectCodexRollouts(root: string): Promise<string[]> {
	const found: string[] = [];

	async function walk(directory: string): Promise<void> {
		if (found.length >= MAX_SESSION_CANDIDATES) {
			return;
		}
		const entries = await readdir(directory, { withFileTypes: true });
		const sorted = entries.sort((a, b) =>
			a.name < b.name ? 1 : a.name > b.name ? -1 : 0,
		);
		for (const entry of sorted) {
			if (found.length >= MAX_SESSION_CANDIDATES) {
				return;
			}
			const full = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else if (
				entry.name.startsWith('rollout-') &&
				entry.name.endsWith('.jsonl')
			) {
				found.push(full);
			}
		}
	}

	await walk(root);
	return found;
}

/** Outcome of scanning one Codex rollout for a matching cwd and its first prompt. */
interface CodexScanResult {
	matched: boolean;
	title: string | null;
}

/** The one rollout line kind {@link scanCodexRollout} acts on, or `other`. */
type CodexLine =
	| { kind: 'session-meta'; cwd: string | null; startedAt: string | null }
	| { kind: 'user-message'; message: string | null }
	| { kind: 'other' };

/**
 * Classifies a single Codex rollout JSONL line into the session-meta or first
 * user-message records the title scan cares about. Malformed or unrelated lines
 * collapse to `other`, keeping the streaming callback branch-light.
 * @param line - One raw line of a rollout `.jsonl`.
 * @returns The typed line kind with its extracted fields.
 */
function classifyCodexLine(line: string): CodexLine {
	const record = parseJsonRecord(line);
	const payload = record && asRecord(record.payload);
	if (!record || !payload) {
		return { kind: 'other' };
	}
	if (record.type === 'session_meta') {
		return {
			kind: 'session-meta',
			cwd: asString(payload.cwd),
			startedAt: asString(payload.timestamp),
		};
	}
	if (record.type === 'event_msg' && payload.type === 'user_message') {
		return { kind: 'user-message', message: asString(payload.message) };
	}
	return { kind: 'other' };
}

/**
 * Streams the head of a Codex rollout to check its recorded cwd and launch time
 * and, on a match, extract the first user message as the conversation title. Reads
 * only as many lines as needed and stops early, so a mismatched session costs one
 * line.
 * @param file - Absolute path to the rollout `.jsonl`.
 * @param targetCwd - The tab's cwd to match against the session's `session_meta`.
 * @param since - The tab's launch time; older sessions are skipped.
 * @returns Whether the cwd matched and the derived title when found.
 */
function scanCodexRollout(
	file: string,
	targetCwd: string,
	since: string | undefined,
): Promise<CodexScanResult> {
	return new Promise((resolve) => {
		const stream = createReadStream(file, { encoding: 'utf8' });
		const rl = createInterface({
			crlfDelay: Number.POSITIVE_INFINITY,
			input: stream,
		});
		let lineNumber = 0;
		let matched = false;
		let settled = false;

		const finish = (result: CodexScanResult) => {
			if (settled) {
				return;
			}
			settled = true;
			rl.close();
			stream.destroy();
			resolve(result);
		};

		rl.on('line', (line) => {
			lineNumber += 1;
			const parsed = classifyCodexLine(line);
			if (parsed.kind === 'session-meta') {
				const usable =
					!!parsed.cwd &&
					sameCwd(parsed.cwd, targetCwd) &&
					startedSinceLaunch(parsed.startedAt, since);
				if (!usable) {
					finish({ matched: false, title: null });
					return;
				}
				matched = true;
				return;
			}
			if (matched && parsed.kind === 'user-message') {
				finish({
					matched: true,
					title: parsed.message ? normalizeTitle(parsed.message) : null,
				});
				return;
			}
			if (lineNumber >= MAX_CODEX_LINES) {
				finish({ matched, title: null });
			}
		});
		rl.on('close', () => finish({ matched, title: null }));
		stream.on('error', () => finish({ matched: false, title: null }));
	});
}

/**
 * Reads the conversation title for a Codex tab by finding the newest rollout whose
 * cwd matches and that started at/after the tab launched, returning its first user
 * message. Codex records no title of its own, so the opening prompt is the closest
 * human-readable label.
 * @param targetCwd - The tab's working directory.
 * @param since - The tab's launch time.
 * @param home - Home directory hosting `~/.codex`.
 * @returns The derived title, or null when no matching session yields one.
 */
async function readCodexConversationTitle(
	targetCwd: string,
	since: string | undefined,
	home: string,
): Promise<string | null> {
	const root = path.join(home, '.codex', 'sessions');
	let rollouts: string[];
	try {
		rollouts = await collectCodexRollouts(root);
	} catch {
		return null;
	}
	for (const file of rollouts) {
		const result = await scanCodexRollout(file, targetCwd, since);
		if (result.matched) {
			return result.title;
		}
	}
	return null;
}

/**
 * Reads the conversation title for a Mistral Vibe tab from the newest session whose
 * `working_directory` matches and that started at/after the tab launched. Vibe
 * auto-generates and persists a `title`, so this yields a real conversation title.
 * @param targetCwd - The tab's working directory.
 * @param since - The tab's launch time.
 * @param home - Home directory hosting `~/.vibe`.
 * @returns The persisted title, or null when no matching session has one.
 */
/**
 * Extracts a Vibe session's conversation title from its parsed `meta.json`, but
 * only when the session's working directory matches the tab and it started at/after
 * the tab launched. Returns null on any mismatch or absent title.
 * @param meta - The parsed `meta.json` record.
 * @param targetCwd - The tab's working directory to match.
 * @param since - The tab's launch time gating the session, or undefined to disable.
 * @returns The normalized title, or null when the session does not qualify.
 */
function vibeTitleFromMeta(
	meta: Record<string, unknown>,
	targetCwd: string,
	since: string | undefined,
): string | null {
	const environment = asRecord(meta.environment);
	const workingDirectory = asString(environment?.working_directory);
	if (
		!workingDirectory ||
		!sameCwd(workingDirectory, targetCwd) ||
		!startedSinceLaunch(asString(meta.start_time), since)
	) {
		return null;
	}
	const title = asString(meta.title);
	return title?.trim() ? normalizeTitle(title) : null;
}

async function readVibeConversationTitle(
	targetCwd: string,
	since: string | undefined,
	home: string,
): Promise<string | null> {
	const root = path.join(home, '.vibe', 'logs', 'session');
	let sessionDirs: string[];
	try {
		sessionDirs = await listRecentEntries(root, (name) =>
			name.startsWith('session_'),
		);
	} catch {
		return null;
	}
	for (const dir of sessionDirs) {
		let raw: string;
		try {
			raw = await readFile(path.join(dir, 'meta.json'), 'utf8');
		} catch {
			continue;
		}
		const meta = parseJsonRecord(raw);
		const title = meta && vibeTitleFromMeta(meta, targetCwd, since);
		if (title) {
			return title;
		}
	}
	return null;
}

/**
 * Derives an agent tab's conversation title from the harness's on-disk session
 * log, dispatching by the harness's declared title source. Never throws: any
 * filesystem or parse failure resolves to null so the poller can retry later.
 * @param source - Which harness log format to read.
 * @param cwd - The tab's working directory used to match the right session.
 * @param options - Optional overrides such as the home directory and launch time.
 * @returns The derived conversation title, or null when none is available yet.
 */
export function readAgentConversationTitle(
	source: ConversationTitleSource,
	cwd: string,
	options: ReadAgentConversationTitleOptions = {},
): Promise<string | null> {
	const home = options.home ?? homedir();
	switch (source) {
		case 'codex-rollout':
			return readCodexConversationTitle(cwd, options.since, home);
		case 'vibe-log':
			return readVibeConversationTitle(cwd, options.since, home);
		default:
			return Promise.resolve(null);
	}
}
