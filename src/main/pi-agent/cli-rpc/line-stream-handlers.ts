import type { JsonlLineStream } from '../../pi-ipc';
import { createJsonlLineStream } from '../../pi-ipc/jsonl-line-stream.ts';
import type { PiAgentErrorCode } from '../pi-agent-types.ts';

/**
 * Builds the JSONL stream used to parse Pi RPC stdout. Each non-empty line is
 * tapped (`onRawLine`) for the debug surface, then JSON-parsed and forwarded
 * to `onFrame`. Parse failures and oversize lines surface as recoverable
 * `adapter-failure` errors so the channel can keep running.
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
		code: PiAgentErrorCode,
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
			emitError(
				'adapter-failure',
				`Discarded oversize Pi RPC line (${droppedBytes} bytes > ${maxLineBytes} cap).`,
				firstBytes,
				true,
			);
		},
	});
}
