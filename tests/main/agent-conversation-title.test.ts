import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readAgentConversationTitle } from '../../src/main/terminal/agent-conversation-title.ts';

const CWD = '/Users/dev/workspaces/example/satie';
const LAUNCH = '2026-07-20T10:00:00.000Z';
const BEFORE_LAUNCH = '2026-07-20T09:00:00.000Z';
const AFTER_LAUNCH = '2026-07-20T10:00:05.000Z';

let home: string;

beforeEach(() => {
	home = mkdtempSync(path.join(tmpdir(), 'ensemblr-title-'));
});

afterEach(() => {
	rmSync(home, { force: true, recursive: true });
});

/**
 * Writes a Codex rollout `.jsonl` under the fake home, with a leading
 * `session_meta` line carrying `cwd` and a start timestamp, and an
 * `event_msg`/`user_message` line.
 * @param name - Rollout filename (its timestamp orders recency).
 * @param cwd - The cwd to record in `session_meta`.
 * @param startedAt - The session start timestamp recorded in `session_meta`.
 * @param firstMessage - The first user message, or null to omit it.
 */
function writeCodexRollout(
	name: string,
	cwd: string,
	startedAt: string,
	firstMessage: string | null,
): void {
	const dir = path.join(home, '.codex', 'sessions', '2026', '07', '20');
	mkdirSync(dir, { recursive: true });
	const lines = [
		JSON.stringify({
			payload: { cwd, timestamp: startedAt },
			type: 'session_meta',
		}),
		JSON.stringify({ payload: { type: 'task_started' }, type: 'event_msg' }),
	];
	if (firstMessage !== null) {
		lines.push(
			JSON.stringify({
				payload: { message: firstMessage, type: 'user_message' },
				type: 'event_msg',
			}),
		);
	}
	writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`);
}

/**
 * Writes a Vibe session `meta.json` under the fake home.
 * @param name - Session directory name (its timestamp orders recency).
 * @param workingDirectory - The `environment.working_directory` to record.
 * @param startedAt - The session `start_time`.
 * @param title - The persisted conversation title.
 */
function writeVibeSession(
	name: string,
	workingDirectory: string,
	startedAt: string,
	title: string,
): void {
	const dir = path.join(home, '.vibe', 'logs', 'session', name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, 'meta.json'),
		JSON.stringify({
			environment: { working_directory: workingDirectory },
			start_time: startedAt,
			title,
		}),
	);
}

describe('readAgentConversationTitle — codex-rollout', () => {
	test('returns the first user message of the matching session', async () => {
		writeCodexRollout('rollout-a.jsonl', CWD, AFTER_LAUNCH, 'fix the bug');
		expect(
			await readAgentConversationTitle('codex-rollout', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBe('fix the bug');
	});

	test('ignores a session that started before the tab launched', async () => {
		writeCodexRollout('rollout-a.jsonl', CWD, BEFORE_LAUNCH, 'previous chat');
		expect(
			await readAgentConversationTitle('codex-rollout', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBeNull();
	});

	test('prefers the newest rollout for the cwd', async () => {
		writeCodexRollout('rollout-a.jsonl', CWD, AFTER_LAUNCH, 'older prompt');
		writeCodexRollout('rollout-b.jsonl', CWD, AFTER_LAUNCH, 'newer prompt');
		expect(
			await readAgentConversationTitle('codex-rollout', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBe('newer prompt');
	});

	test('ignores sessions from a different cwd', async () => {
		writeCodexRollout(
			'rollout-a.jsonl',
			'/other/dir',
			AFTER_LAUNCH,
			'not mine',
		);
		expect(
			await readAgentConversationTitle('codex-rollout', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBeNull();
	});

	test('truncates a long prompt to a single capped line', async () => {
		const long = `${'x'.repeat(200)}\nsecond line`;
		writeCodexRollout('rollout-a.jsonl', CWD, AFTER_LAUNCH, long);
		const title = await readAgentConversationTitle('codex-rollout', CWD, {
			home,
			since: LAUNCH,
		});
		expect(title).not.toBeNull();
		expect(title?.length).toBeLessThanOrEqual(80);
		expect(title?.endsWith('…')).toBe(true);
	});

	test('returns null when the sessions directory is absent', async () => {
		expect(
			await readAgentConversationTitle('codex-rollout', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBeNull();
	});
});

describe('readAgentConversationTitle — vibe-log', () => {
	test('returns the persisted title of the matching session', async () => {
		writeVibeSession('session_a', CWD, AFTER_LAUNCH, "how's it going");
		expect(
			await readAgentConversationTitle('vibe-log', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBe("how's it going");
	});

	test('ignores a session that started before the tab launched', async () => {
		writeVibeSession('session_a', CWD, BEFORE_LAUNCH, 'previous');
		expect(
			await readAgentConversationTitle('vibe-log', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBeNull();
	});

	test('prefers the newest session for the cwd', async () => {
		writeVibeSession('session_a', CWD, AFTER_LAUNCH, 'older');
		writeVibeSession('session_b', CWD, AFTER_LAUNCH, 'newer');
		expect(
			await readAgentConversationTitle('vibe-log', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBe('newer');
	});

	test('ignores sessions from a different working directory', async () => {
		writeVibeSession('session_a', '/other/dir', AFTER_LAUNCH, 'not mine');
		expect(
			await readAgentConversationTitle('vibe-log', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBeNull();
	});

	test('returns null when the session log root is absent', async () => {
		expect(
			await readAgentConversationTitle('vibe-log', CWD, {
				home,
				since: LAUNCH,
			}),
		).toBeNull();
	});
});
