import { describe, expect, it } from 'vitest';

import { isDistinctiveSecretValue } from '../../src/shared/redaction.ts';

describe('isDistinctiveSecretValue', () => {
	it.each([
		['production', ['NODE_ENV']],
		['debug', ['LOG_LEVEL']],
		['3000', ['PORT']],
		['us-east-1', ['AWS_REGION']],
		['db.example.com', ['DATABASE_HOST']],
		['my-bucket-2024', ['S3_BUCKET']],
		['https://api.example.com/v1', ['API_BASE_URL']],
		['/var/lib/app/data', ['DATA_DIR']],
		['~/projects/app', ['WORKDIR']],
		['../shared', ['SHARED_DIR']],
		['2024-01-01', ['RELEASE_DATE']],
		['abc1234', ['BUILD_ID']],
		['Kubernetes', []],
	])('leaves plain configuration %j under %j alone', (value, keys) => {
		expect(isDistinctiveSecretValue(value, keys)).toBe(false);
	});

	it.each([
		['hunter', ['API_TOKEN']],
		['swordfish', ['DB_PASSWORD']],
		['production', ['SESSION_SECRET', 'NODE_ENV']],
		['https://example.com', ['WEBHOOK_SECRET']],
		['postgres://app:pw@db/app', ['DATABASE_URL']],
		['https://ghp_token@github.com/org/repo', []],
		['xK9vQ2mL7pR4tY8w', ['SOME_ID']],
		['a very long sentence value', []],
		['abcdefghijklmnopqrst', ['VENDOR']],
		[
			'https://hooks.example.com/services/T000/B000/XXXXXXXXXXXXXXXX',
			['WEBHOOK_URL'],
		],
	])('redacts distinctive value %j under %j', (value, keys) => {
		expect(isDistinctiveSecretValue(value, keys)).toBe(true);
	});

	it('never redacts a value under six characters, even behind a secret-named key', () => {
		expect(isDistinctiveSecretValue('abc12', ['API_TOKEN'])).toBe(false);
	});

	it('leaves digits and punctuation alone even behind a secret-named key', () => {
		expect(isDistinctiveSecretValue('123456', ['OTP_SECRET'])).toBe(false);
		expect(isDistinctiveSecretValue('12.34.56', ['API_KEY'])).toBe(false);
	});
});
