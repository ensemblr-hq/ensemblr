import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { WorkspaceFileEntryWire } from '../../src/shared/ipc/contracts/workspace-files';

const { lstat, stat } = vi.hoisted(() => ({
	lstat: vi.fn<() => Promise<{ isSymbolicLink: () => boolean }>>(),
	stat: vi.fn<() => Promise<{ isDirectory: () => boolean }>>(),
}));

vi.mock('node:fs/promises', () => ({ lstat, stat }));

beforeEach(() => {
	vi.useFakeTimers();
	lstat.mockResolvedValue({ isSymbolicLink: () => true });
	stat.mockResolvedValue({ isDirectory: () => true });
});

afterEach(() => {
	vi.useRealTimers();
	vi.resetAllMocks();
	vi.resetModules();
});

function link(path: string): WorkspaceFileEntryWire {
	return { kind: 'file', name: path, path };
}

test('returns unknown for a stalled lstat without changing completed classifications or late results', async () => {
	const { annotateSymlinkTargets } = await import(
		'../../src/main/workspace-files/symlink-metadata'
	);
	const classification = Promise.withResolvers<{
		isSymbolicLink: () => boolean;
	}>();
	lstat
		.mockResolvedValueOnce({ isSymbolicLink: () => false })
		.mockResolvedValueOnce({ isSymbolicLink: () => true })
		.mockRejectedValueOnce(new Error('entry disappeared'))
		.mockReturnValueOnce(classification.promise);
	const directory: WorkspaceFileEntryWire = {
		kind: 'directory',
		name: 'folder',
		path: 'folder',
	};
	const entries = [
		link('plain'),
		link('healthy'),
		link('missing'),
		link('remote'),
		directory,
	];
	const completed = vi.fn<(entries: WorkspaceFileEntryWire[]) => void>();
	const listing = annotateSymlinkTargets('/repo', entries).then(completed);

	await vi.advanceTimersByTimeAsync(500);
	try {
		expect(completed).toHaveBeenCalledWith([
			link('plain'),
			{ ...link('healthy'), symlinkTargetKind: 'directory' },
			link('missing'),
			{ ...link('remote'), symlinkTargetKind: 'unknown' },
			directory,
		]);
		expect(stat).toHaveBeenCalledTimes(1);
	} finally {
		classification.resolve({ isSymbolicLink: () => true });
		await listing;
		await vi.advanceTimersByTimeAsync(0);
	}

	expect(completed).toHaveBeenCalledTimes(1);
	expect(completed.mock.calls[0][0][3].symlinkTargetKind).toBe('unknown');
	expect(stat).toHaveBeenCalledTimes(1);
	expect(entries[3]).not.toHaveProperty('symlinkTargetKind');
	expect(vi.getTimerCount()).toBe(0);
});

test('bounds and shares stalled lstat probes across listings until the filesystem work settles', async () => {
	const { annotateSymlinkTargets } = await import(
		'../../src/main/workspace-files/symlink-metadata'
	);
	const classification = Promise.withResolvers<{
		isSymbolicLink: () => boolean;
	}>();
	lstat.mockReturnValue(classification.promise);
	const entries = Array.from({ length: 1000 }, (_, index) =>
		link(`remote-${index}`),
	);
	const expected = entries.map((entry) => ({
		...entry,
		symlinkTargetKind: 'unknown',
	}));
	const first = annotateSymlinkTargets('/repo', entries);
	const concurrent = annotateSymlinkTargets('/repo', entries);

	try {
		await vi.advanceTimersByTimeAsync(0);
		expect(lstat).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(500);
		expect(await first).toEqual(expected);
		expect(await concurrent).toEqual(expected);
		for (const cwd of ['/repo', '/another-repo']) {
			expect(await annotateSymlinkTargets(cwd, entries)).toEqual(expected);
		}
		expect(lstat).toHaveBeenCalledTimes(2);
		expect(stat).not.toHaveBeenCalled();
	} finally {
		classification.resolve({ isSymbolicLink: () => true });
		await vi.advanceTimersByTimeAsync(0);
		await Promise.all([first, concurrent]);
	}

	lstat.mockResolvedValue({ isSymbolicLink: () => true });
	expect(await annotateSymlinkTargets('/repo', [link('remote-0')])).toEqual([
		{ ...link('remote-0'), symlinkTargetKind: 'directory' },
	]);
	expect(lstat).toHaveBeenCalledTimes(3);
	expect(vi.getTimerCount()).toBe(0);
});

test('stops launching initial batches after their listing budget expires', async () => {
	const { annotateSymlinkTargets } = await import(
		'../../src/main/workspace-files/symlink-metadata'
	);
	lstat.mockImplementation(
		() =>
			new Promise((resolve) => {
				setTimeout(() => resolve({ isSymbolicLink: () => true }), 100);
			}),
	);
	const entries = Array.from({ length: 1000 }, (_, index) =>
		link(`link-${index}`),
	);
	const completed = vi.fn<(entries: WorkspaceFileEntryWire[]) => void>();
	const listing = annotateSymlinkTargets('/repo', entries).then(completed);

	await vi.advanceTimersByTimeAsync(500);
	try {
		expect(completed).toHaveBeenCalledTimes(1);
		expect(lstat).toHaveBeenCalledTimes(6);
		expect(completed).toHaveBeenCalledWith(
			entries.map((entry, index) => ({
				...entry,
				symlinkTargetKind: index < 6 ? 'directory' : 'unknown',
			})),
		);
	} finally {
		await vi.runAllTimersAsync();
		await listing;
	}
	expect(lstat).toHaveBeenCalledTimes(6);
	expect(vi.getTimerCount()).toBe(0);
});

test('returns the listing when a target stalls without changing it after late completion', async () => {
	const { annotateSymlinkTargets } = await import(
		'../../src/main/workspace-files/symlink-metadata'
	);
	const target = Promise.withResolvers<{ isDirectory: () => boolean }>();
	stat.mockReturnValue(target.promise);
	const completed = vi.fn<(entries: WorkspaceFileEntryWire[]) => void>();
	const listing = annotateSymlinkTargets('/repo', [link('remote')]).then(
		completed,
	);

	await vi.advanceTimersByTimeAsync(500);

	try {
		expect(completed).toHaveBeenCalledWith([
			{ ...link('remote'), symlinkTargetKind: 'unknown' },
		]);
	} finally {
		target.resolve({ isDirectory: () => true });
		await listing;
	}

	expect(completed).toHaveBeenCalledTimes(1);
	expect(completed.mock.calls[0][0][0].symlinkTargetKind).toBe('unknown');
	expect(vi.getTimerCount()).toBe(0);
});

test('classifies every healthy target when a listing exceeds the probe cap', async () => {
	const { annotateSymlinkTargets } = await import(
		'../../src/main/workspace-files/symlink-metadata'
	);
	const entries = Array.from({ length: 10 }, (_, index) =>
		link(`link-${index}`),
	);

	expect(await annotateSymlinkTargets('/repo', entries)).toEqual(
		entries.map((entry) => ({ ...entry, symlinkTargetKind: 'directory' })),
	);
	expect(vi.getTimerCount()).toBe(0);
});

test('shares one wait budget across targets and stops launching probes after it expires', async () => {
	const { annotateSymlinkTargets } = await import(
		'../../src/main/workspace-files/symlink-metadata'
	);
	stat.mockImplementation(
		() =>
			new Promise((resolve) => {
				setTimeout(() => resolve({ isDirectory: () => true }), 100);
			}),
	);
	const entries = Array.from({ length: 10 }, (_, index) =>
		link(`link-${index}`),
	);
	const completed = vi.fn<(entries: WorkspaceFileEntryWire[]) => void>();
	const listing = annotateSymlinkTargets('/repo', entries).then(completed);

	await vi.advanceTimersByTimeAsync(300);
	try {
		expect(completed).toHaveBeenCalledWith(
			entries.map((entry, index) => ({
				...entry,
				symlinkTargetKind: index < 2 ? 'directory' : 'unknown',
			})),
		);
		expect(stat).toHaveBeenCalledTimes(3);
	} finally {
		await vi.runAllTimersAsync();
		await listing;
	}
	expect(stat).toHaveBeenCalledTimes(3);
	expect(vi.getTimerCount()).toBe(0);
});

test('deduplicates stalled targets across refreshes and bounds unreleased probes across workspaces', async () => {
	const { annotateSymlinkTargets } = await import(
		'../../src/main/workspace-files/symlink-metadata'
	);
	const target = Promise.withResolvers<{ isDirectory: () => boolean }>();
	stat.mockReturnValue(target.promise);
	const first = annotateSymlinkTargets('/repo', [link('remote')]);
	const concurrent = annotateSymlinkTargets('/repo', [link('remote')]);

	await vi.advanceTimersByTimeAsync(500);
	await Promise.all([first, concurrent]);
	expect(stat).toHaveBeenCalledTimes(1);

	for (let refresh = 0; refresh < 10; refresh++) {
		expect(await annotateSymlinkTargets('/repo', [link('remote')])).toEqual([
			{ ...link('remote'), symlinkTargetKind: 'unknown' },
		]);
	}
	expect(stat).toHaveBeenCalledTimes(1);

	const saturated = annotateSymlinkTargets(
		'/another-repo',
		Array.from({ length: 20 }, (_, index) => link(`remote-${index}`)),
	);
	await vi.advanceTimersByTimeAsync(500);
	expect(
		(await saturated).every((entry) => entry.symlinkTargetKind === 'unknown'),
	).toBe(true);
	expect(stat).toHaveBeenCalledTimes(2);

	const blockedByCap = annotateSymlinkTargets('/third-repo', [link('remote')]);
	await vi.advanceTimersByTimeAsync(500);
	expect(await blockedByCap).toEqual([
		{ ...link('remote'), symlinkTargetKind: 'unknown' },
	]);
	expect(stat).toHaveBeenCalledTimes(2);

	target.resolve({ isDirectory: () => true });
	await vi.advanceTimersByTimeAsync(0);
	stat.mockResolvedValue({ isDirectory: () => false });
	expect(await annotateSymlinkTargets('/repo', [link('remote')])).toEqual([
		{ ...link('remote'), symlinkTargetKind: 'file' },
	]);
	expect(stat).toHaveBeenCalledTimes(3);
	expect(vi.getTimerCount()).toBe(0);
});
