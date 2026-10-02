/**
 * Container types to record in, best first. Opus in WebM is what Chromium
 * produces natively and what the transcription endpoint accepts; MP4 is the
 * fallback for a build whose recorder lacks the WebM muxer.
 */
const CANDIDATE_MIME_TYPES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/mp4',
];

/**
 * Picks the first container the platform's `MediaRecorder` supports.
 * @returns The MIME type to record in, or null when none of the candidates work
 */
export function preferredRecorderMimeType(): string | null {
	if (typeof MediaRecorder === 'undefined') {
		return null;
	}

	return (
		CANDIDATE_MIME_TYPES.find((mimeType) =>
			MediaRecorder.isTypeSupported(mimeType),
		) ?? null
	);
}
