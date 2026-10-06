import { describe, expect, it } from 'vitest';

import {
	lineLiteral,
	MINIMUM_VALUE_LENGTH,
	redactNamedSecrets,
} from '../../src/shared/redaction.ts';

describe('redactNamedSecrets', () => {
	it('replaces every exact occurrence with a placeholder naming its variable', () => {
		expect(
			redactNamedSecrets('key=s3cr3t-value and again s3cr3t-value', [
				{ name: 'API_KEY', value: 's3cr3t-value' },
			]),
		).toEqual({
			redacted: 2,
			text: 'key=[redacted:API_KEY] and again [redacted:API_KEY]',
		});
	});

	it('returns the input untouched with a zero count when nothing matches', () => {
		const text = 'nothing secret here';
		expect(
			redactNamedSecrets(text, [{ name: 'API_KEY', value: 'absent-value' }]),
		).toEqual({ redacted: 0, text });
	});

	it('names a secret that contains another after the longer one, leaving neither behind', () => {
		const result = redactNamedSecrets('token: outer-inner-value!', [
			{ name: 'INNER', value: 'inner' },
			{ name: 'OUTER', value: 'outer-inner-value' },
		]);
		expect(result).toEqual({ redacted: 1, text: 'token: [redacted:OUTER]!' });
	});

	it('merges overlapping secrets into one span so no byte of either survives', () => {
		const result = redactNamedSecrets('xx abcdef yy', [
			{ name: 'SHORT', value: 'abcd' },
			{ name: 'LONG', value: 'bcdef' },
		]);
		expect(result).toEqual({ redacted: 1, text: 'xx [redacted:LONG] yy' });
	});

	it('keeps adjacent secrets as separate spans', () => {
		expect(
			redactNamedSecrets('aaaa-1111bbbb-2222', [
				{ name: 'A', value: 'aaaa-1111' },
				{ name: 'B', value: 'bbbb-2222' },
			]),
		).toEqual({ redacted: 2, text: '[redacted:A][redacted:B]' });
	});

	it('never rescans a placeholder for a shorter secret', () => {
		expect(
			redactNamedSecrets('value-with-name', [
				{ name: 'NAME', value: 'value-with-name' },
				{ name: 'OTHER', value: 'NAME' },
			]),
		).toEqual({ redacted: 1, text: '[redacted:NAME]' });
	});

	it(`skips values shorter than ${MINIMUM_VALUE_LENGTH} characters`, () => {
		expect(
			redactNamedSecrets('abc abcd', [
				{ name: 'TINY', value: 'abc' },
				{ name: 'OK', value: 'abcd' },
			]),
		).toEqual({ redacted: 1, text: 'abc [redacted:OK]' });
	});

	it('keeps the first name given for a value two variables share', () => {
		expect(
			redactNamedSecrets('shared-value', [
				{ name: 'FIRST', value: 'shared-value' },
				{ name: 'SECOND', value: 'shared-value' },
			]).text,
		).toBe('[redacted:FIRST]');
	});

	it('redacts the distinctive lines of a multi-line secret on their own', () => {
		const key = [
			'-----BEGIN PRIVATE KEY-----',
			'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7',
			'short',
			'-----END PRIVATE KEY-----',
		].join('\n');
		const result = redactNamedSecrets(
			'log: MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7 short -----END PRIVATE KEY-----',
			[{ name: 'SIGNING_KEY', value: key }],
		);
		expect(result).toEqual({
			redacted: 1,
			text: 'log: [redacted:SIGNING_KEY] short -----END PRIVATE KEY-----',
		});
	});

	it('counts every replaced span', () => {
		expect(
			redactNamedSecrets('one-secret two-secret one-secret', [
				{ name: 'ONE', value: 'one-secret' },
				{ name: 'TWO', value: 'two-secret' },
			]).redacted,
		).toBe(3);
	});
});

describe('lineLiteral', () => {
	it('takes a JSON member value rather than the whole member', () => {
		expect(lineLiteral('  "private_key_id": "0123456789abcdef0123",')).toBe(
			'0123456789abcdef0123',
		);
	});

	it('drops armor lines, URLs, and lines too short to be distinctive', () => {
		expect(lineLiteral('-----BEGIN PRIVATE KEY-----')).toBeNull();
		expect(lineLiteral('https://example.com/a/long/path')).toBeNull();
		expect(lineLiteral('"type": "x",')).toBeNull();
	});
});
