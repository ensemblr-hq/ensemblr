import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
	findExecutableInCommonDirs,
	findExecutableOnPath,
} from '../pi-runtime/executable-discovery.ts';
import {
	isValidCommandName,
	isValidDesktopEntryId,
	type LinuxAppIdentity,
} from './open-target-registry.ts';

/**
 * How a resolved Linux app is launched: directly as a binary, or through the
 * `.desktop` entry a Flatpak install exports instead of a binary. The entry
 * carries both its id and its path because the two launchers disagree about
 * which one they take — `gio launch` wants the file, `gtk-launch` wants the
 * name it resolves through the XDG data dirs itself.
 */
export type LinuxLauncher =
	| { kind: 'binary'; executablePath: string }
	| { desktopFilePath: string; entryId: string; kind: 'desktop-entry' };

/**
 * Directories a Flatpak install exports its `.desktop` files into. A session
 * that enabled Flatpak after login can have them missing from `XDG_DATA_DIRS`,
 * so they are searched unconditionally rather than trusted to be listed.
 */
const FLATPAK_EXPORT_DIRS = [
	'/var/lib/flatpak/exports/share',
	'~/.local/share/flatpak/exports/share',
] as const;

const DEFAULT_XDG_DATA_DIRS = '/usr/local/share:/usr/share';

/**
 * Resolves where a Linux app's `.desktop` files may live, honouring
 * `XDG_DATA_DIRS` and always including the per-user and Flatpak export roots.
 * @param env - Environment to read `XDG_DATA_DIRS` and `XDG_DATA_HOME` from.
 * @param homeDirectory - Home directory used to expand `~`.
 * @returns Absolute `applications/` directories, in search order.
 */
export function resolveDesktopEntryDirs(
	env: Record<string, string | undefined> = process.env,
	homeDirectory: string = homedir(),
): string[] {
	const dataHome =
		env.XDG_DATA_HOME || path.join(homeDirectory, '.local', 'share');
	const dataDirs = (env.XDG_DATA_DIRS || DEFAULT_XDG_DATA_DIRS).split(':');
	const flatpakDirs = FLATPAK_EXPORT_DIRS.map((directory) =>
		directory.startsWith('~/')
			? path.join(homeDirectory, directory.slice(2))
			: directory,
	);
	const roots = [dataHome, ...dataDirs, ...flatpakDirs].filter(Boolean);

	return Array.from(
		new Set(roots.map((root) => path.join(root, 'applications'))),
	);
}

/**
 * Finds the first way this host can launch an app, preferring a binary on PATH
 * over a `.desktop` entry because launching one directly avoids a round trip
 * through `gio` and keeps the app's own argument handling.
 * @param identity - Command names and `.desktop` ids the app answers to.
 * @param options - Environment and home directory used for resolution.
 * @returns The launcher, or `null` when the app is not installed.
 */
export function resolveLinuxLauncher(
	identity: LinuxAppIdentity,
	{
		env = process.env,
		homeDirectory = homedir(),
		pathValue = process.env.PATH ?? '',
	}: {
		env?: Record<string, string | undefined>;
		homeDirectory?: string;
		pathValue?: string;
	} = {},
): LinuxLauncher | null {
	for (const command of identity.commands) {
		if (!isValidCommandName(command)) {
			continue;
		}
		const executablePath =
			findExecutableOnPath(command, pathValue) ??
			findExecutableInCommonDirs(command, homeDirectory);
		if (executablePath) {
			return { executablePath, kind: 'binary' };
		}
	}

	const directories = resolveDesktopEntryDirs(env, homeDirectory);
	for (const entryId of identity.entryIds) {
		if (!isValidDesktopEntryId(entryId)) {
			continue;
		}
		for (const directory of directories) {
			const desktopFilePath = path.join(directory, `${entryId}.desktop`);
			if (existsSync(desktopFilePath)) {
				return { desktopFilePath, entryId, kind: 'desktop-entry' };
			}
		}
	}

	return null;
}
