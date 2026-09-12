import type { AgentErrorCode } from '../../agent-runtime/agent-types.ts';
import type { JsonlLineStream } from '../../pi-ipc';
import { createJsonlLineStream } from '../../pi-ipc/jsonl-line-stream.ts';
import { recoverToolCompletion } from './discarded-frame.ts';

const OVERSIZE_DETAIL_CHARS = 128;

/**
 * Builds the JSONL stream used to parse Pi RPC stdout. Each non-empty line is
 * tapped (`onRawLine`) for the debug surface, then JSON-parsed and forwarded
 * to `onFrame`. Parse failures and oversize lines surface as recoverable
 * `adapter-failure` errors so the channel can keep running.
 *
 * A discarded line that was carrying a tool's result is additionally recovered
 * into a synthetic completion frame, so the call settles as failed instead of
 * running forever — see {@link recoverToolCompletion}.
 *
 * Pulled out of the adapter so the adapter file can stay focused on
 * orchestration rather than transport plumbing.
 */
export function createPiRpcLineStream({
	maxLineBytes,
	onRawLine,
	onFrame,
	emitError,
}: {
	maxLineBytes: number;
	onRawLine: (line: string) => void;
	onFrame: (frame: unknown) => void;
	emitError: (
		code: AgentErrorCode,
		message: string,
		detail?: string,
		recoverable?: boolean,
	) => void;
}): JsonlLineStream {
	return createJsonlLineStream({
		maxLineBytes,
		onLine: (line) => {
			if (line.length === 0) {
				return;
			}
			onRawLine(line);
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				emitError(
					'adapter-failure',
					'Invalid JSON line on Pi RPC stdout.',
					`bytes=${Buffer.byteLength(line, 'utf8')}, preview=${line.slice(0, 80)}`,
					true,
				);
				return;
			}
			onFrame(parsed);
		},
		onOversize: ({ droppedBytes, firstBytes }) => {
			const message = `Discarded oversize Pi RPC line (${droppedBytes} bytes > ${maxLineBytes} cap).`;
			emitError(
				'adapter-failure',
				message,
				firstBytes.slice(0, OVERSIZE_DETAIL_CHARS),
				true,
			);
			const recovered = recoverToolCompletion(firstBytes, message);
			if (recovered) {
				onFrame(recovered);
			}
		},
	});
}
