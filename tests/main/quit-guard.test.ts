import { describe, expect, test } from 'vitest';
import {
	createQuitGuard,
	type QuitConfirmRequest,
	type QuitGuardOptions,
} from '../../src/main/app/quit-guard';
import type { TerminalSessionSnapshot } from '../../src/shared/ipc/contracts/terminal';

/** A braille spinner frame — what a working harness leads its OSC title with. */
const SPINNER = '⠋';

function terminal(
	overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
	return {
		agentBusy: false,
		agentFullTitle: null,
		agentTitle: null,
		cols: 80,
		commandLabel: 'claude',
		createdAt: '2026-01-01T00:00:00.000Z',
		endedAt: null,
		exitCode: null,
		foregroundCommand: null,
		harnessSessionId: null,
		id: 't1',
		kind: 'agent',
		previewUrl: null,
		restored: false,
		rows: 24,
		scriptName: null,
		status: 'running',
		title: `${SPINNER} Fix login bug`,
		titleIsDefault: false,
		workspaceId: 'w1',
		...overrides,
	};
}

interface Harness {
	guard: ReturnType<typeof createQuitGuard>;
	requests: QuitConfirmRequest[];
}

function makeGuard(overrides: Partial<QuitGuardOptions> = {}): Harness {
	const requests: QuitConfirmRequest[] = [];
	const guard = createQuitGuard({
		confirm: (request) => {
			requests.push(request);
			return Promise.resolve(0);
		},
		getLanguage: () => 'en',
		hasWindow: () => true,
		listAgentTerminals: () => [],
		listRunningSessions: () => [],
		listWorkspaceNames: () =>
			Promise.resolve(
				new Map([
					['w1', 'api-refactor'],
					['w2', 'design-tokens'],
				]),
			),
		readChatTitle: () => null,
		...overrides,
	});
	return { guard, requests };
}

describe('createQuitGuard — when it prompts', () => {
	test('quits without prompting when nothing is running', async () => {
		const h = makeGuard();
		await expect(h.guard.confirmQuit()).resolves.toBe(true);
		expect(h.requests).toEqual([]);
	});

	test('prompts for a streaming chat session', async () => {
		const h = makeGuard({
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
		});
		await h.guard.confirmQuit();
		expect(h.requests).toHaveLength(1);
		expect(h.requests[0].detail).toContain('• api-refactor — Chat');
	});

	test('prompts for a harness spinning in its OSC title', async () => {
		const h = makeGuard({ listAgentTerminals: () => [terminal()] });
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain('• api-refactor — Fix login bug');
	});

	test('prompts for a spinner-less harness reporting agentBusy', async () => {
		const h = makeGuard({
			listAgentTerminals: () => [
				terminal({ agentBusy: true, title: 'Vibe', titleIsDefault: true }),
			],
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain('• api-refactor');
	});

	test('ignores a harness sitting idle', async () => {
		const h = makeGuard({
			listAgentTerminals: () => [terminal({ title: '✳ Claude Code' })],
		});
		await expect(h.guard.confirmQuit()).resolves.toBe(true);
		expect(h.requests).toEqual([]);
	});

	test('ignores a busy-looking harness whose process already exited', async () => {
		const h = makeGuard({
			listAgentTerminals: () => [terminal({ status: 'exited' })],
		});
		await expect(h.guard.confirmQuit()).resolves.toBe(true);
		expect(h.requests).toEqual([]);
	});

	test('quits without prompting when no window can host the dialog', async () => {
		const h = makeGuard({
			hasWindow: () => false,
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
		});
		await expect(h.guard.confirmQuit()).resolves.toBe(true);
		expect(h.requests).toEqual([]);
	});
});

describe('createQuitGuard — the verdict', () => {
	test('cancel keeps the app alive', async () => {
		const h = makeGuard({
			confirm: () => Promise.resolve(0),
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
		});
		await expect(h.guard.confirmQuit()).resolves.toBe(false);
	});

	test('quit anyway lets the quit through', async () => {
		const h = makeGuard({
			confirm: () => Promise.resolve(1),
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
		});
		await expect(h.guard.confirmQuit()).resolves.toBe(true);
	});

	test('cancel is both the default and the escape target', async () => {
		const h = makeGuard({
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
		});
		await h.guard.confirmQuit();
		const [request] = h.requests;
		expect(request.buttons).toEqual(['Cancel', 'Quit Anyway']);
		expect(request.defaultId).toBe(0);
		expect(request.cancelId).toBe(0);
	});
});

describe('createQuitGuard — the detail body', () => {
	test('lists both sources together, sorted stably', async () => {
		const h = makeGuard({
			listAgentTerminals: () => [terminal({ workspaceId: 'w2' })],
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toBe(
			[
				'Quitting now stops them mid-turn.',
				'',
				'• api-refactor — Chat',
				'• design-tokens — Fix login bug',
			].join('\n'),
		);
	});

	test('caps the list at six and counts the rest', async () => {
		const h = makeGuard({
			listRunningSessions: () =>
				Array.from({ length: 9 }, (_unused, index) => ({
					sessionId: `s${index}`,
					workspaceId: 'w1',
				})),
		});
		await h.guard.confirmQuit();
		const lines = h.requests[0].detail.split('\n');
		expect(lines.filter((line) => line.startsWith('•'))).toHaveLength(6);
		expect(lines.at(-1)).toBe('+3 more');
	});

	test('prefers the session-log title over the OSC title', async () => {
		const h = makeGuard({
			listAgentTerminals: () => [terminal({ agentTitle: 'Rename the port' })],
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain('• api-refactor — Rename the port');
	});

	test('names the workspace alone when the harness has no title yet', async () => {
		const h = makeGuard({
			listAgentTerminals: () => [
				terminal({ agentBusy: true, title: 'Terminal', titleIsDefault: true }),
			],
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail.split('\n').at(-1)).toBe('• api-refactor');
	});

	test('falls back to the workspace id when the name is unknown', async () => {
		const h = makeGuard({
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w9' }],
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain('• w9 — Chat');
	});

	test('still prompts when the workspace names cannot be read', async () => {
		const h = makeGuard({
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
			listWorkspaceNames: () => Promise.reject(new Error('database closed')),
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain('• w1 — Chat');
	});
});

describe('createQuitGuard — naming a running chat', () => {
	test("names the chat's own title rather than the generic word", async () => {
		const h = makeGuard({
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
			readChatTitle: () => 'Port the settings screen',
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain(
			'• api-refactor — Port the settings screen',
		);
	});

	test('falls back to the generic word for a chat nobody has named', async () => {
		const h = makeGuard({
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
			readChatTitle: () => '   ',
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain('• api-refactor — Chat');
	});

	test('still prompts when a chat title cannot be read', async () => {
		const h = makeGuard({
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
			readChatTitle: () => {
				throw new Error('database closed');
			},
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain('• api-refactor — Chat');
	});

	test('names each chat separately so duplicates are distinguishable', async () => {
		const titles = new Map([
			['s1', 'Rename the port'],
			['s2', 'Fix the flaky test'],
		]);
		const h = makeGuard({
			listRunningSessions: () => [
				{ sessionId: 's1', workspaceId: 'w1' },
				{ sessionId: 's2', workspaceId: 'w1' },
			],
			readChatTitle: (sessionId) => titles.get(sessionId) ?? null,
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail.split('\n').slice(2)).toEqual([
			'• api-refactor — Fix the flaky test',
			'• api-refactor — Rename the port',
		]);
	});

	test('falls back to the language in force, not to English', async () => {
		const h = makeGuard({
			getLanguage: () => 'ru',
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
			readChatTitle: () => null,
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail).toContain('• api-refactor — Чат');
	});
});

describe('createQuitGuard — ordering', () => {
	test('collates by locale, so case does not outrank the alphabet', async () => {
		const h = makeGuard({
			listRunningSessions: () => [
				{ sessionId: 's1', workspaceId: 'wb' },
				{ sessionId: 's2', workspaceId: 'wa' },
			],
			listWorkspaceNames: () =>
				Promise.resolve(
					new Map([
						['wa', 'api-refactor'],
						['wb', 'Design-tokens'],
					]),
				),
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail.split('\n').slice(2)).toEqual([
			'• api-refactor — Chat',
			'• Design-tokens — Chat',
		]);
	});

	test('interleaves chats and terminals by workspace rather than by source', async () => {
		const h = makeGuard({
			listAgentTerminals: () => [
				terminal({ agentTitle: 'Bump the lockfile', workspaceId: 'w1' }),
			],
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w2' }],
			readChatTitle: () => 'Write the migration',
		});
		await h.guard.confirmQuit();
		expect(h.requests[0].detail.split('\n').slice(2)).toEqual([
			'• api-refactor — Bump the lockfile',
			'• design-tokens — Write the migration',
		]);
	});
});

describe('createQuitGuard — localization', () => {
	test('renders in Russian', async () => {
		const h = makeGuard({
			getLanguage: () => 'ru',
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
		});
		await h.guard.confirmQuit();
		const [request] = h.requests;
		expect(request.message).toBe('Агенты ещё работают');
		expect(request.buttons).toEqual(['Отмена', 'Всё равно завершить']);
		expect(request.detail).toContain('• api-refactor — Чат');
	});

	test('renders in Greek', async () => {
		const h = makeGuard({
			getLanguage: () => 'el',
			listRunningSessions: () => [{ sessionId: 's1', workspaceId: 'w1' }],
		});
		await h.guard.confirmQuit();
		const [request] = h.requests;
		expect(request.message).toBe('Πράκτορες εκτελούνται ακόμη');
		expect(request.detail).toContain('• api-refactor — Συνομιλία');
	});
});
