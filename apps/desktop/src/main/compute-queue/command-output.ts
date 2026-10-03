import {
	chmodSync,
	constants,
	createWriteStream,
	openSync,
	type WriteStream,
} from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import {
	createTextRedactor,
	type TextRedactor,
} from '../../shared/redaction.ts';
import { ensureContextPath } from '../config/context-directory.ts';

/** Characters of cleaned output kept in memory for an agent to read. */
export const OUTPUT_TAIL_CHARS = 64 * 1024;

/**
 * Longest partial line held back waiting for its newline. Redaction runs per
 * line so a secret is never split across two redaction passes; a line longer
 * than this is cleaned in pieces rather than buffered without bound. Kept
 * small because the shared redactor's URL-credential pattern is quadratic on a
 * long run of word characters, and it runs on the main process's event loop.
 */
const MAX_PENDING_LINE_CHARS = 2 * 1024;

/** Subdirectory of a worktree's `.context` holding one log per command job. */
const LOG_SUBDIR = 'compute-queue';

/** Owner-only, matching the terminal logs: command output may echo credentials. */
const LOG_DIRECTORY_MODE = 0o700;

/** Owner-only file mode for a new job log. */
const LOG_FILE_MODE = 0o600;

/**
 * Exclusive create that never traverses a final symlink, so a repository that
 * committed a link at the log's path gets an error instead of a write through it.
 */
const LOG_OPEN_FLAGS =
	constants.O_WRONLY |
	constants.O_CREAT |
	constants.O_EXCL |
	constants.O_NOFOLLOW;

/**
 * CSI and OSC escape sequences plus two-byte escapes — what colored and
 * progress-bar output emits. Stripped so an agent reads text, not terminal state.
 */
const ANSI_ESCAPE_PATTERN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point.
	/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)?|[@-Z\\-_])/g;

/** The cleaned tail of a job's output and how much was dropped before it. */
export interface OutputTail {
	omittedChars: number;
	text: string;
}

/** Combined stdout/stderr collector for one command job. */
export interface CommandOutput {
	/** Flushes held-back partial lines and closes the log. */
	end: () => Promise<void>;
	/** Absolute log path, or null when the log could not be created. */
	logPath: string | null;
	/** Records text that did not come from the process, such as a spawn failure. */
	note: (text: string) => void;
	/** The cleaned tail so far, held-back partial lines included. */
	tail: () => OutputTail;
	/** Feeds one raw chunk from a stream. */
	write: (stream: 'stderr' | 'stdout', chunk: Buffer) => void;
}

/**
 * Removes terminal escape sequences and normalizes CRLF line endings.
 * @param text - Raw process output.
 * @returns The text a reader would see, without terminal control codes.
 */
export function stripAnsi(text: string): string {
	return text.replace(ANSI_ESCAPE_PATTERN, '').replace(/\r\n/g, '\n');
}

/**
 * Opens the job's log under `.context/compute-queue`, refusing any level that
 * resolves outside the worktree. Best-effort: a job never fails for want of a log.
 * @param workspacePath - Absolute workspace root.
 * @param jobId - Job id, used as the file name.
 * @returns The open stream and its path, or null when no log could be created.
 */
function openJobLog(
	workspacePath: string,
	jobId: string,
): { path: string; stream: WriteStream } | null {
	try {
		const logPath = ensureContextPath(
			workspacePath,
			LOG_SUBDIR,
			`${jobId}.log`,
		);
		if (logPath === null) {
			return null;
		}
		chmodSync(path.dirname(logPath), LOG_DIRECTORY_MODE);
		const fd = openSync(logPath, LOG_OPEN_FLAGS, LOG_FILE_MODE);
		const stream = createWriteStream(logPath, { fd });
		stream.on('error', () => {});
		return { path: logPath, stream };
	} catch {
		return null;
	}
}

/**
 * Bounded in-memory tail that counts what it drops from the front.
 * @returns Append and read functions over the tail.
 */
function createTailBuffer(): {
	append: (text: string) => void;
	read: (suffix: string) => OutputTail;
} {
	let buffer = '';
	let dropped = 0;

	return {
		append: (text) => {
			buffer += text;
			if (buffer.length > OUTPUT_TAIL_CHARS * 2) {
				const cut = buffer.length - OUTPUT_TAIL_CHARS;
				dropped += cut;
				buffer = buffer.slice(cut);
			}
		},
		read: (suffix) => {
			const whole = buffer + suffix;
			const cut = Math.max(0, whole.length - OUTPUT_TAIL_CHARS);
			return { omittedChars: dropped + cut, text: whole.slice(cut) };
		},
	};
}

/**
 * Builds the collector a running command streams into: output is decoded per
 * stream, split into lines, stripped of ANSI, redacted, then appended to both
 * the log and the in-memory tail. Output volume only ever trims the tail.
 * @param input - Workspace root, job id, and the literal values to redact.
 * @returns The collector for the job's combined output.
 */
export function createCommandOutput(input: {
	jobId: string;
	redactValues: readonly string[];
	workspacePath: string;
}): CommandOutput {
	const redact: TextRedactor = createTextRedactor(input.redactValues);
	const log = openJobLog(input.workspacePath, input.jobId);
	const tail = createTailBuffer();
	const decoders = {
		stderr: new StringDecoder('utf8'),
		stdout: new StringDecoder('utf8'),
	};
	const pending = { stderr: '', stdout: '' };

	/**
	 * Cleans finished text and fans it out to the log and the tail.
	 * @param text - Raw text ending at a line boundary, or a capped fragment.
	 */
	function emit(text: string): void {
		if (text === '') {
			return;
		}
		const cleaned = redact(stripAnsi(text));
		log?.stream.write(cleaned);
		tail.append(cleaned);
	}

	/**
	 * Adds decoded text to a stream's held-back line and emits complete lines.
	 * @param stream - Which stream the text came from.
	 * @param text - Newly decoded text.
	 */
	function accept(stream: 'stderr' | 'stdout', text: string): void {
		const combined = pending[stream] + text;
		const lastNewline = combined.lastIndexOf('\n');
		const complete =
			lastNewline === -1 ? '' : combined.slice(0, lastNewline + 1);
		const rest = combined.slice(lastNewline + 1);
		emit(complete);
		if (rest.length > MAX_PENDING_LINE_CHARS) {
			emit(rest);
			pending[stream] = '';
			return;
		}
		pending[stream] = rest;
	}

	return {
		end: async () => {
			for (const stream of ['stdout', 'stderr'] as const) {
				accept(stream, decoders[stream].end());
				emit(pending[stream]);
				pending[stream] = '';
			}
			const stream = log?.stream;
			if (stream) {
				await new Promise<void>((resolve) => stream.end(resolve));
			}
		},
		logPath: log?.path ?? null,
		note: (text) => emit(text.endsWith('\n') ? text : `${text}\n`),
		tail: () => tail.read(redact(stripAnsi(pending.stdout + pending.stderr))),
		write: (stream, chunk) => accept(stream, decoders[stream].write(chunk)),
	};
}
