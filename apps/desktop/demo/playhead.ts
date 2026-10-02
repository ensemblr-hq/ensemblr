import type { DemoScenario } from './scenario.ts';

/**
 * How far through a scenario's transcript the window is showing: a fixed event
 * count for a still, or `live` to replay the whole run on a timer so a streaming
 * turn can be filmed.
 */
export type Playhead = number | 'live';

/** Milliseconds between events when the playhead replays a transcript live. */
const LIVE_STEP_MS = 900;

/**
 * Reads the playhead out of a `?step=` query value.
 * @param raw - The query value, or null when absent.
 * @returns The parsed playhead; the whole transcript when the value is absent or unreadable.
 */
export function parsePlayhead(raw: string | null): Playhead {
	if (raw === 'live') {
		return 'live';
	}
	const parsed = Number.parseInt(raw ?? '', 10);
	return Number.isFinite(parsed) && parsed >= 0
		? parsed
		: Number.POSITIVE_INFINITY;
}

/**
 * Truncates a scenario's transcript to the playhead, so a still shows the
 * conversation exactly as far as it had got.
 *
 * A `live` playhead starts empty and is filled by {@link replayTranscript}
 * pushing events over the bridge, which is what drives the working indicator and
 * the streaming tool card.
 * @param scenario - Scenario being applied.
 * @param playhead - How much of the transcript to show.
 * @returns The scenario with its transcript cut to length.
 */
export function applyPlayhead(
	scenario: DemoScenario,
	playhead: Playhead,
): DemoScenario {
	const visibleCount = playhead === 'live' ? 0 : playhead;
	return {
		...scenario,
		chat: {
			...scenario.chat,
			transcript: scenario.chat.transcript.slice(0, visibleCount),
		},
	};
}

/**
 * Pushes a scenario's transcript at the renderer one event at a time, the way
 * the main process broadcasts a live turn.
 * @param scenario - Scenario whose transcript is replayed.
 * @param emit - Delivers one event over the bridge's broadcast channel.
 * @returns A function that stops the replay part-way.
 */
export function replayTranscript(
	scenario: DemoScenario,
	emit: (index: number) => void,
): () => void {
	let index = 0;
	const timer = window.setInterval(() => {
		if (index >= scenario.chat.transcript.length) {
			window.clearInterval(timer);
			return;
		}
		emit(index);
		index += 1;
	}, LIVE_STEP_MS);
	return () => window.clearInterval(timer);
}
