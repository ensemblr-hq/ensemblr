import { describe, expect, it, vi } from 'vitest';
import { createLazySanitizedLogs } from '@/main/commands/command-redaction.ts';
import {
	ASSIGNMENT_KEY_SOURCES,
	collectRedactableValues,
	createTextRedactor,
	isRedactableKeyName,
	maskHomeDirectories,
	REDACTED,
	REDACTION_KEY_PARTS,
	redactSecretAssignments,
	redactSecretShapes,
	SECRET_VALUE_PATTERNS,
} from '@/shared/redaction.ts';

/**
 * The value-shape corpus. Every entry in `SECRET_VALUE_PATTERNS` needs at least
 * one row here, and a row proves the shape is redacted wherever it appears —
 * not just behind a key the scanner already recognised.
 */
const VALUE_SHAPE_CORPUS: readonly { id: string; sample: string }[] = [
	{
		id: 'pem-private-key',
		sample:
			'-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
	},
	{ id: 'github-token', sample: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
	{ id: 'github-token', sample: 'github_pat_11ABCDEFG0abcdefghijklmnop' },
	{ id: 'openai-style-key', sample: 'sk-proj-abcdefghijklmnopqrstuvwxyz' },
	{ id: 'openai-style-key', sample: 'sk-ant-api03-abcdefghijklmnopqrstuv' },
	{ id: 'slack-token', sample: 'xoxb-1234567890-abcdefghijkl' },
	{ id: 'aws-access-key-id', sample: 'AKIAIOSFODNN7EXAMPLE' },
	{ id: 'aws-access-key-id', sample: 'ASIAIOSFODNN7EXAMPLE' },
	{
		id: 'google-api-key',
		sample: 'AIzaSyA0123456789abcdefghijklmnopqrstuv',
	},
	{
		id: 'jwt',
		sample:
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K',
	},
	{
		id: 'url-userinfo',
		sample: 'postgres://appuser:hunter2swordfish@db.internal:5432/app',
	},
	{
		id: 'hex-token',
		sample: 'a3f1c09d4b7e2a6f8c1d0e9b5a4738126f0a9d3c',
	},
];

/**
 * Text that must survive every pass untouched. Over-redaction is cheap but not
 * free: these are the diagnostics a support bundle exists to carry.
 */
const PRESERVED_CORPUS: readonly string[] = [
	'npm error code ENOENT',
	'KEYBOARD_LAYOUT=us',
	'branch master is up to date',
	'exit status 128',
	'https://github.com/ensemblr-hq/ensemblr.git',
];

describe('secret value shapes', () => {
	it.each(VALUE_SHAPE_CORPUS)('redacts $id: $sample', ({ sample }) => {
		expect(redactSecretShapes(`prefix ${sample} suffix`)).not.toContain(sample);
	});

	it('covers every declared pattern with at least one corpus sample', () => {
		const sampled = new Set(VALUE_SHAPE_CORPUS.map((entry) => entry.id));
		const uncovered = SECRET_VALUE_PATTERNS.filter(
			(entry) => !sampled.has(entry.id),
		).map((entry) => entry.id);

		expect(uncovered).toEqual([]);
	});

	it('keeps the host and scheme when it redacts URL userinfo', () => {
		expect(
			redactSecretShapes('postgres://appuser:hunter2swordfish@db.internal/app'),
		).toBe(`postgres://appuser:${REDACTED}@db.internal/app`);
	});

	it.each(PRESERVED_CORPUS)('leaves %s alone', (sample) => {
		expect(createTextRedactor()(sample)).toBe(sample);
	});
});

describe('secret-named assignments', () => {
	it.each([
		'API_TOKEN=abcd1234',
		'PASSWORD: swordfish',
		'OPENAI_KEY=sk-live-value',
		'SIGNING_KEY=abcd1234',
		'PASSPHRASE=correct-horse',
		'SESSION_ID=abcd1234',
		'DATABASE_DSN=postgres-value',
		'Authorization: Bearer abcd1234',
		'my_app_api_key="abcd1234"',
	])('redacts the value in %s', (sample) => {
		const redacted = redactSecretAssignments(sample);

		expect(redacted).toContain(REDACTED);
		expect(redacted.split(/[=:]/)[0]).toBe(sample.split(/[=:]/)[0]);
	});

	it('matches every redaction key part with an assignment source', () => {
		const sources = new RegExp(
			`^(?:${ASSIGNMENT_KEY_SOURCES.join('|')})$`,
			'i',
		);
		const uncovered = REDACTION_KEY_PARTS.filter(
			(part) => !sources.test(part) && !sources.test(part.toUpperCase()),
		);

		expect(uncovered).toEqual([]);
	});
});

describe('isRedactableKeyName', () => {
	it.each([
		'API_TOKEN',
		'OPENAI_KEY',
		'SIGNING_KEY',
		'PASSPHRASE',
		'SESSION_ID',
		'DATABASE_DSN',
		'apiKey',
		'privateKey',
		'GH_PAT',
	])('classifies %s as redactable', (key) => {
		expect(isRedactableKeyName(key)).toBe(true);
	});

	it.each(['PATH', 'HOME', 'KEYBOARD_LAYOUT', 'NODE_ENV', 'LANG'])(
		'leaves %s alone',
		(key) => {
			expect(isRedactableKeyName(key)).toBe(false);
		},
	);
});

describe('createTextRedactor', () => {
	it('replaces a known literal value wherever it appears', () => {
		const redactor = createTextRedactor(['hunter2swordfish']);

		expect(
			redactor('the value is hunter2swordfish, twice hunter2swordfish'),
		).toBe(`the value is ${REDACTED}, twice ${REDACTED}`);
	});

	it('ignores a literal below the length floor', () => {
		expect(createTextRedactor(['ab'])('ab cd')).toBe('ab cd');
	});
});

describe('collectRedactableValues', () => {
	it('collects the value behind a key the classifier misses but redaction catches', () => {
		expect(
			collectRedactableValues({
				OPENAI_KEY: 'sk-live-abcdefghijklmnop',
				PATH: '/usr/bin',
			}),
		).toEqual(['sk-live-abcdefghijklmnop']);
	});

	it('keeps caller-supplied values', () => {
		expect(collectRedactableValues({}, ['from-the-vault'])).toEqual([
			'from-the-vault',
		]);
	});
});

describe('maskHomeDirectories', () => {
	it.each([
		['/Users/philipp/code/app', '~/code/app'],
		['/home/philipp/code/app', '~/code/app'],
		['/root/code/app', '~/code/app'],
	])('collapses %s', (input, expected) => {
		expect(maskHomeDirectories(input)).toBe(expected);
	});
});

describe('createLazySanitizedLogs', () => {
	const input = {
		args: ['status'],
		command: 'git',
		cwd: '/repo',
		env: { API_TOKEN: 'abcd1234', PATH: '/usr/bin' },
		stderr: '',
		stdout: 'token abcd1234 seen',
	};

	it('does not redact until a field is read', () => {
		const redactSpy = vi.spyOn(String.prototype, 'replace');
		const logs = createLazySanitizedLogs(input);
		const callsBeforeRead = redactSpy.mock.calls.length;
		const stdout = logs.stdout;

		expect(redactSpy.mock.calls.length).toBeGreaterThan(callsBeforeRead);
		expect(stdout).not.toContain('abcd1234');
		redactSpy.mockRestore();
	});

	it('sanitizes once and reuses the result across fields', () => {
		const logs = createLazySanitizedLogs(input);

		expect(logs.env).toBe(logs.env);
		expect(logs.env.API_TOKEN).toBe(REDACTED);
		expect(logs.command).toBe('git status');
	});
});
