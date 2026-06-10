/**
 * Replays captured Pi RPC fixture lines through the timeline reducer —
 * shared by the snapshot tests and the dev replay view so both render
 * exactly what the reducer produces.
 */

import type {
	PiTimelineInput,
	PiTimelineState,
} from '@/renderer/types/pi-timeline';
import type { PiCapturedLine } from '@/shared/pi-rpc';
import { parsePiRpcLine } from '@/shared/pi-rpc';

import { createPiTimelineState, reducePiTimeline } from './reducer.ts';

/**
 * Converts captured fixture lines into reducer inputs, skipping stderr and
 * unknown frames (unknowns are no-ops by contract).
 *
 * @param lines - Captured lines in original order.
 * @returns Timestamped reducer inputs.
 */
export function capturedLinesToInputs(
	lines: readonly PiCapturedLine[],
): readonly PiTimelineInput[] {
	const inputs: PiTimelineInput[] = [];
	for (const line of lines) {
		if (line.stream !== 'stdout') {
			continue;
		}
		const parsed = parsePiRpcLine(line.raw);
		if (parsed.ok) {
			inputs.push({ atMs: line.ts, event: parsed.event });
		}
	}
	return inputs;
}

/**
 * Replays a full capture through the reducer.
 *
 * @param lines - Captured lines in original order.
 * @returns The final timeline state.
 */
export function replayPiTimeline(
	lines: readonly PiCapturedLine[],
): PiTimelineState {
	return capturedLinesToInputs(lines).reduce(
		reducePiTimeline,
		createPiTimelineState(),
	);
}
