import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createSessionSummaryWriter } from '../../src/main/pi-agent/session-summary-writer.ts';
import type { PiSessionEventWire } from '../../src/shared/ipc/contracts/pi-session.ts';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

function makeWorkspaceDir(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-summary-'));
	cleanups.push(() => rmSync(directory, { force: true, recursive: true }));
	return directory;
}

function makeUserEvent(text: string, turnId = 't-1'): PiSessionEventWire {
	return {
		branchId: 'b-1',
		createdAt: '2026-01-01T00:00:00.000Z',
		eventType: 'message',
		id: `evt-user-${turnId}`,
		ordinal: 0,
		payload: {
			kind: 'message',
			payload: { kind: 'prompt', prompt: text },
			role: 'user',
		},
		stream: 'protocol',
		turnId,
	};
}

function makeAgentEvent(text: string, turnId = 't-1'): PiSessionEventWire {
	return {
		branchId: 'b-1',
		createdAt: '2026-01-01T00:00:01.000Z',
		eventType: 'message',
		id: `evt-agent-${turnId}`,
		ordinal: 1,
		payload: {
			kind: 'message',
			payload: {
				kind: 'message',
				parts: [{ kind: 'text', text }],
				role: 'assistant',
			},
			role: 'agent',
		},
		stream: 'protocol',
		turnId,
	};
}

const CONVERSATION = [
	makeUserEvent('Fix the login redirect bug'),
	makeAgentEvent('Patched the guard in auth.ts.'),
];

function baseInput(workspaceCwd: string) {
	return {
		branchId: 'b-1',
		chatTabId: 'tab-1',
		closedAt: '2026-01-01T00:00:00.000Z',
		events: CONVERSATION,
		piSessionId: 'native-1',
		workspaceCwd,
	};
}

describe('writeSessionSummary', () => {
	test('writes a stub when the tab never opened a session', async () => {
		const workspaceCwd = makeWorkspaceDir();

		const result = await createSessionSummaryWriter().writeSessionSummary({
			branchId: null,
			chatTabId: 'tab-empty',
			closedAt: '2026-01-01T00:00:00.000Z',
			events: [],
			piSessionId: null,
			workspaceCwd,
		});

		expect(result.source).toBe('transcript');
		expect(result.title).toBeNull();
		expect(readFileSync(result.path, 'utf8')).toContain('_Empty tab');
	});

	test('falls back to the transcript when the agent recorded nothing', async () => {
		const workspaceCwd = makeWorkspaceDir();

		const result = await createSessionSummaryWriter().writeSessionSummary(
			baseInput(workspaceCwd),
		);

		const contents = readFileSync(result.path, 'utf8');
		expect(result.source).toBe('transcript');
		expect(result.title).toBe('Fix the login redirect bug');
		expect(contents).toContain('[user]: Fix the login redirect bug');
		expect(contents).toContain('[agent]: Patched the guard in auth.ts.');
		expect(contents).toContain('source: "transcript"');
	});

	test("renders the agent's own summary when it recorded one", async () => {
		const workspaceCwd = makeWorkspaceDir();

		const result = await createSessionSummaryWriter().writeSessionSummary({
			...baseInput(workspaceCwd),
			agentSummary: {
				body: '- Fixed the redirect guard\n- Tests still to write',
				title: 'Login redirect fix',
			},
		});

		const contents = readFileSync(result.path, 'utf8');
		expect(result.source).toBe('agent');
		expect(result.title).toBe('Login redirect fix');
		expect(contents).toContain('# Login redirect fix');
		expect(contents).toContain('- Fixed the redirect guard');
		expect(contents).toContain('source: "agent"');
		// The transcript is superseded, not appended.
		expect(contents).not.toContain('[user]:');
	});

	test('writes the file exactly once', async () => {
		const workspaceCwd = makeWorkspaceDir();
		const writeFile = vi.fn().mockResolvedValue(undefined);

		await createSessionSummaryWriter({
			mkdir: vi.fn().mockResolvedValue(undefined),
			writeFile,
		}).writeSessionSummary({
			...baseInput(workspaceCwd),
			agentSummary: { body: 'Body.', title: 'Topic' },
		});

		expect(writeFile).toHaveBeenCalledTimes(1);
	});

	test('records the conversation counts and purpose in the frontmatter', async () => {
		const workspaceCwd = makeWorkspaceDir();

		const result = await createSessionSummaryWriter().writeSessionSummary({
			...baseInput(workspaceCwd),
			purpose: 'fork',
		});

		const contents = readFileSync(result.path, 'utf8');
		expect(contents).toContain('chatTabId: "tab-1"');
		expect(contents).toContain('branchId: "b-1"');
		expect(contents).toContain('messageCount: 2');
		expect(contents).toContain('turnCount: 1');
		expect(contents).toContain('purpose: "fork"');
	});

	test('keeps a caller-supplied stem inside the sessions directory', async () => {
		const workspaceCwd = makeWorkspaceDir();

		const result = await createSessionSummaryWriter().writeSessionSummary({
			...baseInput(workspaceCwd),
			fileBaseName: '../../escape',
		});

		expect(result.path).toBe(
			path.join(workspaceCwd, '.context', 'sessions', 'escape.md'),
		);
	});
});
