import { describe, expect, test } from 'vitest';

import {
	detectPreviewUrl,
	extractPreviewPort,
} from '../../src/shared/terminal/detect-preview-url';

/** ANSI escape byte (0x1b), built at runtime to avoid a literal control char. */
const ESC = String.fromCharCode(0x1b);

describe('detectPreviewUrl', () => {
	test('detects the Vite Local banner URL', () => {
		expect(detectPreviewUrl('  ->  Local:   http://localhost:5173/')).toBe(
			'http://localhost:5173/',
		);
	});

	test('detects 127.0.0.1 and 0.0.0.0 hosts with a port', () => {
		expect(detectPreviewUrl('listening on http://127.0.0.1:3000')).toBe(
			'http://127.0.0.1:3000',
		);
		expect(detectPreviewUrl('bound to http://0.0.0.0:8080/app')).toBe(
			'http://0.0.0.0:8080/app',
		);
	});

	test('strips trailing ANSI reset sequences from a colored URL', () => {
		const colored = `${ESC}[36mhttp://localhost:4321/${ESC}[39m`;
		expect(detectPreviewUrl(colored)).toBe('http://localhost:4321/');
	});

	test('detects a Vite URL whose port is bolded with an inline ANSI escape', () => {
		// Vite colors the URL and bolds the port, so an escape lands between the
		// colon and the digits: http://localhost:<bold>5173<reset>/.
		const boldedPort = `  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mLocal${ESC}[22m:   ${ESC}[36mhttp://localhost:${ESC}[1m5173${ESC}[22m/${ESC}[39m`;
		expect(detectPreviewUrl(boldedPort)).toBe('http://localhost:5173/');
	});

	test('ignores remote URLs and loopback URLs without a port', () => {
		expect(detectPreviewUrl('deployed to https://example.com')).toBeNull();
		expect(detectPreviewUrl('open http://localhost/')).toBeNull();
		expect(detectPreviewUrl('no url here at all')).toBeNull();
	});
});

describe('extractPreviewPort', () => {
	test('reads the port from a detected URL', () => {
		expect(extractPreviewPort('http://localhost:5173/')).toBe(5173);
		expect(extractPreviewPort('http://127.0.0.1:3000')).toBe(3000);
	});

	test('returns null when no valid port is present', () => {
		expect(extractPreviewPort('http://localhost/')).toBeNull();
		expect(extractPreviewPort('http://localhost:99999/')).toBeNull();
	});
});
