import { afterEach, describe, expect, test, vi } from 'vitest';

import { preferredRecorderMimeType } from '../../src/renderer/lib/dictation/recorder-limits.ts';

/**
 * Stands in for `MediaRecorder`, supporting only the containers named.
 * @param supported - Container types this fake recorder accepts
 */
function installRecorder(supported: string[]) {
	vi.stubGlobal('MediaRecorder', {
		isTypeSupported: (mimeType: string) => supported.includes(mimeType),
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('preferredRecorderMimeType', () => {
	test('prefers Opus in WebM when the platform offers everything', () => {
		installRecorder(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']);

		expect(preferredRecorderMimeType()).toBe('audio/webm;codecs=opus');
	});

	test('falls back through WebM to MP4 as support narrows', () => {
		installRecorder(['audio/webm', 'audio/mp4']);
		expect(preferredRecorderMimeType()).toBe('audio/webm');

		installRecorder(['audio/mp4']);
		expect(preferredRecorderMimeType()).toBe('audio/mp4');
	});

	test('reports no container when none of the candidates work', () => {
		installRecorder(['audio/flac']);

		expect(preferredRecorderMimeType()).toBeNull();
	});

	test('reports no container in a build without MediaRecorder at all', () => {
		vi.stubGlobal('MediaRecorder', undefined);

		expect(preferredRecorderMimeType()).toBeNull();
	});
});
