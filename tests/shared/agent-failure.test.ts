/**
 * The classifier is the whole taxonomy's load-bearing part: every provider
 * failure crosses the wire under one catch-all code, so if the prose is read
 * wrong the user gets the wrong headline and the wrong recovery button.
 *
 * The strings here are real shapes runtimes emit, not paraphrases — the first
 * is the verbatim line from THE-198.
 */

import { describe, expect, test } from 'vitest';

import {
	AGENT_FAILURE_CLASSES,
	classifyAgentFailure,
} from '../../src/shared/agent-failure';

describe('classifyAgentFailure', () => {
	test('reads the observed mid-response truncation as truncated, not overloaded', () => {
		expect(
			classifyAgentFailure({
				code: 'adapter-failure',
				message:
					'API Error: Server error mid-response. The response above may be incomplete.',
			}),
		).toBe('provider-truncated');
	});

	test.each([
		['Overloaded: upstream service unavailable.', 'provider-overloaded'],
		['503 Service Unavailable', 'provider-overloaded'],
		['429 Too Many Requests', 'rate-limit'],
		['You have exceeded your monthly quota.', 'rate-limit'],
		['401 Unauthorized: invalid API key', 'credentials'],
		['Not logged in. Please run /login.', 'credentials'],
		['prompt is too long: 210331 tokens > 200000 maximum', 'context-overflow'],
		['fetch failed', 'network'],
		['connect ECONNREFUSED 127.0.0.1:443', 'network'],
		['command not found: pi', 'runtime-missing'],
		['Pi RPC process exited with code 139.', 'runtime-crashed'],
		['Plan Mode denies mutating tools.', 'tool-denied'],
		['The session is closed.', 'session-closed'],
	])('classifies %j as %s', (message, expected) => {
		expect(classifyAgentFailure({ code: 'adapter-failure', message })).toBe(
			expected,
		);
	});

	test('reads the detail when the message alone says nothing useful', () => {
		expect(
			classifyAgentFailure({
				code: 'spawn-error',
				detail: 'spawn pi ENOENT',
				message: 'Failed to spawn the Pi RPC process.',
			}),
		).toBe('runtime-missing');
	});

	// An exit code in the 500s must not be read as a gateway error, which is why
	// the crash probes sit above the HTTP-status ones.
	test('does not mistake an exit code for an HTTP status', () => {
		expect(
			classifyAgentFailure({
				code: 'adapter-failure',
				message: 'Pi RPC process exited with code 502.',
			}),
		).toBe('runtime-crashed');
	});

	test.each([
		['invalid-cwd', 'workspace-invalid'],
		['invalid-executable', 'runtime-missing'],
		['session-closed', 'session-closed'],
		['submit-failed', 'session-closed'],
	])(
		'falls back to the %s code when the prose says nothing',
		(code, expected) => {
			expect(
				classifyAgentFailure({ code, message: 'Something went wrong.' }),
			).toBe(expected);
		},
	);

	test('lands an unrecognized failure in a real class rather than nothing', () => {
		expect(
			classifyAgentFailure({
				code: 'adapter-failure',
				message: 'The turn ended without producing an answer.',
			}),
		).toBe('unknown');
	});

	test('every class it can return is enumerated by the catalogue', () => {
		const classes = new Set(AGENT_FAILURE_CLASSES);
		expect(classes.size).toBe(AGENT_FAILURE_CLASSES.length);
		expect(classes.has(classifyAgentFailure({ message: 'anything' }))).toBe(
			true,
		);
	});
});
