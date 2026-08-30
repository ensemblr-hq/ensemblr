import type {
	WorkspaceOpenTargetIconName,
	WorkspaceOpenTargetKind,
} from '@/shared/ipc/contracts/open-target';

/**
 * macOS bundle ids are reverse-DNS strings: letters, digits, dot, dash,
 * underscore. Any deviation means a malformed registry entry — we'd rather
 * fail loudly than emit a malformed Spotlight predicate.
 */
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * A bare command name, with no path separator and no shell metacharacter, so a
 * registry entry can never smuggle an argument or a second command past the
 * spawn.
 */
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;

/**
 * A freedesktop application id, i.e. the `.desktop` file's basename. Same shape
 * as a bundle id in practice, but validated separately so the two never share a
 * message.
 */
const DESKTOP_ENTRY_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Platforms a target can declare behaviour for. */
export type OpenTargetPlatform = 'darwin' | 'linux';

/**
 * A Linux app named both ways it can be installed: a launcher command on PATH,
 * and a `.desktop` entry for the Flatpak install that puts no binary there.
 * Detection tries the commands first, then the entries.
 */
export interface LinuxAppIdentity {
	readonly commands: readonly string[];
	readonly entryIds: readonly string[];
}

/**
 * How the service decides whether a target is installed on the host.
 *  - `builtin` — system-provided, no detection needed (Finder, Terminal.app).
 *  - `bundleId` — at least one bundle id is found via Launch Services / mdfind.
 *  - `linux-app` — a launcher command resolves, or a `.desktop` entry exists.
 *  - `utility` — non-app actions like "Copy path"; always available.
 */
type OpenTargetDetection =
	| { kind: 'builtin' }
	| { kind: 'bundleId'; bundleIds: readonly string[] }
	| ({ kind: 'linux-app' } & LinuxAppIdentity)
	| { kind: 'utility' };

/**
 * Where a Linux target expects the workspace path.
 *  - `argument` — appended as the last argument, the editor and file-manager shape.
 *  - `working-directory` — the process is spawned *in* the path and passed none,
 *    which is how a terminal emulator opens where you asked it to.
 */
export type LinuxPathDelivery = 'argument' | 'working-directory';

/**
 * How the service opens a workspace path with the target.
 *  - `reveal-in-finder` — `shell.showItemInFolder(path)`.
 *  - `open-bundle` — `/usr/bin/open -b <bundleId> <path>`.
 *  - `open-app-name` — `/usr/bin/open -a <appName> <path>`.
 *  - `linux-app` — spawns the resolved command detached, or `gio launch`es the
 *    resolved `.desktop` entry.
 *  - `copy-path` — clipboard.writeText(path).
 */
type OpenTargetDispatch =
	| { kind: 'reveal-in-finder' }
	| { kind: 'open-bundle'; bundleId: string }
	| { kind: 'open-app-name'; appName: string }
	| ({ kind: 'linux-app'; pathDelivery: LinuxPathDelivery } & LinuxAppIdentity)
	| { kind: 'copy-path' };

/** How one platform detects and launches a target. */
export interface OpenTargetPlatformBehavior {
	readonly detection: OpenTargetDetection;
	readonly dispatch: OpenTargetDispatch;
}

/**
 * Static description of a target the menu can show. Detection and dispatch are
 * declared per platform on one record, so adding an editor that exists on both
 * stays a single-entry edit; a record that omits a platform simply never
 * appears there.
 */
export interface OpenTargetDefinition {
	readonly id: string;
	readonly label: string;
	readonly iconName: WorkspaceOpenTargetIconName;
	readonly kind: WorkspaceOpenTargetKind;
	readonly platforms: Partial<
		Record<OpenTargetPlatform, OpenTargetPlatformBehavior>
	>;
	readonly isPrimary?: boolean;
	readonly shortcutLabel?: string;
}

/**
 * Copying a path needs no app and behaves identically everywhere, so both
 * platforms share the one behaviour object rather than restating it.
 */
const COPY_PATH_BEHAVIOR: OpenTargetPlatformBehavior = {
	detection: { kind: 'utility' },
	dispatch: { kind: 'copy-path' },
};

/**
 * Builds the Linux behaviour for an app, so a registry entry names its launcher
 * command and its `.desktop` id once rather than restating both for detection
 * and dispatch.
 * @param identity - Command names and `.desktop` ids, most specific first.
 * @param pathDelivery - Whether the app takes the path as an argument or a cwd.
 * @returns The Linux behaviour for that app.
 */
function linuxApp(
	identity: LinuxAppIdentity,
	pathDelivery: LinuxPathDelivery = 'argument',
): OpenTargetPlatformBehavior {
	return {
		detection: { kind: 'linux-app', ...identity },
		dispatch: { kind: 'linux-app', pathDelivery, ...identity },
	};
}

/**
 * Curated registry of well-known dev apps across macOS and Linux. Detection
 * narrows this set to the ones actually installed; UI order matches the array
 * order. Bundle id and command lists tolerate variants (EAP/MAS/non-MAS,
 * codename rebrands, distro packaging).
 */
export const OPEN_TARGET_REGISTRY: readonly OpenTargetDefinition[] = [
	{
		iconName: 'lucide:folder',
		id: 'finder',
		kind: 'file-manager',
		label: 'Finder',
		platforms: {
			darwin: {
				detection: { kind: 'builtin' },
				dispatch: { kind: 'reveal-in-finder' },
			},
		},
	},
	{
		iconName: 'vscode-icons:file-type-vscode',
		id: 'vscode',
		isPrimary: true,
		kind: 'editor',
		label: 'VS Code',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['com.microsoft.VSCode'] },
				dispatch: { kind: 'open-bundle', bundleId: 'com.microsoft.VSCode' },
			},
			linux: linuxApp({
				commands: ['code', 'codium'],
				entryIds: ['code', 'com.visualstudio.code', 'codium'],
			}),
		},
		shortcutLabel: '⌘O',
	},
	{
		iconName: 'vscode-icons:file-type-vscode',
		id: 'vscode-insiders',
		kind: 'editor',
		label: 'VS Code Insiders',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['com.microsoft.VSCodeInsiders'],
				},
				dispatch: {
					kind: 'open-bundle',
					bundleId: 'com.microsoft.VSCodeInsiders',
				},
			},
			linux: linuxApp({
				commands: ['code-insiders'],
				entryIds: ['code-insiders', 'com.visualstudio.code.insiders'],
			}),
		},
	},
	{
		iconName: 'lucide:file-code',
		id: 'cursor',
		kind: 'editor',
		label: 'Cursor',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['com.todesktop.230313mzl4w4u92'],
				},
				dispatch: {
					kind: 'open-bundle',
					bundleId: 'com.todesktop.230313mzl4w4u92',
				},
			},
			linux: linuxApp({ commands: ['cursor'], entryIds: ['cursor'] }),
		},
	},
	{
		iconName: 'lucide:file-code',
		id: 'windsurf',
		kind: 'editor',
		label: 'Windsurf',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['com.exafunction.windsurf', 'com.codeium.windsurf'],
				},
				dispatch: { kind: 'open-app-name', appName: 'Windsurf' },
			},
			linux: linuxApp({ commands: ['windsurf'], entryIds: ['windsurf'] }),
		},
	},
	{
		iconName: 'lucide:file-code',
		id: 'zed',
		kind: 'editor',
		label: 'Zed',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['dev.zed.Zed', 'dev.zed.Zed-Preview'],
				},
				dispatch: { kind: 'open-bundle', bundleId: 'dev.zed.Zed' },
			},
			linux: linuxApp({
				commands: ['zeditor', 'zed'],
				entryIds: ['dev.zed.Zed'],
			}),
		},
	},
	{
		iconName: 'lucide:wrench',
		id: 'xcode',
		kind: 'editor',
		label: 'Xcode',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['com.apple.dt.Xcode'] },
				dispatch: { kind: 'open-bundle', bundleId: 'com.apple.dt.Xcode' },
			},
		},
	},
	{
		iconName: 'lucide:file-code',
		id: 'sublime-text',
		kind: 'editor',
		label: 'Sublime Text',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['com.sublimetext.4', 'com.sublimetext.3'],
				},
				dispatch: { kind: 'open-app-name', appName: 'Sublime Text' },
			},
			linux: linuxApp({ commands: ['subl'], entryIds: ['sublime_text'] }),
		},
	},
	{
		iconName: 'lucide:file-code',
		id: 'nova',
		kind: 'editor',
		label: 'Nova',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['com.panic.Nova'] },
				dispatch: { kind: 'open-bundle', bundleId: 'com.panic.Nova' },
			},
		},
	},
	{
		iconName: 'lucide:file-code',
		id: 'intellij',
		kind: 'editor',
		label: 'IntelliJ IDEA',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: [
						'com.jetbrains.intellij',
						'com.jetbrains.intellij.ce',
						'com.jetbrains.intellij-EAP',
					],
				},
				dispatch: { kind: 'open-app-name', appName: 'IntelliJ IDEA' },
			},
			linux: linuxApp({
				commands: ['idea', 'intellij-idea'],
				entryIds: ['intellij-idea', 'jetbrains-idea', 'jetbrains-idea-ce'],
			}),
		},
	},
	{
		iconName: 'lucide:file-code',
		id: 'webstorm',
		kind: 'editor',
		label: 'WebStorm',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['com.jetbrains.WebStorm', 'com.jetbrains.WebStorm-EAP'],
				},
				dispatch: { kind: 'open-app-name', appName: 'WebStorm' },
			},
			linux: linuxApp({
				commands: ['webstorm'],
				entryIds: ['webstorm', 'jetbrains-webstorm'],
			}),
		},
	},
	{
		iconName: 'lucide:file-code',
		id: 'pycharm',
		kind: 'editor',
		label: 'PyCharm',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce'],
				},
				dispatch: { kind: 'open-app-name', appName: 'PyCharm' },
			},
			linux: linuxApp({
				commands: ['pycharm'],
				entryIds: ['pycharm', 'jetbrains-pycharm', 'jetbrains-pycharm-ce'],
			}),
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'ghostty',
		kind: 'terminal',
		label: 'Ghostty',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['com.mitchellh.ghostty'] },
				dispatch: { kind: 'open-bundle', bundleId: 'com.mitchellh.ghostty' },
			},
			linux: linuxApp(
				{ commands: ['ghostty'], entryIds: ['com.mitchellh.ghostty'] },
				'working-directory',
			),
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'warp',
		kind: 'terminal',
		label: 'Warp',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['dev.warp.Warp-Stable', 'dev.warp.Warp'],
				},
				dispatch: { kind: 'open-app-name', appName: 'Warp' },
			},
			linux: linuxApp(
				{ commands: ['warp-terminal'], entryIds: ['dev.warp.Warp'] },
				'working-directory',
			),
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'iterm',
		kind: 'terminal',
		label: 'iTerm',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['com.googlecode.iterm2'] },
				dispatch: { kind: 'open-bundle', bundleId: 'com.googlecode.iterm2' },
			},
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'hyper',
		kind: 'terminal',
		label: 'Hyper',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['co.zeit.hyper'] },
				dispatch: { kind: 'open-bundle', bundleId: 'co.zeit.hyper' },
			},
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'alacritty',
		kind: 'terminal',
		label: 'Alacritty',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['org.alacritty'] },
				dispatch: { kind: 'open-app-name', appName: 'Alacritty' },
			},
			linux: linuxApp(
				{
					commands: ['alacritty'],
					entryIds: ['Alacritty', 'org.alacritty.Alacritty'],
				},
				'working-directory',
			),
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'kitty',
		kind: 'terminal',
		label: 'kitty',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['net.kovidgoyal.kitty'] },
				dispatch: { kind: 'open-app-name', appName: 'kitty' },
			},
			linux: linuxApp(
				{ commands: ['kitty'], entryIds: ['kitty'] },
				'working-directory',
			),
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'wezterm',
		kind: 'terminal',
		label: 'WezTerm',
		platforms: {
			linux: linuxApp(
				{ commands: ['wezterm'], entryIds: ['org.wezfurlong.wezterm'] },
				'working-directory',
			),
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'konsole',
		kind: 'terminal',
		label: 'Konsole',
		platforms: {
			linux: linuxApp(
				{ commands: ['konsole'], entryIds: ['org.kde.konsole'] },
				'working-directory',
			),
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'gnome-terminal',
		kind: 'terminal',
		label: 'GNOME Terminal',
		platforms: {
			linux: linuxApp(
				{ commands: ['gnome-terminal'], entryIds: ['org.gnome.Terminal'] },
				'working-directory',
			),
		},
	},
	{
		iconName: 'lucide:square-terminal',
		id: 'terminal',
		kind: 'terminal',
		label: 'Terminal',
		platforms: {
			darwin: {
				detection: { kind: 'builtin' },
				dispatch: { kind: 'open-bundle', bundleId: 'com.apple.Terminal' },
			},
		},
	},
	{
		iconName: 'lucide:folder',
		id: 'dolphin',
		kind: 'file-manager',
		label: 'Dolphin',
		platforms: {
			linux: linuxApp({ commands: ['dolphin'], entryIds: ['org.kde.dolphin'] }),
		},
	},
	{
		iconName: 'lucide:folder',
		id: 'nautilus',
		kind: 'file-manager',
		label: 'Files',
		platforms: {
			linux: linuxApp({
				commands: ['nautilus'],
				entryIds: ['org.gnome.Nautilus'],
			}),
		},
	},
	{
		iconName: 'lucide:folder',
		id: 'thunar',
		kind: 'file-manager',
		label: 'Thunar',
		platforms: {
			linux: linuxApp({ commands: ['thunar'], entryIds: ['thunar'] }),
		},
	},
	{
		iconName: 'lucide:folder',
		id: 'nemo',
		kind: 'file-manager',
		label: 'Nemo',
		platforms: {
			linux: linuxApp({ commands: ['nemo'], entryIds: ['nemo'] }),
		},
	},
	{
		iconName: 'vscode-icons:folder-type-github',
		id: 'github-desktop',
		kind: 'source-control',
		label: 'GitHub Desktop',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['com.github.GitHubClient'],
				},
				dispatch: { kind: 'open-bundle', bundleId: 'com.github.GitHubClient' },
			},
		},
	},
	{
		iconName: 'lucide:github',
		id: 'tower',
		kind: 'source-control',
		label: 'Tower',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: ['com.fournova.Tower3', 'com.fournova.Tower2'],
				},
				dispatch: { kind: 'open-app-name', appName: 'Tower' },
			},
		},
	},
	{
		iconName: 'lucide:github',
		id: 'fork',
		kind: 'source-control',
		label: 'Fork',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['com.DanPristupov.Fork'] },
				dispatch: { kind: 'open-bundle', bundleId: 'com.DanPristupov.Fork' },
			},
		},
	},
	{
		iconName: 'lucide:github',
		id: 'sourcetree',
		kind: 'source-control',
		label: 'Sourcetree',
		platforms: {
			darwin: {
				detection: {
					kind: 'bundleId',
					bundleIds: [
						'com.torusknot.SourceTreeNotMAS',
						'com.atlassian.SourceTree',
					],
				},
				dispatch: { kind: 'open-app-name', appName: 'Sourcetree' },
			},
		},
	},
	{
		iconName: 'lucide:github',
		id: 'gitkraken',
		kind: 'source-control',
		label: 'GitKraken',
		platforms: {
			darwin: {
				detection: { kind: 'bundleId', bundleIds: ['com.axosoft.gitkraken'] },
				dispatch: { kind: 'open-bundle', bundleId: 'com.axosoft.gitkraken' },
			},
			linux: linuxApp({ commands: ['gitkraken'], entryIds: ['gitkraken'] }),
		},
	},
	{
		iconName: 'lucide:copy',
		id: 'copy-path',
		kind: 'utility',
		label: 'Copy path',
		platforms: { darwin: COPY_PATH_BEHAVIOR, linux: COPY_PATH_BEHAVIOR },
		shortcutLabel: '⌘⇧C',
	},
];

/** Returns the registry entry for an id, or `null` if unknown. */
export function findOpenTargetDefinition(
	targetId: string,
): OpenTargetDefinition | null {
	return (
		OPEN_TARGET_REGISTRY.find((definition) => definition.id === targetId) ??
		null
	);
}

/**
 * Resolves the behaviour a definition declares for a platform.
 * @param definition - Registry entry to read.
 * @param platform - Platform the app is running on.
 * @returns The behaviour, or `null` when the target does not exist there.
 */
export function resolvePlatformBehavior(
	definition: OpenTargetDefinition,
	platform: NodeJS.Platform,
): OpenTargetPlatformBehavior | null {
	if (platform !== 'darwin' && platform !== 'linux') {
		return null;
	}
	return definition.platforms[platform] ?? null;
}

/** Validates a bundle id against the macOS reverse-DNS shape. */
export function isValidBundleId(bundleId: string): boolean {
	return BUNDLE_ID_PATTERN.test(bundleId);
}

/** Validates a Linux launcher command against the bare-command-name shape. */
export function isValidCommandName(command: string): boolean {
	return COMMAND_NAME_PATTERN.test(command);
}

/** Validates a freedesktop application id against the `.desktop` basename shape. */
export function isValidDesktopEntryId(entryId: string): boolean {
	return DESKTOP_ENTRY_ID_PATTERN.test(entryId);
}

/**
 * Collects identifier-validation errors for every entry in the registry.
 * Returns an empty array when the registry is well-formed. Pulled out so the
 * test suite can assert it instead of crashing the main process at boot.
 */
export function collectRegistryValidationErrors(
	registry: readonly OpenTargetDefinition[] = OPEN_TARGET_REGISTRY,
): string[] {
	const errors: string[] = [];
	for (const definition of registry) {
		for (const behavior of Object.values(definition.platforms)) {
			errors.push(...collectBehaviorErrors(definition.id, behavior));
		}
	}
	return errors;
}

/**
 * Validates every identifier one platform behaviour carries.
 * @param targetId - Registry id, named in each message.
 * @param behavior - The behaviour to validate.
 * @returns One message per malformed identifier.
 */
function collectBehaviorErrors(
	targetId: string,
	behavior: OpenTargetPlatformBehavior,
): string[] {
	const errors: string[] = [];
	const { detection, dispatch } = behavior;

	if (detection.kind === 'bundleId') {
		for (const bundleId of detection.bundleIds) {
			if (!isValidBundleId(bundleId)) {
				errors.push(`Invalid bundle id "${bundleId}" in target "${targetId}".`);
			}
		}
	}
	if (detection.kind === 'linux-app') {
		errors.push(
			...collectLinuxIdentityErrors(targetId, detection, 'detection'),
		);
	}
	if (dispatch.kind === 'open-bundle' && !isValidBundleId(dispatch.bundleId)) {
		errors.push(
			`Invalid dispatch bundle id "${dispatch.bundleId}" in target "${targetId}".`,
		);
	}
	if (dispatch.kind === 'linux-app') {
		errors.push(...collectLinuxIdentityErrors(targetId, dispatch, 'dispatch'));
	}

	return errors;
}

/**
 * Validates the command names and `.desktop` ids a Linux identity carries.
 * @param targetId - Registry id, named in each message.
 * @param identity - The identity to validate.
 * @param role - Whether the identity was read from detection or dispatch.
 * @returns One message per malformed identifier.
 */
function collectLinuxIdentityErrors(
	targetId: string,
	identity: LinuxAppIdentity,
	role: 'detection' | 'dispatch',
): string[] {
	const errors: string[] = [];
	for (const command of identity.commands) {
		if (!isValidCommandName(command)) {
			errors.push(
				`Invalid ${role} command "${command}" in target "${targetId}".`,
			);
		}
	}
	for (const entryId of identity.entryIds) {
		if (!isValidDesktopEntryId(entryId)) {
			errors.push(
				`Invalid ${role} desktop entry id "${entryId}" in target "${targetId}".`,
			);
		}
	}
	return errors;
}
