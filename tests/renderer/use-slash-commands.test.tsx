// @vitest-environment happy-dom

/**
 * The slash menu belongs to whichever runtime would handle the submit. Serving a
 * Claude Code chat pi's commands is the bug this covers.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr';
import {
	hasCachedSlashCommands,
	resetSlashCommandsCacheMirror,
	writeCachedSlashCommands,
} from '../../src/renderer/api/ensemblr/slash-commands-cache';
import { useSlashCommands } from '../../src/renderer/hooks/workbench-shell/composer/use-slash-commands';
import type { ListAgentProviderSlashCommandsResult } from '../../src/shared/ipc/contracts/agent-provider';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const CLAUDE_COMMANDS: ListAgentProviderSlashCommandsResult = {
	commands: [
		{ autoSubmit: false, command: 'security-review', description: 'Audit' },
		{ autoSubmit: false, command: 'code-review', description: 'Review' },
	],
	error: null,
	source: 'runtime',
};

/** Renders the hook with the slash menu shut, so the caller can open it. */
function renderSlashCommandsClosed(
	provider: 'claude' | 'pi' = 'claude',
	result: ListAgentProviderSlashCommandsResult = CLAUDE_COMMANDS,
) {
	return renderSlashCommands(provider, result, false);
}

/** Renders the hook over a stub bridge, returning the recorded bridge calls. */
function renderSlashCommands(
	provider: 'claude' | 'pi',
	result: ListAgentProviderSlashCommandsResult = CLAUDE_COMMANDS,
	menuOpen = true,
) {
	const listAgentProviderSlashCommands = vi.fn(async () => result);
	installEnsemblrApi({ listAgentProviderSlashCommands });
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);

	return {
		client,
		listAgentProviderSlashCommands,
		...renderHook(
			({ menuOpen: open }: { menuOpen: boolean }) =>
				useSlashCommands(provider, '/workspaces/demo', open),
			{ initialProps: { menuOpen }, wrapper },
		),
	};
}

/** Minimal Map-backed Storage — happy-dom ships no `localStorage` of its own. */
function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k) => map.get(k) ?? null,
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => {
			map.delete(k);
		},
		setItem: (k, v) => {
			map.set(k, v);
		},
	} satisfies Storage;
}

/** Moves the clock the hook's age gates read, without touching real timers. */
let nowOffsetMs = 0;

beforeEach(() => {
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: fakeStorage(),
		writable: true,
	});
	nowOffsetMs = 0;
	const realNow = Date.now.bind(Date);
	vi.spyOn(Date, 'now').mockImplementation(() => realNow() + nowOffsetMs);
});

afterEach(() => {
	vi.restoreAllMocks();
	clearEnsemblrApi();
	// The slash cache reads ambient storage, and its module mirror outlives a
	// single test, so both have to go or one case seeds the next.
	Reflect.deleteProperty(globalThis, 'localStorage');
	resetSlashCommandsCacheMirror();
});

/** Longer than the query's five-minute stale time. */
const STALE_AGE_MS = 10 * 60_000;

/** Seeds the cache as a previous session would have left it moments ago. */
function seedFreshCache(commands = CLAUDE_COMMANDS.commands) {
	writeCachedSlashCommands('claude', '/workspaces/demo', commands, Date.now());
}

/** Seeds the cache old enough that the query should revalidate it. */
function seedStaleCache(
	commands = CLAUDE_COMMANDS.commands,
	provider: 'claude' | 'pi' = 'claude',
) {
	writeCachedSlashCommands(
		provider,
		'/workspaces/demo',
		commands,
		Date.now() - STALE_AGE_MS,
	);
}

/** Past the hook's revalidation window, still inside the query's stale time. */
const AGED_MS = 60_000;

/**
 * Seeds a catalogue a composer mount is entitled to trust but a deliberate look
 * at the menu is not.
 */
function seedAgedCache(commands = CLAUDE_COMMANDS.commands) {
	writeCachedSlashCommands(
		'claude',
		'/workspaces/demo',
		commands,
		Date.now() - AGED_MS,
	);
}

// Asking a runtime for its commands starts a child process, so a composer that
// never opens the slash menu must never pay for one.
test('asks nothing until the slash menu is first opened', async () => {
	const { listAgentProviderSlashCommands, rerender } =
		renderSlashCommandsClosed();

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).not.toHaveBeenCalled(),
	);

	rerender({ menuOpen: true });

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
});

test('keeps the catalogue after the menu closes again', async () => {
	const { listAgentProviderSlashCommands, rerender, result } =
		renderSlashCommandsClosed();

	rerender({ menuOpen: true });
	await waitFor(() => expect(result.current.commands).not.toEqual([]));

	rerender({ menuOpen: false });

	expect(result.current.commands.map((entry) => entry.command)).toEqual([
		'code-review',
		'security-review',
	]);
	expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1);
});

test('asks the runtime the composer is currently speaking for', async () => {
	const { listAgentProviderSlashCommands } = renderSlashCommands('claude');

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledWith({
			cwd: '/workspaces/demo',
			provider: 'claude',
		}),
	);
});

test('returns the runtime commands rather than a vendored catalogue', async () => {
	const { result } = renderSlashCommands('claude');

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toEqual([
			'code-review',
			'security-review',
		]),
	);
});

test('offers nothing for Claude Code when discovery fails', async () => {
	const { result } = renderSlashCommands('claude', {
		commands: [],
		error: 'No claude executable was found on your PATH.',
		source: 'runtime',
	});

	await waitFor(() => expect(result.current.commands).toEqual([]));
});

test("falls back to pi's vendored catalogue only for pi", async () => {
	const { result } = renderSlashCommands('pi', {
		commands: [],
		error: "Couldn't locate pi SDK package root.",
		source: 'static',
	});

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toContain(
			'compact',
		),
	);
});

// Claude Code reports a skill once per discovery root, so the raw catalogue
// carries four identical `/code-review` entries the menu must not render.
test('collapses commands the runtime reported more than once', async () => {
	const { result } = renderSlashCommands('claude', {
		commands: [
			{ autoSubmit: false, command: 'code-review', description: 'Review' },
			{ autoSubmit: false, command: 'code-review', description: 'Review' },
			{ autoSubmit: false, command: 'code-review', description: 'Review' },
			{ autoSubmit: false, command: 'code-review', description: 'Review' },
		],
		error: null,
		source: 'runtime',
	});

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toEqual([
			'code-review',
		]),
	);
});

// Discovery spawns a `claude` process, so the menu opens on an empty list. It
// must not claim nothing matched before the runtime has answered.
test('reports discovery as loading until the runtime answers', async () => {
	const { rerender, result } = renderSlashCommandsClosed();

	expect(result.current.loading).toBe(false);

	rerender({ menuOpen: true });
	expect(result.current.loading).toBe(true);

	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(result.current.commands).not.toEqual([]);
});

test('stops reporting loading once discovery comes back empty', async () => {
	const { result } = renderSlashCommands('claude', {
		commands: [],
		error: 'No claude executable was found on your PATH.',
		source: 'runtime',
	});

	await waitFor(() => expect(result.current.loading).toBe(false));
	expect(result.current.commands).toEqual([]);
});

test('paints from the cache before the runtime has answered', () => {
	seedFreshCache();
	const { result } = renderSlashCommandsClosed();

	expect(result.current.commands.map((entry) => entry.command)).toEqual([
		'code-review',
		'security-review',
	]);
});

// A workspace with a cache has something to show immediately, so it can afford
// to refresh in the background rather than waiting for the first `/`.
test('revalidates a stale cached workspace without waiting for the menu', async () => {
	seedStaleCache();
	const { listAgentProviderSlashCommands } = renderSlashCommandsClosed();

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
});

// Warming on mount would be a bad trade if it spawned a `claude` child every
// launch; reporting the cache's real age is what keeps it to one per stale time.
test('spawns nothing for a cache that is still fresh', async () => {
	seedFreshCache();
	const { listAgentProviderSlashCommands, result } =
		renderSlashCommandsClosed();

	await waitFor(() => expect(result.current.commands).not.toEqual([]));

	expect(listAgentProviderSlashCommands).not.toHaveBeenCalled();
});

test('does not cache a catalogue the runtime did not produce', async () => {
	const { result } = renderSlashCommands('pi', {
		commands: [{ autoSubmit: true, command: 'clear', description: 'Clear' }],
		error: null,
		source: 'static',
	});

	await waitFor(() => expect(result.current.commands).not.toEqual([]));

	expect(hasCachedSlashCommands('pi', '/workspaces/demo')).toBe(false);
});

// `runtime` plus zero commands means the user deleted their skills. Keeping the
// cache would resurrect them on every launch, since only a non-empty result
// overwrites it.
test('forgets the cache when the runtime reports no commands', async () => {
	seedStaleCache();
	const { result } = renderSlashCommandsClosed('claude', {
		commands: [],
		error: null,
		source: 'runtime',
	});

	await waitFor(() => expect(result.current.commands).toEqual([]));

	expect(hasCachedSlashCommands('claude', '/workspaces/demo')).toBe(false);
});

// A revalidate landing mid-typing would reorder rows under the keyboard
// highlight, and Enter on an autoSubmit command runs it straight away.
test('does not swap the catalogue under an open menu', async () => {
	seedStaleCache();
	const { listAgentProviderSlashCommands, rerender, result } =
		renderSlashCommands('claude', {
			commands: [{ autoSubmit: false, command: 'deploy', description: 'Ship' }],
			error: null,
			source: 'runtime',
		});

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
	expect(result.current.commands.map((entry) => entry.command)).toEqual([
		'code-review',
		'security-review',
	]);

	rerender({ menuOpen: false });

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toEqual([
			'deploy',
		]),
	);
});

// Filling the menu from the cache must not read downstream as a discovery that
// succeeded, or a broken `claude` on PATH becomes invisible.
test('keeps the discovery error when the cache fills the menu instead', async () => {
	seedStaleCache();
	const { client, result } = renderSlashCommandsClosed('claude', {
		commands: [],
		error: 'No claude executable was found on your PATH.',
		source: 'runtime',
	});

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toEqual([
			'code-review',
			'security-review',
		]),
	);

	expect(
		client.getQueryData(
			ensemblrQueryKeys.agentProviderSlashCommands(
				'claude',
				'/workspaces/demo',
			),
		),
	).toMatchObject({ error: 'No claude executable was found on your PATH.' });
	expect(hasCachedSlashCommands('claude', '/workspaces/demo')).toBe(true);
});

// Regression: the open-menu latch used to release only an *empty* catalogue, so
// pi — whose pre-discovery fallback carries 22 vendored commands — pinned those
// for the whole first open and never showed the user's own skills.
test("replaces pi's vendored fallback as soon as discovery answers", async () => {
	const { result } = renderSlashCommands('pi', {
		commands: [
			{ autoSubmit: false, command: 'my-project-skill', description: 'Real' },
		],
		error: null,
		source: 'runtime',
	});

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toEqual([
			'my-project-skill',
		]),
	);
});

// The latch still has to hold once a real catalogue is on screen, whichever
// runtime put it there — the fix above must not have traded one bug for the
// other by releasing pi's rows on every revalidate.
test('does not swap a discovered pi catalogue under an open menu', async () => {
	seedStaleCache(
		[{ autoSubmit: false, command: 'cached-skill', description: 'Cached' }],
		'pi',
	);
	const { listAgentProviderSlashCommands, rerender, result } =
		renderSlashCommands('pi', {
			commands: [
				{ autoSubmit: false, command: 'renamed-skill', description: 'Real' },
			],
			error: null,
			source: 'runtime',
		});

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
	expect(result.current.commands.map((entry) => entry.command)).toEqual([
		'cached-skill',
	]);

	rerender({ menuOpen: false });

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toEqual([
			'renamed-skill',
		]),
	);
});

// `staleTime` only decides whether a *trigger* refetches, and a mounted composer
// has none: its observer lives for the whole chat and `refetchOnWindowFocus` is
// off app-wide. A skill installed after the chat opened therefore stayed
// invisible in that workspace until the app was relaunched, while a workspace
// created afterwards picked it up straight away.
test('re-discovers when the menu opens onto an aged catalogue', async () => {
	seedAgedCache();
	const { listAgentProviderSlashCommands, rerender } =
		renderSlashCommandsClosed();

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).not.toHaveBeenCalled(),
	);

	rerender({ menuOpen: true });

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
});

// Discovery spawns a child process, so repeated opens inside one window must
// cost nothing once the catalogue has just been read.
test('spawns nothing when the menu opens onto a catalogue just discovered', async () => {
	seedFreshCache();
	const { listAgentProviderSlashCommands, rerender, result } =
		renderSlashCommandsClosed();

	rerender({ menuOpen: true });
	await waitFor(() => expect(result.current.commands).not.toEqual([]));

	expect(listAgentProviderSlashCommands).not.toHaveBeenCalled();
});

// Skills are installed outside the composer, so coming back to the window is
// the moment the cached catalogue is most likely to be wrong — and revalidating
// there is what lets the next open paint an already-correct list.
test('re-discovers when the app window regains focus', async () => {
	seedAgedCache();
	const { listAgentProviderSlashCommands } = renderSlashCommandsClosed();

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).not.toHaveBeenCalled(),
	);

	act(() => {
		window.dispatchEvent(new Event('focus'));
	});

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
});

test('spawns nothing on focus while the catalogue is still fresh', async () => {
	seedFreshCache();
	const { listAgentProviderSlashCommands, result } =
		renderSlashCommandsClosed();

	await waitFor(() => expect(result.current.commands).not.toEqual([]));

	act(() => {
		window.dispatchEvent(new Event('focus'));
	});

	expect(listAgentProviderSlashCommands).not.toHaveBeenCalled();
});

// The reported symptom, end to end: a workspace opened before the skill was
// installed kept serving the catalogue from before it.
//
// The open that triggers the refresh does not paint it. `useStableWhileOpen`
// holds the list the menu is already showing rather than reordering rows under
// the keyboard highlight, so the new catalogue lands in the query and the next
// open renders it. Pinned in both directions here, because it is the difference
// between "coming back to the app fixes this" and "opening the menu does".
test('shows a skill installed since the last discovery, from the next open', async () => {
	seedAgedCache();
	const { client, rerender, result } = renderSlashCommandsClosed('claude', {
		commands: [
			...CLAUDE_COMMANDS.commands,
			{ autoSubmit: false, command: 'new-skill', description: 'Fresh' },
		],
		error: null,
		source: 'runtime',
	});

	rerender({ menuOpen: true });
	await waitFor(() =>
		expect(
			client.getQueryData(
				ensemblrQueryKeys.agentProviderSlashCommands(
					'claude',
					'/workspaces/demo',
				),
			),
		).toMatchObject({
			commands: expect.arrayContaining([
				expect.objectContaining({ command: 'new-skill' }),
			]),
		}),
	);
	expect(result.current.commands.map((entry) => entry.command)).not.toContain(
		'new-skill',
	);

	rerender({ menuOpen: false });
	rerender({ menuOpen: true });

	await waitFor(() =>
		expect(result.current.commands.map((entry) => entry.command)).toContain(
			'new-skill',
		),
	);
});

// `refetch` fires on a disabled query too, so the revalidation triggers carry
// their own copy of the guard. Without it, coming back to the app would spawn
// the very child that deferring discovery until the first open exists to avoid.
test('spawns nothing on focus before the menu has ever been opened', async () => {
	const { listAgentProviderSlashCommands } = renderSlashCommandsClosed();

	act(() => {
		window.dispatchEvent(new Event('focus'));
	});

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).not.toHaveBeenCalled(),
	);
});

// `focus` fires on every return to the window — a native dialog closing, a
// detour into DevTools. Those are not trips to install a skill, and paying a
// discovery child for each one would cost an ordinary session two a minute.
test('spawns nothing when the app was away only for a moment', async () => {
	seedAgedCache();
	const { listAgentProviderSlashCommands } = renderSlashCommandsClosed();

	act(() => {
		window.dispatchEvent(new Event('blur'));
		nowOffsetMs = 1_000;
		window.dispatchEvent(new Event('focus'));
	});

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).not.toHaveBeenCalled(),
	);
});

test('re-discovers after a trip long enough to have installed something', async () => {
	seedAgedCache();
	const { listAgentProviderSlashCommands } = renderSlashCommandsClosed();

	act(() => {
		window.dispatchEvent(new Event('blur'));
		nowOffsetMs = 30_000;
		window.dispatchEvent(new Event('focus'));
	});

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
});

// A failed discovery still resolves — the query falls back to the cache and
// carries the error — so it refreshes the age clock like a good answer does. A
// machine with no `claude` on it must not re-spawn a doomed child every time
// its user comes back to the app.
test('re-probes a runtime that could not answer on the long window', async () => {
	seedAgedCache();
	const { listAgentProviderSlashCommands } = renderSlashCommandsClosed(
		'claude',
		{ commands: [], error: 'claude could not be resolved', source: 'static' },
	);

	act(() => {
		window.dispatchEvent(new Event('focus'));
	});
	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);

	nowOffsetMs = AGED_MS;
	act(() => {
		window.dispatchEvent(new Event('focus'));
	});

	await waitFor(() =>
		expect(listAgentProviderSlashCommands).toHaveBeenCalledTimes(1),
	);
});
