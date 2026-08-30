import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
	CommandEnvironmentSnapshot,
	LocalCommandService,
} from '../../src/main/commands/command-types';
import type { LinuxLauncher } from '../../src/main/open-target/linux-app-discovery';
import {
	buildInvocation,
	type DesktopLaunchCommand,
	launchLinuxApp,
	readShellEnvironment,
	resolveDesktopLaunchCommand,
} from '../../src/main/open-target/linux-app-launch';
import { OpenTargetFailureError } from '../../src/main/open-target/open-target-failure';

const createdRoots: string[] = [];

/**
 * Builds a throwaway directory tree and registers it for cleanup.
 * @returns The absolute path to the tree's root.
 */
async function createRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), 'ensemblr-linux-launch-'));
	createdRoots.push(root);
	return root;
}

/**
 * Writes an executable script, so PATH resolution has something with the bit
 * set rather than a plain file it would correctly skip.
 * @param directory - Directory to write into; created if absent.
 * @param name - Executable basename.
 * @param body - Script contents, defaulting to a shell script that exits at once.
 * @returns The absolute path written.
 */
async function writeExecutable(
	directory: string,
	name: string,
	body = '#!/bin/sh\nexit 0\n',
): Promise<string> {
	await mkdir(directory, { recursive: true });
	const filePath = path.join(directory, name);
	await writeFile(filePath, body, 'utf8');
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

/**
 * Builds a command service whose environment probe returns a fixed snapshot.
 * @param overrides - Snapshot fields to override on top of a shell-sourced default.
 * @returns A command service stub carrying only what dispatch reads.
 */
function fakeCommandService(
	overrides: Partial<CommandEnvironmentSnapshot> = {},
): LocalCommandService {
	const snapshot: CommandEnvironmentSnapshot = {
		diagnostics: [],
		env: {},
		path: '',
		resolvedAt: '1970-01-01T00:00:00.000Z',
		shell: '/bin/sh',
		source: 'shell',
		...overrides,
	};
	return {
		getEnvironment: vi.fn().mockResolvedValue(snapshot),
		run: vi.fn(),
	};
}

const BINARY: LinuxLauncher = {
	executablePath: '/usr/bin/probe-app',
	kind: 'binary',
};

const DESKTOP_ENTRY: LinuxLauncher = {
	desktopFilePath: '/usr/share/applications/dev.zed.Zed.desktop',
	entryId: 'dev.zed.Zed',
	kind: 'desktop-entry',
};

const GIO: DesktopLaunchCommand = {
	command: 'gio',
	executablePath: '/usr/bin/gio',
};

const GTK_LAUNCH: DesktopLaunchCommand = {
	command: 'gtk-launch',
	executablePath: '/usr/bin/gtk-launch',
};

const TARGET_FILE = '/home/alice/work/src/main.ts';
const TARGET_PARENT = '/home/alice/work/src';

// Deliberately unreal command names. `resolveLinuxLauncher` falls back to
// `findExecutableInCommonDirs`, which sweeps `/usr/bin` and `/opt/homebrew/bin`
// whatever PATH the caller passes, so a plausible name would resolve to
// whatever the machine running the suite happens to have installed.
const ABSENT_COMMAND = 'ensemblr-launch-absent';
const PRESENT_COMMAND = 'ensemblr-launch-present';

// `resolveDesktopLaunchCommand` sweeps the same common dirs, so a host that
// genuinely ships glib cannot exercise the "no launcher installed" branch
// end-to-end. The pure `buildInvocation` matrix covers it instead.
const hostHasDesktopLauncher = resolveDesktopLaunchCommand('') !== null;

afterEach(async () => {
	await Promise.all(
		createdRoots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

describe('buildInvocation: a resolved binary', () => {
	test('passes the path as the last argument', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: null,
				launcher: BINARY,
				pathDelivery: 'argument',
				targetPath: TARGET_FILE,
			}),
		).toEqual({ args: [TARGET_FILE], command: BINARY.executablePath });
	});

	test('spawns in the path and passes none for a terminal', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: null,
				launcher: BINARY,
				pathDelivery: 'working-directory',
				targetPath: TARGET_PARENT,
			}),
		).toEqual({
			args: [],
			command: BINARY.executablePath,
			cwd: TARGET_PARENT,
		});
	});

	// Dolphin and Nautilus both document `--select`, which opens the containing
	// folder with the entry highlighted rather than handing the file to its
	// default handler.
	test('preselects the file for a file manager that supports it', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: null,
				launcher: BINARY,
				pathDelivery: 'select-in-parent',
				targetPath: TARGET_FILE,
			}),
		).toEqual({
			args: ['--select', TARGET_FILE],
			command: BINARY.executablePath,
		});
	});

	test('reduces to the containing directory for a file manager with no select flag', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: null,
				launcher: BINARY,
				pathDelivery: 'parent-directory',
				targetPath: TARGET_FILE,
			}),
		).toEqual({ args: [TARGET_PARENT], command: BINARY.executablePath });
	});
});

describe('buildInvocation: a .desktop entry through gio', () => {
	test('launches the desktop file by path and appends the target', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: GIO,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'argument',
				targetPath: TARGET_FILE,
			}),
		).toEqual({
			args: ['launch', DESKTOP_ENTRY.desktopFilePath, TARGET_FILE],
			command: GIO.executablePath,
		});
	});

	test('passes no target and sets the cwd for a terminal', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: GIO,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'working-directory',
				targetPath: TARGET_PARENT,
			}),
		).toEqual({
			args: ['launch', DESKTOP_ENTRY.desktopFilePath],
			command: GIO.executablePath,
			cwd: TARGET_PARENT,
		});
	});

	// `gio launch DESKTOP-FILE [FILE-ARG…]` treats trailing arguments as files to
	// open, so a `--select` flag would arrive as a filename.
	test('degrades a preselect to the containing directory', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: GIO,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'select-in-parent',
				targetPath: TARGET_FILE,
			}),
		).toEqual({
			args: ['launch', DESKTOP_ENTRY.desktopFilePath, TARGET_PARENT],
			command: GIO.executablePath,
		});
	});

	test('appends the containing directory for a file manager with no select flag', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: GIO,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'parent-directory',
				targetPath: TARGET_FILE,
			}),
		).toEqual({
			args: ['launch', DESKTOP_ENTRY.desktopFilePath, TARGET_PARENT],
			command: GIO.executablePath,
		});
	});
});

describe('buildInvocation: a .desktop entry through gtk-launch', () => {
	// `gtk-launch APPLICATION` resolves the name through the XDG data dirs
	// itself. Handing it the absolute path finds nothing — and the Flatpak export
	// roots discovery searches are exactly the ones that can be absent from
	// XDG_DATA_DIRS, so the fallback would fail precisely when it is needed.
	test('launches the entry by id, never by path', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: GTK_LAUNCH,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'argument',
				targetPath: TARGET_FILE,
			}),
		).toEqual({
			args: [DESKTOP_ENTRY.entryId, TARGET_FILE],
			command: GTK_LAUNCH.executablePath,
		});
	});

	test('passes no target and sets the cwd for a terminal', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: GTK_LAUNCH,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'working-directory',
				targetPath: TARGET_PARENT,
			}),
		).toEqual({
			args: [DESKTOP_ENTRY.entryId],
			command: GTK_LAUNCH.executablePath,
			cwd: TARGET_PARENT,
		});
	});

	test('degrades a preselect to the containing directory', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: GTK_LAUNCH,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'select-in-parent',
				targetPath: TARGET_FILE,
			}),
		).toEqual({
			args: [DESKTOP_ENTRY.entryId, TARGET_PARENT],
			command: GTK_LAUNCH.executablePath,
		});
	});

	test('appends the containing directory for a file manager with no select flag', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: GTK_LAUNCH,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'parent-directory',
				targetPath: TARGET_FILE,
			}),
		).toEqual({
			args: [DESKTOP_ENTRY.entryId, TARGET_PARENT],
			command: GTK_LAUNCH.executablePath,
		});
	});
});

describe('buildInvocation: no .desktop launcher on the host', () => {
	test('reports that a .desktop entry cannot be started', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: null,
				launcher: DESKTOP_ENTRY,
				pathDelivery: 'argument',
				targetPath: TARGET_FILE,
			}),
		).toBeNull();
	});

	test('still launches a resolved binary, which needs none', () => {
		expect(
			buildInvocation({
				desktopLaunchCommand: null,
				launcher: BINARY,
				pathDelivery: 'argument',
				targetPath: TARGET_FILE,
			}),
		).toEqual({ args: [TARGET_FILE], command: BINARY.executablePath });
	});
});

describe('resolveDesktopLaunchCommand', () => {
	test('prefers gio when it is on PATH', async () => {
		const root = await createRoot();
		const binDir = path.join(root, 'bin');
		const executablePath = await writeExecutable(binDir, 'gio');
		await writeExecutable(binDir, 'gtk-launch');

		expect(resolveDesktopLaunchCommand(binDir)).toEqual({
			command: 'gio',
			executablePath,
		});
	});
});

describe('launchLinuxApp', () => {
	test('reports an absent app with a code the renderer can translate', async () => {
		const root = await createRoot();

		await expect(
			launchLinuxApp({
				dispatch: {
					commands: [ABSENT_COMMAND],
					entryIds: ['org.example.Nothing'],
					pathDelivery: 'argument',
				},
				label: 'Ghostty',
				localCommandService: fakeCommandService({
					path: path.join(root, 'empty'),
				}),
				targetPath: root,
			}),
		).rejects.toThrowError(
			expect.objectContaining({ code: 'open-target-app-not-installed' }),
		);
	});

	test.skipIf(hostHasDesktopLauncher)(
		'reports a .desktop-only app with no launcher as its own code',
		async () => {
			const root = await createRoot();
			await writeDesktopEntry(path.join(root, 'share'), 'dev.zed.Zed');

			await expect(
				launchLinuxApp({
					dispatch: {
						commands: [ABSENT_COMMAND],
						entryIds: ['dev.zed.Zed'],
						pathDelivery: 'argument',
					},
					label: 'Zed',
					localCommandService: fakeCommandService({
						env: { XDG_DATA_DIRS: path.join(root, 'share') },
						path: path.join(root, 'empty'),
					}),
					targetPath: root,
				}),
			).rejects.toThrowError(
				expect.objectContaining({ code: 'open-target-no-desktop-launcher' }),
			);
		},
	);

	test('resolves once the app is running', async () => {
		const root = await createRoot();
		const binDir = path.join(root, 'bin');
		await writeExecutable(binDir, PRESENT_COMMAND);

		await expect(
			launchLinuxApp({
				dispatch: {
					commands: [PRESENT_COMMAND],
					entryIds: [],
					pathDelivery: 'argument',
				},
				label: 'Zed',
				localCommandService: fakeCommandService({ path: binDir }),
				targetPath: root,
			}),
		).resolves.toBeUndefined();
	});

	// `spawn` reports a failed exec asynchronously, so a fire-and-forget launch
	// answered `{ ok: true }` for an app that never started — and the split
	// button then repointed itself at it.
	test('rejects when the resolved app cannot actually be executed', async () => {
		const root = await createRoot();
		const binDir = path.join(root, 'bin');
		await writeExecutable(
			binDir,
			PRESENT_COMMAND,
			'#!/ensemblr-nonexistent-interpreter\n',
		);

		await expect(
			launchLinuxApp({
				dispatch: {
					commands: [PRESENT_COMMAND],
					entryIds: [],
					pathDelivery: 'argument',
				},
				label: 'Ghostty',
				localCommandService: fakeCommandService({ path: binDir }),
				targetPath: root,
			}),
		).rejects.toThrowError(/Ghostty/);
	});

	test('carries the failure code on an OpenTargetFailureError', async () => {
		const root = await createRoot();
		const error = await launchLinuxApp({
			dispatch: {
				commands: [ABSENT_COMMAND],
				entryIds: [],
				pathDelivery: 'argument',
			},
			label: 'Ghostty',
			localCommandService: fakeCommandService({ path: root }),
			targetPath: root,
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(OpenTargetFailureError);
	});
});

describe('readShellEnvironment', () => {
	test('takes the shell snapshot and overlays its resolved PATH', async () => {
		const service = fakeCommandService({
			env: { HOME: '/home/alice', PATH: '/stale' },
			path: '/home/alice/.local/bin:/usr/bin',
		});

		await expect(readShellEnvironment(service)).resolves.toEqual({
			HOME: '/home/alice',
			PATH: '/home/alice/.local/bin:/usr/bin',
		});
	});

	test('falls back to the process environment when the probe throws', async () => {
		const service: LocalCommandService = {
			getEnvironment: vi.fn().mockRejectedValue(new Error('shell timed out')),
			run: vi.fn(),
		};

		const environment = await readShellEnvironment(service);

		expect(environment.PATH).toBe(process.env.PATH);
		expect(Object.values(environment)).not.toContain(undefined);
	});
});
