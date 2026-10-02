import { describe, expect, test } from 'vitest';

import { endpointSafety } from '../../src/renderer/lib/dictation/endpoint-safety.ts';

describe('endpointSafety', () => {
	test('rates an https endpoint safe to carry the key', () => {
		expect(endpointSafety('https://api.openai.com/v1')).toBe('ok');
	});

	test('rates a local http endpoint safe, since nothing leaves the machine', () => {
		expect(endpointSafety('http://localhost:8080/v1')).toBe('ok');
		expect(endpointSafety('http://127.0.0.1:8080/v1')).toBe('ok');
	});

	test('flags plain http to a remote host, which sends the key in the clear', () => {
		expect(endpointSafety('http://transcribe.example.com/v1')).toBe('insecure');
	});

	test('rejects a value that is not a URL at all', () => {
		expect(endpointSafety('api.openai.com/v1')).toBe('invalid');
		expect(endpointSafety('')).toBe('invalid');
	});

	test('rejects a scheme the transcription request cannot use', () => {
		expect(endpointSafety('file:///etc/passwd')).toBe('invalid');
		expect(endpointSafety('ftp://example.com')).toBe('invalid');
	});

	test('ignores surrounding whitespace a paste leaves behind', () => {
		expect(endpointSafety('  https://api.openai.com/v1  ')).toBe('ok');
	});
});
