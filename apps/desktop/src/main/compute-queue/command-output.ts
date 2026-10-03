import {
	chmodSync,
	constants,
	createWriteStream,
	openSync,
	type WriteStream,
} from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { ensureContextPath } from '../config/context-directory.ts';
import {
	createOutputRedactor,
	cutPartialLine,
	maskOpenPrivateKey,
	openPrivateKeyLineStart,
} from './output-redaction.ts';

/** Characters of cleaned output kept in memory for an agent to read. */
export const OUTPUT_TAIL_CHARS = 64 * 1024;

/**
 * Longest partial line held back waiting for its newline, beyond the longest
 * literal secret. Redaction runs on whole lines so a secret is never split
 * across two passes; a line longer than this is cut at whitespace (or has the
 * token across the cut masked) rather than buffered without bound.
 */
const MAX_PENDING_LINE_CHARS = 128 * 1024;

/** Characters that end the token a forced cut masked: whitespace, as for the cut itself. */
const TOKEN_BOUNDARY = /\s/;

/**
 * Longest private-key block held back waiting for its END line. A real key is
 * a few kilobytes; a block that outgrows this is masked rather than released.
 */
const MAX_HELD_PRIVATE_KEY_CHARS = 16 * 1024;

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
	/**
	 * The cleaned tail so far. A partial line still held back is left out until
	 * it completes, since its end may be the first half of a secret.
	 */
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
	read: () => OutputTail;
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
		read: () => {
			const cut = Math.max(0, buffer.length - OUTPUT_TAIL_CHARS);
			return { omittedChars: dropped + cut, text: buffer.slice(cut) };
		},
	};
}

/**
 * Builds the collector a running command streams into: output is decoded per
 * stream, split into lines, stripped of ANSI, redacted, then appended to both
 * the log and the in-memory tail. Output volume only ever trims the tail. An
 * unclosed private-key block is held back until its END line so the whole
 * block is redacted at once, whichever pipe chunks it arrived in.
 * @param input - Workspace root, job id, and the literal values to redact.
 * @returns The collector for the job's combined output.
 */
export function createCommandOutput(input: {
	jobId: string;
	redactValues: readonly string[];
	workspacePath: string;
}): CommandOutput {
	const redactor = createOutputRedactor(input.redactValues);
	const log = openJobLog(input.workspacePath, input.jobId);
	const tail = createTailBuffer();
	const decoders = {
		stderr: new StringDecoder('utf8'),
		stdout: new StringDecoder('utf8'),
	};
	const pending = { stderr: '', stdout: '' };
	const dropping = { stderr: false, stdout: false };

	/**
	 * Cleans finished text and fans it out to the log and the tail.
	 * @param text - Raw text ending at a line boundary, or a capped fragment.
	 */
	function emit(text: string): void {
		if (text === '') {
			return;
		}
		const cleaned = redactor.redact(stripAnsi(text));
		log?.stream.write(cleaned);
		tail.append(cleaned);
	}

	/**
	 * Decides how much of a stream's held-back text may stay held: an open key
	 * block up to its bound, else a partial line up to its bound. Whatever
	 * outgrows its bound is emitted — a key block masked, a long line stripped of
	 * ANSI (so no cut lands inside an escape) and cut at whitespace.
	 * @param stream - Which stream the text belongs to.
	 * @param held - Text after the last emitted line.
	 * @param holdsKey - Whether it contains an unclosed private-key block.
	 * @returns The text that stays held.
	 */
	function boundHeld(
		stream: 'stderr' | 'stdout',
		held: string,
		holdsKey: boolean,
	): string {
		if (holdsKey) {
			if (held.length <= MAX_HELD_PRIVATE_KEY_CHARS) {
				return held;
			}
			emit(maskOpenPrivateKey(held));
			return '';
		}
		if (held.length <= MAX_PENDING_LINE_CHARS + redactor.literalHoldChars) {
			return held;
		}
		const safe = redactor.redactLiterals(stripAnsi(held));
		const cut = cutPartialLine(safe, safe.length - redactor.literalHoldChars);
		emit(cut.emit);
		dropping[stream] = cut.dropping;
		return cut.keep;
	}

	/**
	 * Discards the rest of a token a forced cut masked, up to its boundary.
	 * @param stream - Which stream the text came from.
	 * @param text - Newly decoded text.
	 * @returns The text after the masked token, or nothing while it continues.
	 */
	function skipMaskedToken(stream: 'stderr' | 'stdout', text: string): string {
		if (!dropping[stream]) {
			return text;
		}
		const boundary = text.search(TOKEN_BOUNDARY);
		if (boundary === -1) {
			return '';
		}
		dropping[stream] = false;
		return text.slice(boundary);
	}

	/**
	 * Adds decoded text to a stream's held-back text and emits complete lines,
	 * stopping short of any private-key block whose END is not on a complete
	 * line yet — an END still waiting for its newline does not close the block.
	 * @param stream - Which stream the text came from.
	 * @param text - Newly decoded text.
	 */
	function accept(stream: 'stderr' | 'stdout', text: string): void {
		const combined = pending[stream] + skipMaskedToken(stream, text);
		const completeEnd = combined.lastIndexOf('\n') + 1;
		const keyStart = openPrivateKeyLineStart(combined.slice(0, completeEnd));
		const holdStart =
			keyStart === -1 ? completeEnd : Math.min(completeEnd, keyStart);
		const held = combined.slice(holdStart);
		emit(combined.slice(0, holdStart));
		pending[stream] = boundHeld(
			stream,
			held,
			keyStart !== -1 || openPrivateKeyLineStart(held) !== -1,
		);
	}

	return {
		end: async () => {
			for (const stream of ['stdout', 'stderr'] as const) {
				accept(stream, decoders[stream].end());
				emit(maskOpenPrivateKey(pending[stream]));
				pending[stream] = '';
			}
			const stream = log?.stream;
			if (stream) {
				await new Promise<void>((resolve) => stream.end(resolve));
			}
		},
		logPath: log?.path ?? null,
		note: (text) => emit(text.endsWith('\n') ? text : `${text}\n`),
		tail: tail.read,
		write: (stream, chunk) => accept(stream, decoders[stream].write(chunk)),
	};
}
