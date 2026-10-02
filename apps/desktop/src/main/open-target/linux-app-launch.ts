import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

import type { LocalCommandService } from '../commands';
import {
	findExecutableInCommonDirs,
	findExecutableOnPath,
} from '../pi-runtime/executable-discovery.ts';
import {
	type LinuxLauncher,
	resolveLinuxLauncher,
} from './linux-app-discovery.ts';
import { OpenTargetFailureError } from './open-target-failure.ts';
import type {
	LinuxAppIdentity,
	LinuxPathDelivery,
} from './open-target-registry.ts';

/** Commands that can launch a `.desktop` entry, most capable first. */
const DESKTOP_LAUNCH_COMMANDS = ['gio', 'gtk-launch'] as const;

/** The dispatch payload a Linux target carries. */
type LinuxAppDispatch = LinuxAppIdentity & {
	pathDelivery: LinuxPathDelivery;
};

/** A `.desktop` launcher found on this host: which one, and where it lives. */
export interface DesktopLaunchCommand {
	command: (typeof DESKTOP_LAUNCH_COMMANDS)[number];
	executablePath: string;
}

/**
 * Launches a Linux app with a workspace path, detached from Ensemblr.
 *
 * The app is resolved at dispatch time rather than read from the boot detection
 * map, so an editor installed since launch works without a rescan. The child is
 * detached and `unref`ed because a GUI app like Dolphin or Konsole never exits
 * on its own — awaiting its exit would hang the IPC call until the user closed
 * the window, and tying it to Ensemblr's lifetime would kill it on quit. Only
 * the spawn handshake is awaited, so an ENOENT still reaches the caller.
 * @param options - The dispatch payload, the app's label, the command service and the path to open.
 */
export async function launchLinuxApp({
	dispatch,
	label,
	localCommandService,
	targetPath,
}: {
	dispatch: LinuxAppDispatch;
	label: string;
	localCommandService: LocalCommandService;
	targetPath: string;
}): Promise<void> {
	const environment = await readShellEnvironment(localCommandService);
	const pathValue = environment.PATH ?? '';
	const launcher = resolveLinuxLauncher(dispatch, {
		env: environment,
		pathValue,
	});

	if (!launcher) {
		throw new OpenTargetFailureError(
			'open-target-app-not-installed',
			`${label} is not installed.`,
		);
	}

	const invocation = buildInvocation({
		desktopLaunchCommand: resolveDesktopLaunchCommand(pathValue),
		launcher,
		pathDelivery: dispatch.pathDelivery,
		targetPath,
	});

	if (!invocation) {
		throw new OpenTargetFailureError(
			'open-target-no-desktop-launcher',
			`No launcher is available to open ${label}. Install glib (for gio) or gtk-launch.`,
		);
	}

	await spawnDetached({ ...invocation, environment, label });
}

/** A resolved command line plus the directory it should run in. */
export interface LinuxInvocation {
	args: readonly string[];
	command: string;
	cwd?: string;
}

/**
 * Finds the first `.desktop` launcher installed on this host.
 * @param pathValue - PATH-style directory list to search before the common dirs.
 * @returns The launcher, or `null` when neither `gio` nor `gtk-launch` exists.
 */
export function resolveDesktopLaunchCommand(
	pathValue: string,
): DesktopLaunchCommand | null {
	for (const command of DESKTOP_LAUNCH_COMMANDS) {
		const executablePath =
			findExecutableOnPath(command, pathValue) ??
			findExecutableInCommonDirs(command);
		if (executablePath) {
			return { command, executablePath };
		}
	}
	return null;
}

/**
 * Builds the command line for a launcher, honouring how the app expects the
 * path.
 * @param options - The resolved launcher, the host's `.desktop` launcher, path delivery and target path.
 * @returns The invocation, or `null` when a `.desktop` entry is all we have and
 *   no `.desktop` launcher is installed to start it.
 */
export function buildInvocation({
	desktopLaunchCommand,
	launcher,
	pathDelivery,
	targetPath,
}: {
	desktopLaunchCommand: DesktopLaunchCommand | null;
	launcher: LinuxLauncher;
	pathDelivery: LinuxPathDelivery;
	targetPath: string;
}): LinuxInvocation | null {
	if (launcher.kind === 'binary') {
		return applyPathDelivery({
			baseArgs: [],
			command: launcher.executablePath,
			pathDelivery,
			targetPath,
		});
	}

	if (!desktopLaunchCommand) {
		return null;
	}

	// `gio launch` takes the desktop *file*; `gtk-launch` takes the entry's
	// *name* and resolves it through the XDG data dirs itself, so handing it a
	// path finds nothing.
	const baseArgs =
		desktopLaunchCommand.command === 'gio'
			? ['launch', launcher.desktopFilePath]
			: [launcher.entryId];

	// Both launchers treat their trailing arguments as files to open, so a
	// `--select` flag would be passed through as a filename. A Flatpak file
	// manager therefore opens the containing directory instead of preselecting.
	return applyPathDelivery({
		baseArgs,
		command: desktopLaunchCommand.executablePath,
		pathDelivery:
			pathDelivery === 'select-in-parent' ? 'parent-directory' : pathDelivery,
		targetPath,
	});
}

/**
 * Appends the target path to a command line in the shape the app expects.
 * @param options - The launcher's own leading args, the command, path delivery and target path.
 * @returns The completed invocation.
 */
function applyPathDelivery({
	baseArgs,
	command,
	pathDelivery,
	targetPath,
}: {
	baseArgs: readonly string[];
	command: string;
	pathDelivery: LinuxPathDelivery;
	targetPath: string;
}): LinuxInvocation {
	switch (pathDelivery) {
		case 'working-directory':
			return { args: baseArgs, command, cwd: targetPath };
		case 'select-in-parent':
			return { args: [...baseArgs, '--select', targetPath], command };
		case 'parent-directory':
			return { args: [...baseArgs, dirname(targetPath)], command };
		case 'argument':
			return { args: [...baseArgs, targetPath], command };
	}
}

/**
 * Spawns a GUI app in its own process group so it outlives Ensemblr, resolving
 * once the child is running rather than once it exits.
 *
 * `spawn` reports a missing binary asynchronously on `'error'`, so a
 * fire-and-forget spawn reports success for a launch that never happened and
 * the split button then repoints itself at the app that just failed. Waiting
 * for `'spawn'` costs nothing — it fires as soon as the fork succeeds.
 * @param options - The invocation, the environment to launch with, and the app's label.
 */
function spawnDetached({
	args,
	command,
	cwd,
	environment,
	label,
}: LinuxInvocation & {
	environment: Record<string, string>;
	label: string;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			detached: true,
			env: environment,
			stdio: 'ignore',
			...(cwd ? { cwd } : {}),
		});

		child.once('error', (error: Error) => {
			reject(new Error(`Failed to launch ${label}: ${error.message}`));
		});
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}

/**
 * Reads the login-shell environment a launched app should inherit, falling back
 * to the process environment when the shell probe fails.
 * @param localCommandService - Service that resolves the login-shell environment.
 * @returns An environment record with no undefined values.
 */
export async function readShellEnvironment(
	localCommandService: LocalCommandService,
): Promise<Record<string, string>> {
	try {
		const snapshot = await localCommandService.getEnvironment();
		return { ...snapshot.env, PATH: snapshot.path };
	} catch {
		return Object.fromEntries(
			Object.entries(process.env).filter(
				(entry): entry is [string, string] => entry[1] !== undefined,
			),
		);
	}
}
