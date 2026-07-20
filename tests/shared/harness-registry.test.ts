import { describe, expect, test } from 'vitest';
import {
	findHarnessDefinition,
	harnessSessionLogSource,
	isSafeHarnessSessionId,
} from '../../src/shared/agents/harness-registry.ts';

describe('buildResumeCommand', () => {
	const cases = [
		{
			cwd: '--dangerously-skip-permissions --continue',
			exact: '--dangerously-skip-permissions --resume sess-1',
			id: 'claude',
		},
		{
			cwd: '--dangerously-bypass-approvals-and-sandbox resume --last',
			exact: '--dangerously-bypass-approvals-and-sandbox resume sess-1',
			id: 'codex',
		},
		{
			cwd: '--agent auto-approve --continue',
			exact: '--agent auto-approve --resume sess-1',
			id: 'vibe',
		},
	];

	for (const { cwd, exact, id } of cases) {
		test(`${id}: no session id reattaches the most recent cwd conversation`, () => {
			const harness = findHarnessDefinition(id);
			expect(harness?.buildResumeCommand?.('bin')).toBe(`bin ${cwd}`);
		});

		test(`${id}: a session id reattaches that exact conversation`, () => {
			const harness = findHarnessDefinition(id);
			expect(harness?.buildResumeCommand?.('bin', 'sess-1')).toBe(
				`bin ${exact}`,
			);
		});
	}
});

describe('harnessSessionLogSource', () => {
	test('maps each harness to its log source', () => {
		expect(harnessSessionLogSource('claude')).toBe('claude-transcript');
		expect(harnessSessionLogSource('codex')).toBe('codex-rollout');
		expect(harnessSessionLogSource('vibe')).toBe('vibe-log');
	});

	test('returns null for an unknown or absent harness', () => {
		expect(harnessSessionLogSource('unknown')).toBeNull();
		expect(harnessSessionLogSource(null)).toBeNull();
	});
});

describe('isSafeHarnessSessionId', () => {
	test('accepts uuids and slug-shaped ids', () => {
		expect(isSafeHarnessSessionId('3f2b1c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d')).toBe(
			true,
		);
		expect(isSafeHarnessSessionId('session_abc.123')).toBe(true);
	});

	test('rejects ids carrying shell metacharacters', () => {
		expect(isSafeHarnessSessionId('a; rm -rf /')).toBe(false);
		expect(isSafeHarnessSessionId('$(whoami)')).toBe(false);
		expect(isSafeHarnessSessionId('a b')).toBe(false);
		expect(isSafeHarnessSessionId('')).toBe(false);
	});
});
