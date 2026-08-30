import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
	resolveDesktopEntryDirs,
	resolveLinuxLauncher,
} from '../../src/main/open-target/linux-app-discovery';

const createdRoots: string[] = [];

/**
 * Builds a throwaway directory tree and registers it for cleanup.
 * @returns The absolute path to the tree's root.
 */
async function createRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), 'ensemblr-linux-app-'));
	createdRoots.push(root);
	return root;
}

/**
 * Writes an executable file, so PATH resolution has something with the bit set
 * rather than a plain file it would correctly skip.
 * @param directory - Directory to write into; created if absent.
 * @param name - Executable basename.
 * @returns The absolute path written.
 */
async function writeExecutable(
	directory: string,
	name: string,
): Promise<string> {
	await mkdir(directory, { recursive: true });
	const filePath = path.join(directory, name);
	await writeFile(filePath, '#!/bin/sh\n', 'utf8');
	await chmod(filePath, 0o755);
	return filePath;
}

/**
 * Writes a `.desktop` entry into an `applications/` directory under a data root.
 * @param dataRoot - XDG data root, e.g. `<tmp>/share`.
 * @param entryId - Freedesktop application id, without the extension.
 * @returns The absolute path written.
 */
async function writeDesktopEntry(
	dataRoot: string,
	entryId: string,
): Promise<string> {
	const directory = path.join(dataRoot, 'applications');
	await mkdir(directory, { recursive: true });
	const filePath = path.join(directory, `${entryId}.desktop`);
	await writeFile(filePath, '[Desktop Entry]\nType=Application\n', 'utf8');
	return filePath;
}

afterEach(async () => {
	await Promise.all(
		createdRoots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

describe('resolveDesktopEntryDirs', () => {
	test('honours XDG_DATA_DIRS and always includes the per-user root', () => {
		const dirs = resolveDesktopEntryDirs(
			{ XDG_DATA_DIRS: '/opt/share:/usr/share' },
			'/home/alice',
		);

		expect(dirs).toContain('/home/alice/.local/share/applications');
		expect(dirs).toContain('/opt/share/applications');
		expect(dirs).toContain('/usr/share/applications');
	});

	test('prefers XDG_DATA_HOME over the default per-user root', () => {
		const dirs = resolveDesktopEntryDirs(
			{ XDG_DATA_HOME: '/home/alice/data' },
			'/home/alice',
		);

		expect(dirs).toContain('/home/alice/data/applications');
	});

	// A session that enabled Flatpak after login can have these missing from
	// XDG_DATA_DIRS, and a Flatpak app has no binary on PATH to fall back to.
	test('searches the Flatpak export roots even when XDG_DATA_DIRS omits them', () => {
		const dirs = resolveDesktopEntryDirs({ XDG_DATA_DIRS: '' }, '/home/alice');

		expect(dirs).toContain('/var/lib/flatpak/exports/share/applications');
		expect(dirs).toContain(
			'/home/alice/.local/share/flatpak/exports/share/applications',
		);
	});

	test('lists each directory once', () => {
		const dirs = resolveDesktopEntryDirs(
			{ XDG_DATA_DIRS: '/usr/share:/usr/share' },
			'/home/alice',
		);

		expect(dirs).toEqual([...new Set(dirs)]);
	});
});

// Deliberately unreal command names. `resolveLinuxLauncher` falls back to
// `findExecutableInCommonDirs`, which sweeps `/usr/bin` and `/opt/homebrew/bin`
// whatever PATH the caller passes — that fallback is what finds an editor in
// `~/.local/bin` on a host whose login-shell probe failed — so a plausible name
// like `code` would resolve to whatever the machine running the suite happens
// to have installed.
const ABSENT_COMMAND = 'ensemblr-probe-absent';
const PRESENT_COMMAND = 'ensemblr-probe-present';

describe('resolveLinuxLauncher', () => {
	test('takes the first command that resolves on PATH', async () => {
		const root = await createRoot();
		const binDir = path.join(root, 'bin');
		const executablePath = await writeExecutable(binDir, PRESENT_COMMAND);

		expect(
			resolveLinuxLauncher(
				{ commands: [ABSENT_COMMAND, PRESENT_COMMAND], entryIds: [] },
				{ env: {}, homeDirectory: root, pathValue: binDir },
			),
		).toEqual({ executablePath, kind: 'binary' });
	});

	// The binary carries the app's own argument handling; `gio launch` is a round
	// trip through glib that only exists because a Flatpak has no binary at all.
	test('prefers a binary over a .desktop entry for the same app', async () => {
		const root = await createRoot();
		const binDir = path.join(root, 'bin');
		const executablePath = await writeExecutable(binDir, PRESENT_COMMAND);
		await writeDesktopEntry(path.join(root, 'share'), 'dev.zed.Zed');

		expect(
			resolveLinuxLauncher(
				{ commands: [PRESENT_COMMAND], entryIds: ['dev.zed.Zed'] },
				{
					env: { XDG_DATA_DIRS: path.join(root, 'share') },
					homeDirectory: root,
					pathValue: binDir,
				},
			),
		).toEqual({ executablePath, kind: 'binary' });
	});

	test('falls back to a .desktop entry when no command resolves', async () => {
		const root = await createRoot();
		const desktopFilePath = await writeDesktopEntry(
			path.join(root, 'share'),
			'dev.zed.Zed',
		);

		expect(
			resolveLinuxLauncher(
				{ commands: [ABSENT_COMMAND], entryIds: ['dev.zed.Zed'] },
				{
					env: { XDG_DATA_DIRS: path.join(root, 'share') },
					homeDirectory: root,
					pathValue: path.join(root, 'empty'),
				},
			),
		).toEqual({ desktopFilePath, kind: 'desktop-entry' });
	});

	test('reports an app that is installed neither way as absent', async () => {
		const root = await createRoot();

		expect(
			resolveLinuxLauncher(
				{ commands: [ABSENT_COMMAND], entryIds: ['org.example.Nothing'] },
				{ env: {}, homeDirectory: root, pathValue: path.join(root, 'empty') },
			),
		).toBeNull();
	});

	// Defence in depth behind the registry's own validation: nothing that reaches
	// a spawn may carry a path separator or a shell metacharacter.
	test('skips a malformed command rather than resolving it', async () => {
		const root = await createRoot();
		const binDir = path.join(root, 'bin');
		await writeExecutable(binDir, PRESENT_COMMAND);

		expect(
			resolveLinuxLauncher(
				{ commands: [`../bin/${PRESENT_COMMAND}`], entryIds: [] },
				{ env: {}, homeDirectory: root, pathValue: binDir },
			),
		).toBeNull();
	});

	test('skips a malformed desktop entry id rather than resolving it', async () => {
		const root = await createRoot();
		await writeDesktopEntry(path.join(root, 'share'), 'ok');

		expect(
			resolveLinuxLauncher(
				{ commands: [], entryIds: ['../applications/ok'] },
				{
					env: { XDG_DATA_DIRS: path.join(root, 'share') },
					homeDirectory: root,
					pathValue: '',
				},
			),
		).toBeNull();
	});
});
