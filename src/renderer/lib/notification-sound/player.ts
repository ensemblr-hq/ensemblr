import chimeUrl from './chime.mp3';

/**
 * Shortest gap between two audible chimes. Several agents finishing within the
 * same moment is routine, and one chime reads as "something wants you" where
 * five read as a fault.
 *
 * It must stay above the clip's own length — `chime.mp3` runs 1.65s — because
 * replaying rewinds the shared element: a gap shorter than the clip would seek
 * a chime that is still sounding back to its start, which is heard as a stutter
 * rather than as two notifications. Raise this alongside any longer asset.
 */
const MIN_REPLAY_GAP_MS = 2_000;

let element: HTMLAudioElement | null = null;
let lastPlayedAt = Number.NEGATIVE_INFINITY;

/**
 * The single audio element every chime plays through, built on first use so the
 * asset is not fetched by a session that never notifies.
 * @returns The shared element.
 */
function getElement(): HTMLAudioElement {
	element ??= new Audio(chimeUrl);
	return element;
}

/**
 * Plays the notification chime, at most once per {@link MIN_REPLAY_GAP_MS}.
 *
 * Playback is best-effort: a renderer with no audio output, a decode failure, or
 * a browser autoplay refusal rejects the promise, which is reported rather than
 * thrown — a missing sound must not break the notification that carried it.
 */
export function playNotificationSound(): void {
	const now = Date.now();
	if (now - lastPlayedAt < MIN_REPLAY_GAP_MS) {
		return;
	}
	lastPlayedAt = now;
	try {
		const audio = getElement();
		audio.currentTime = 0;
		void audio.play().catch((cause: unknown) => {
			console.warn('[notifications] the notification chime could not play.', {
				cause: cause instanceof Error ? cause.message : String(cause),
			});
		});
	} catch (cause) {
		console.warn('[notifications] the notification chime is unavailable.', {
			cause: cause instanceof Error ? cause.message : String(cause),
		});
	}
}
