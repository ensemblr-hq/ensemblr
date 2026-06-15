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
 * How the service decides whether a target is installed on the host.
 *  - `builtin` — system-provided on macOS, no detection needed (Finder, Terminal).
 *  - `bundleId` — at least one bundle id is found via Launch Services / mdfind.
 *  - `utility` — non-app actions like "Copy path"; always available.
 */
type OpenTargetDetection =
	| { kind: 'builtin' }
	| { kind: 'bundleId'; bundleIds: readonly string[] }
	| { kind: 'utility' };

/**
 * How the service opens a workspace path with the target.
 *  - `reveal-in-finder` — `shell.showItemInFolder(path)`.
 *  - `open-bundle` — `/usr/bin/open -b <bundleId> <path>`.
 *  - `open-app-name` — `/usr/bin/open -a <appName> <path>`.
 *  - `copy-path` — clipboard.writeText(path).
 */
type OpenTargetDispatch =
	| { kind: 'reveal-in-finder' }
	| { kind: 'open-bundle'; bundleId: string }
	| { kind: 'open-app-name'; appName: string }
	| { kind: 'copy-path' };

/**
 * Static description of a target the menu can show. Detection + dispatch
 * shapes are co-located so adding an editor or terminal is one entry, no
 * cross-file edits.
 */
export interface OpenTargetDefinition {
	readonly id: string;
	readonly label: string;
	readonly iconName: WorkspaceOpenTargetIconName;
	readonly kind: WorkspaceOpenTargetKind;
	readonly detection: OpenTargetDetection;
	readonly dispatch: OpenTargetDispatch;
	readonly isPrimary?: boolean;
	readonly shortcutLabel?: string;
}

/**
 * Curated registry of well-known macOS dev apps. Detection narrows this set to
 * the ones actually installed; UI order matches the array order.
 * Bundle id lists tolerate variants (EAP/MAS/non-MAS, codename rebrands).
 */
export const OPEN_TARGET_REGISTRY: readonly OpenTargetDefinition[] = [
	{
		detection: { kind: 'builtin' },
		dispatch: { kind: 'reveal-in-finder' },
		iconName: 'lucide:folder',
		id: 'finder',
		kind: 'file-manager',
		label: 'Finder',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['com.microsoft.VSCode'] },
		dispatch: { kind: 'open-bundle', bundleId: 'com.microsoft.VSCode' },
		iconName: 'vscode-icons:file-type-vscode',
		id: 'vscode',
		isPrimary: true,
		kind: 'editor',
		label: 'VS Code',
		shortcutLabel: '⌘O',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['com.microsoft.VSCodeInsiders'],
		},
		dispatch: {
			kind: 'open-bundle',
			bundleId: 'com.microsoft.VSCodeInsiders',
		},
		iconName: 'vscode-icons:file-type-vscode',
		id: 'vscode-insiders',
		kind: 'editor',
		label: 'VS Code Insiders',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['com.todesktop.230313mzl4w4u92'],
		},
		dispatch: {
			kind: 'open-bundle',
			bundleId: 'com.todesktop.230313mzl4w4u92',
		},
		iconName: 'lucide:file-code',
		id: 'cursor',
		kind: 'editor',
		label: 'Cursor',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['com.exafunction.windsurf', 'com.codeium.windsurf'],
		},
		dispatch: { kind: 'open-app-name', appName: 'Windsurf' },
		iconName: 'lucide:file-code',
		id: 'windsurf',
		kind: 'editor',
		label: 'Windsurf',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['dev.zed.Zed', 'dev.zed.Zed-Preview'],
		},
		dispatch: { kind: 'open-bundle', bundleId: 'dev.zed.Zed' },
		iconName: 'lucide:file-code',
		id: 'zed',
		kind: 'editor',
		label: 'Zed',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['com.apple.dt.Xcode'] },
		dispatch: { kind: 'open-bundle', bundleId: 'com.apple.dt.Xcode' },
		iconName: 'lucide:wrench',
		id: 'xcode',
		kind: 'editor',
		label: 'Xcode',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['com.sublimetext.4', 'com.sublimetext.3'],
		},
		dispatch: { kind: 'open-app-name', appName: 'Sublime Text' },
		iconName: 'lucide:file-code',
		id: 'sublime-text',
		kind: 'editor',
		label: 'Sublime Text',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['com.panic.Nova'] },
		dispatch: { kind: 'open-bundle', bundleId: 'com.panic.Nova' },
		iconName: 'lucide:file-code',
		id: 'nova',
		kind: 'editor',
		label: 'Nova',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: [
				'com.jetbrains.intellij',
				'com.jetbrains.intellij.ce',
				'com.jetbrains.intellij-EAP',
			],
		},
		dispatch: { kind: 'open-app-name', appName: 'IntelliJ IDEA' },
		iconName: 'lucide:file-code',
		id: 'intellij',
		kind: 'editor',
		label: 'IntelliJ IDEA',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['com.jetbrains.WebStorm', 'com.jetbrains.WebStorm-EAP'],
		},
		dispatch: { kind: 'open-app-name', appName: 'WebStorm' },
		iconName: 'lucide:file-code',
		id: 'webstorm',
		kind: 'editor',
		label: 'WebStorm',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce'],
		},
		dispatch: { kind: 'open-app-name', appName: 'PyCharm' },
		iconName: 'lucide:file-code',
		id: 'pycharm',
		kind: 'editor',
		label: 'PyCharm',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['com.mitchellh.ghostty'] },
		dispatch: { kind: 'open-bundle', bundleId: 'com.mitchellh.ghostty' },
		iconName: 'lucide:square-terminal',
		id: 'ghostty',
		kind: 'terminal',
		label: 'Ghostty',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['dev.warp.Warp-Stable', 'dev.warp.Warp'],
		},
		dispatch: { kind: 'open-app-name', appName: 'Warp' },
		iconName: 'lucide:square-terminal',
		id: 'warp',
		kind: 'terminal',
		label: 'Warp',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['com.googlecode.iterm2'] },
		dispatch: { kind: 'open-bundle', bundleId: 'com.googlecode.iterm2' },
		iconName: 'lucide:square-terminal',
		id: 'iterm',
		kind: 'terminal',
		label: 'iTerm',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['co.zeit.hyper'] },
		dispatch: { kind: 'open-bundle', bundleId: 'co.zeit.hyper' },
		iconName: 'lucide:square-terminal',
		id: 'hyper',
		kind: 'terminal',
		label: 'Hyper',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['org.alacritty'] },
		dispatch: { kind: 'open-app-name', appName: 'Alacritty' },
		iconName: 'lucide:square-terminal',
		id: 'alacritty',
		kind: 'terminal',
		label: 'Alacritty',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['net.kovidgoyal.kitty'] },
		dispatch: { kind: 'open-app-name', appName: 'kitty' },
		iconName: 'lucide:square-terminal',
		id: 'kitty',
		kind: 'terminal',
		label: 'kitty',
	},
	{
		detection: { kind: 'builtin' },
		dispatch: { kind: 'open-bundle', bundleId: 'com.apple.Terminal' },
		iconName: 'lucide:square-terminal',
		id: 'terminal',
		kind: 'terminal',
		label: 'Terminal',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['com.github.GitHubClient'] },
		dispatch: { kind: 'open-bundle', bundleId: 'com.github.GitHubClient' },
		iconName: 'vscode-icons:folder-type-github',
		id: 'github-desktop',
		kind: 'source-control',
		label: 'GitHub Desktop',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['com.fournova.Tower3', 'com.fournova.Tower2'],
		},
		dispatch: { kind: 'open-app-name', appName: 'Tower' },
		iconName: 'lucide:github',
		id: 'tower',
		kind: 'source-control',
		label: 'Tower',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['com.DanPristupov.Fork'] },
		dispatch: { kind: 'open-bundle', bundleId: 'com.DanPristupov.Fork' },
		iconName: 'lucide:github',
		id: 'fork',
		kind: 'source-control',
		label: 'Fork',
	},
	{
		detection: {
			kind: 'bundleId',
			bundleIds: ['com.torusknot.SourceTreeNotMAS', 'com.atlassian.SourceTree'],
		},
		dispatch: { kind: 'open-app-name', appName: 'Sourcetree' },
		iconName: 'lucide:github',
		id: 'sourcetree',
		kind: 'source-control',
		label: 'Sourcetree',
	},
	{
		detection: { kind: 'bundleId', bundleIds: ['com.axosoft.gitkraken'] },
		dispatch: { kind: 'open-bundle', bundleId: 'com.axosoft.gitkraken' },
		iconName: 'lucide:github',
		id: 'gitkraken',
		kind: 'source-control',
		label: 'GitKraken',
	},
	{
		detection: { kind: 'utility' },
		dispatch: { kind: 'copy-path' },
		iconName: 'lucide:copy',
		id: 'copy-path',
		kind: 'utility',
		label: 'Copy path',
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

/** Validates a bundle id against the macOS reverse-DNS shape. */
export function isValidBundleId(bundleId: string): boolean {
	return BUNDLE_ID_PATTERN.test(bundleId);
}

/**
 * Collects bundle-id validation errors for every entry in the registry.
 * Returns an empty array when the registry is well-formed. Pulled out so the
 * test suite can assert it instead of crashing the main process at boot.
 */
export function collectRegistryValidationErrors(
	registry: readonly OpenTargetDefinition[] = OPEN_TARGET_REGISTRY,
): string[] {
	const errors: string[] = [];
	for (const definition of registry) {
		if (definition.detection.kind === 'bundleId') {
			for (const bundleId of definition.detection.bundleIds) {
				if (!isValidBundleId(bundleId)) {
					errors.push(
						`Invalid bundle id "${bundleId}" in target "${definition.id}".`,
					);
				}
			}
		}
		if (
			definition.dispatch.kind === 'open-bundle' &&
			!isValidBundleId(definition.dispatch.bundleId)
		) {
			errors.push(
				`Invalid dispatch bundle id "${definition.dispatch.bundleId}" in target "${definition.id}".`,
			);
		}
	}
	return errors;
}
