import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	readAgentConversationInfo,
	readAgentConversationTitle,
} from '../../src/main/terminal/agent-conversation-title.ts';

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
	sessionId = 'vibe-session-uuid',
): void {
	const dir = path.join(home, '.vibe', 'logs', 'session', name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, 'meta.json'),
		JSON.stringify({
			environment: { working_directory: workingDirectory },
			session_id: sessionId,
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

/**
 * Writes a Codex rollout carrying an explicit `session_meta.id`, used to check
 * that the reader surfaces the native session id.
 * @param name - Rollout filename.
 * @param id - The session id to record.
 * @param cwd - The cwd to record.
 * @param startedAt - The session start timestamp.
 */
function writeCodexRolloutWithId(
	name: string,
	id: string,
	cwd: string,
	startedAt: string,
): void {
	const dir = path.join(home, '.codex', 'sessions', '2026', '07', '20');
	mkdirSync(dir, { recursive: true });
	const lines = [
		JSON.stringify({
			payload: { cwd, id, timestamp: startedAt },
			type: 'session_meta',
		}),
		JSON.stringify({
			payload: { message: 'do the thing', type: 'user_message' },
			type: 'event_msg',
		}),
	];
	writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`);
}

/**
 * Writes a Claude transcript `.jsonl` named by its session id, whose first line
 * records the tab's cwd, session id, and timestamp.
 * @param sessionId - The session id (also the filename stem).
 * @param cwd - The cwd to record on the first line.
 * @param timestamp - The first-line timestamp gating the session.
 */
function writeClaudeTranscript(
	sessionId: string,
	cwd: string,
	timestamp: string,
): void {
	const slug = cwd.replace(/[/.]/g, '-');
	const dir = path.join(home, '.claude', 'projects', slug);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, `${sessionId}.jsonl`),
		`${JSON.stringify({ cwd, sessionId, timestamp, type: 'user' })}\n`,
	);
}

/**
 * Writes a realistic Claude transcript whose leading header lines carry the
 * `sessionId` but no `cwd`/`timestamp` (as Claude actually writes them), with the
 * gating `cwd`/`timestamp` only appearing on a later line.
 * @param sessionId - The session id (also the filename stem and on the header).
 * @param cwd - The cwd recorded on the later event line.
 * @param timestamp - The timestamp recorded on the later event line.
 */
function writeClaudeTranscriptWithHeader(
	sessionId: string,
	cwd: string,
	timestamp: string,
): void {
	const slug = cwd.replace(/[/.]/g, '-');
	const dir = path.join(home, '.claude', 'projects', slug);
	mkdirSync(dir, { recursive: true });
	const lines = [
		JSON.stringify({ leafUuid: 'x', sessionId, type: 'last-prompt' }),
		JSON.stringify({ mode: 'default', sessionId, type: 'mode' }),
		JSON.stringify({ cwd, sessionId, timestamp, type: 'user' }),
	];
	writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`);
}

describe('readAgentConversationInfo — session id', () => {
	test('codex surfaces the session id and title of the matching rollout', async () => {
		writeCodexRolloutWithId(
			'rollout-a.jsonl',
			'codex-uuid-1',
			CWD,
			AFTER_LAUNCH,
		);
		expect(
			await readAgentConversationInfo('codex-rollout', CWD, {
				home,
				since: LAUNCH,
			}),
		).toEqual({ sessionId: 'codex-uuid-1', title: 'do the thing' });
	});

	test('vibe surfaces the session id from meta.session_id, not the dir name', async () => {
		writeVibeSession(
			'session_20260720_141443_4e46ab20',
			CWD,
			AFTER_LAUNCH,
			'a vibe chat',
			'4e46ab20-336e-8b89-f959-31118746bf80',
		);
		expect(
			await readAgentConversationInfo('vibe-log', CWD, {
				home,
				since: LAUNCH,
			}),
		).toEqual({
			sessionId: '4e46ab20-336e-8b89-f959-31118746bf80',
			title: 'a vibe chat',
		});
	});

	test('claude surfaces the transcript session id and no title', async () => {
		writeClaudeTranscript('claude-abc', CWD, AFTER_LAUNCH);
		expect(
			await readAgentConversationInfo('claude-transcript', CWD, {
				home,
				since: LAUNCH,
			}),
		).toEqual({ sessionId: 'claude-abc', title: null });
	});

	test('claude ignores a transcript from before the tab launched', async () => {
		writeClaudeTranscript('claude-old', CWD, BEFORE_LAUNCH);
		expect(
			await readAgentConversationInfo('claude-transcript', CWD, {
				home,
				since: LAUNCH,
			}),
		).toEqual({ sessionId: null, title: null });
	});

	test('claude ignores a transcript recorded for a different cwd', async () => {
		writeClaudeTranscript('claude-other', '/other/dir', AFTER_LAUNCH);
		expect(
			await readAgentConversationInfo('claude-transcript', CWD, {
				home,
				since: LAUNCH,
			}),
		).toEqual({ sessionId: null, title: null });
	});

	test('claude reads the id past header lines that lack a timestamp', async () => {
		writeClaudeTranscriptWithHeader('claude-hdr', CWD, AFTER_LAUNCH);
		expect(
			await readAgentConversationInfo('claude-transcript', CWD, {
				home,
				since: LAUNCH,
			}),
		).toEqual({ sessionId: 'claude-hdr', title: null });
	});

	test('claude gates on the real timestamp, not the timestamp-less header', async () => {
		// The header's sessionId line has no timestamp; the gate must still exclude
		// this prior conversation via the later event line's before-launch time.
		writeClaudeTranscriptWithHeader('claude-prior', CWD, BEFORE_LAUNCH);
		expect(
			await readAgentConversationInfo('claude-transcript', CWD, {
				home,
				since: LAUNCH,
			}),
		).toEqual({ sessionId: null, title: null });
	});

	test('claude finds a dotted-cwd transcript under the dot-keeping slug', async () => {
		// Current Claude keeps dots in the project slug (only `/` becomes `-`), so a
		// cwd with a dotted segment lives at `<…>-.claude-worktrees-…`. The reader
		// must probe that encoding, not only the legacy dots-as-dashes one.
		const dottedCwd = '/Users/dev/project/.claude-worktrees/agent-a1';
		const slug = dottedCwd.replace(/\//g, '-');
		const dir = path.join(home, '.claude', 'projects', slug);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			path.join(dir, 'claude-dot.jsonl'),
			`${JSON.stringify({ cwd: dottedCwd, sessionId: 'claude-dot', timestamp: AFTER_LAUNCH, type: 'user' })}\n`,
		);
		expect(
			await readAgentConversationInfo('claude-transcript', dottedCwd, {
				home,
				since: LAUNCH,
			}),
		).toEqual({ sessionId: 'claude-dot', title: null });
	});
});
