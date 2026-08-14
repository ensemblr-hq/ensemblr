import { describe, expect, test } from 'vitest';

import {
	MAX_DICTATION_CLIP_MS,
	MAX_DICTATION_REQUEST_TIMEOUT_MS,
	MIN_DICTATION_REQUEST_TIMEOUT_MS,
	transcriptionTimeoutMs,
} from '../../src/shared/dictation-limits.ts';

describe('transcriptionTimeoutMs', () => {
	test('gives a short clip the floor rather than a few seconds', () => {
		expect(transcriptionTimeoutMs(2_000)).toBe(
			MIN_DICTATION_REQUEST_TIMEOUT_MS,
		);
	});

	test('scales past the floor once the clip is long enough to need it', () => {
		expect(transcriptionTimeoutMs(60_000)).toBe(150_000);
	});

	test('covers the longest clip the recorder will produce', () => {
		// The regression this guards: a fixed 60s deadline discarded a clip the
		// recorder was happy to make, with no retry and no audio left to resend.
		expect(transcriptionTimeoutMs(MAX_DICTATION_CLIP_MS)).toBeGreaterThan(
			MAX_DICTATION_CLIP_MS,
		);
	});

	test('never exceeds the ceiling, so a silent endpoint still lets go', () => {
		expect(transcriptionTimeoutMs(MAX_DICTATION_CLIP_MS * 10)).toBe(
			MAX_DICTATION_REQUEST_TIMEOUT_MS,
		);
	});

	test('treats a nonsensical duration as zero', () => {
		expect(transcriptionTimeoutMs(-1)).toBe(MIN_DICTATION_REQUEST_TIMEOUT_MS);
	});
});
