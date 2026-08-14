/**
 * Dictation IPC request schemas.
 *
 * **Strict:** handlers call `schema.parse(raw)`, so a malformed renderer payload
 * throws rather than reaching the transcription provider as a half-formed
 * multipart body.
 */
import { z } from 'zod';

import {
	MAX_DICTATION_AUDIO_BYTES,
	MAX_DICTATION_CLIP_MS,
} from '../../../shared/dictation-limits';

/** Slack over the recording cap tolerated in a reported clip duration, since the
 * renderer's stop timer fires on a best-effort schedule. */
const DURATION_TOLERANCE_FACTOR = 2;

/**
 * {@link import('../../../shared/ipc/contracts/dictation').TranscribeAudioRequest}.
 * The byte cap is the shared limit restated at the boundary so an oversized clip
 * is rejected before it is copied out of the IPC message, the MIME type is
 * length-capped because it becomes a multipart header value, and the duration is
 * bounded because it scales the request deadline.
 */
export const transcribeAudioRequestSchema = z.object({
	audio: z
		.instanceof(Uint8Array)
		.refine((value) => value.byteLength <= MAX_DICTATION_AUDIO_BYTES, {
			message: 'Recording exceeds the maximum transcription upload size.',
		}),
	durationMs: z
		.number()
		.int()
		.min(0)
		.max(MAX_DICTATION_CLIP_MS * DURATION_TOLERANCE_FACTOR),
	mimeType: z.string().min(1).max(128),
});

/**
 * {@link import('../../../shared/ipc/contracts/dictation').DictationKeyStatus}
 * write payload. Upper bound is far past any real provider key, which keeps a
 * hostile payload from being written wholesale into the Keychain.
 */
export const setDictationApiKeyRequestSchema = z.object({
	value: z.string().min(1).max(512),
});
