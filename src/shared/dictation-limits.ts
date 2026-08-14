/**
 * Limits both ends of composer dictation have to agree on. The renderer stops
 * recording at these bounds and the main process re-checks them at the IPC
 * boundary, so they live here rather than as two constants that can drift.
 */

/**
 * Longest single clip the composer records, in milliseconds. A dictation left
 * running by accident stops itself rather than accumulating an upload the
 * provider will reject and the user will be billed for.
 */
export const MAX_DICTATION_CLIP_MS = 5 * 60 * 1000;

/**
 * Largest clip that may be uploaded, in bytes. OpenAI documents a 25 MB
 * per-upload limit; stopping short of it means an over-long recording fails as
 * our own coded error rather than as a provider 400. Opus at speech bitrates
 * puts {@link MAX_DICTATION_CLIP_MS} far below this — the cap exists for
 * pathological codecs, not for normal use.
 */
export const MAX_DICTATION_AUDIO_BYTES = 20 * 1024 * 1024;

/**
 * Floor on a transcription request's deadline. A hosted endpoint answers a short
 * clip in seconds; this keeps a brief recording from timing out on one slow
 * round trip.
 */
export const MIN_DICTATION_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Ceiling on a transcription request's deadline, so an endpoint that accepts the
 * upload and then never answers still releases the composer's mic control.
 */
export const MAX_DICTATION_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** Multiple of a clip's own duration allowed for transcribing it. */
const TIMEOUT_DURATION_FACTOR = 2;

/** Fixed allowance for upload and queueing on top of the duration-scaled budget. */
const TIMEOUT_OVERHEAD_MS = 30_000;

/**
 * Scales a transcription request's deadline to the clip it carries. A fixed
 * deadline cannot serve both targets the settings screen advertises: a hosted
 * API returns a five-minute clip in seconds, while a CPU-bound local
 * `whisper-server` can need longer than the recording itself, and a clip that
 * outruns the deadline is discarded with no retry.
 * @param clipDurationMs - How long the clip runs, as the recorder measured it
 * @returns The deadline to give this request, within the fixed bounds
 */
export function transcriptionTimeoutMs(clipDurationMs: number): number {
	const scaled =
		Math.max(0, clipDurationMs) * TIMEOUT_DURATION_FACTOR + TIMEOUT_OVERHEAD_MS;

	return Math.min(
		MAX_DICTATION_REQUEST_TIMEOUT_MS,
		Math.max(MIN_DICTATION_REQUEST_TIMEOUT_MS, scaled),
	);
}
