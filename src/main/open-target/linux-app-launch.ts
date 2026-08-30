import { spawn } from 'node:child_process';

import type { LocalCommandService } from '../commands';
import {
	findExecutableInCommonDirs,
	findExecutableOnPath,
} from '../pi-runtime/executable-discovery.ts';
import {
	type LinuxLauncher,
	resolveLinuxLauncher,
} from './linux-app-discovery.ts';
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

/**
 * Launches a Linux app with a workspace path, detached from Ensemblr.
 *
 * The app is resolved at dispatch time rather than read from the boot detection
 * map, so an editor installed since launch works without a rescan. The child is
 * detached and `unref`ed because a GUI app like Dolphin or Konsole never exits
 * on its own — awaiting it would hang the IPC call until the user closed the
 * window, and tying it to Ensemblr's lifetime would kill it on quit.
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
	const launcher = resolveLinuxLauncher(dispatch, {
		env: environment,
		pathValue: environment.PATH ?? '',
	});

	if (!launcher) {
		throw new Error(`${label} is not installed.`);
	}

	const invocation = buildInvocation({
		launcher,
		pathDelivery: dispatch.pathDelivery,
		pathValue: environment.PATH ?? '',
		targetPath,
	});

	if (!invocation) {
		throw new Error(
			`No launcher is available to open ${label}. Install glib (for gio) or gtk-launch.`,
		);
	}

	spawnDetached({ ...invocation, environment, label });
}

/** A resolved command line plus the directory it should run in. */
interface LinuxInvocation {
	args: readonly string[];
	command: string;
	cwd?: string;
}

/**
 * Builds the command line for a launcher, honouring how the app expects the
 * path.
 * @param options - The resolved launcher, path delivery, PATH and target path.
 * @returns The invocation, or `null` when no `.desktop` launcher is installed.
 */
function buildInvocation({
	launcher,
	pathDelivery,
	pathValue,
	targetPath,
}: {
	launcher: LinuxLauncher;
	pathDelivery: LinuxPathDelivery;
	pathValue: string;
	targetPath: string;
}): LinuxInvocation | null {
	if (launcher.kind === 'binary') {
		return pathDelivery === 'working-directory'
			? { args: [], command: launcher.executablePath, cwd: targetPath }
			: { args: [targetPath], command: launcher.executablePath };
	}

	const launchCommand = DESKTOP_LAUNCH_COMMANDS.map((command) => ({
		command,
		executablePath:
			findExecutableOnPath(command, pathValue) ??
			findExecutableInCommonDirs(command),
	})).find((candidate) => candidate.executablePath !== null);

	if (!launchCommand?.executablePath) {
		return null;
	}

	const args =
		launchCommand.command === 'gio'
			? ['launch', launcher.desktopFilePath]
			: [launcher.desktopFilePath];

	return pathDelivery === 'working-directory'
		? { args, command: launchCommand.executablePath, cwd: targetPath }
		: { args: [...args, targetPath], command: launchCommand.executablePath };
}

/**
 * Spawns a GUI app in its own process group so it outlives Ensemblr, reporting
 * only a failure to start — anything it does afterwards is its own business.
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
}): void {
	const child = spawn(command, [...args], {
		detached: true,
		env: environment,
		stdio: 'ignore',
		...(cwd ? { cwd } : {}),
	});

	child.on('error', (error) => {
		console.error(`[open-target] failed to launch ${label}`, error);
	});
	child.unref();
}

/**
 * Reads the login-shell environment a launched app should inherit, falling back
 * to the process environment when the shell probe fails.
 * @param localCommandService - Service that resolves the login-shell environment.
 * @returns An environment record with no undefined values.
 */
async function readShellEnvironment(
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
