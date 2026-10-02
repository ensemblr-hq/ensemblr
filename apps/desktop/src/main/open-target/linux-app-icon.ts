import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
	findDesktopEntry,
	resolveDesktopEntryDirs,
	resolveXdgDataRoots,
} from './linux-app-discovery.ts';
import { type KeyFileGroups, readKeyFile } from './linux-key-file.ts';
import type { LinuxAppIdentity } from './open-target-registry.ts';

/**
 * Pixel size the lookup asks a theme for. The menu draws icons at 16 CSS px on
 * displays up to 3x, and from 48 px up themes such as Breeze swap their
 * monochrome small-size glyphs for the full-colour app icon.
 */
const LOOKUP_SIZE = 64;

const HICOLOR_THEME = 'hicolor';
const KDE_DEFAULT_THEME = 'breeze';
const THEME_INDEX_FILE = 'index.theme';
const THEME_HEADER_GROUP = 'Icon Theme';
const DESKTOP_ENTRY_GROUP = 'Desktop Entry';
const APPLICATIONS_CONTEXT = 'Applications';
const APPS_SUBDIRECTORY = 'apps';
const SCALABLE_DIRECTORY = 'scalable';
const DEFAULT_THRESHOLD = 2;
const UNBOUNDED_SIZE = Number.MAX_SAFE_INTEGER;
const MAX_THEME_CHAIN = 8;
const GTK_SETTINGS_FILES = [
	'gtk-4.0/settings.ini',
	'gtk-3.0/settings.ini',
] as const;

/** Extensions an icon is looked up under, in the spec's preference order. */
const ICON_EXTENSIONS = ['png', 'svg'] as const;
const LOADABLE_ICON_PATH = /\.(?:png|svg)$/i;
const ICON_NAME_SUFFIX = /\.(?:png|svg|xpm)$/i;
const SIZED_DIRECTORY = /^(\d+)x\1(?:@(\d+)x?)?$/;

/** Environment variables the lookup reads, shaped like `process.env`. */
type Environment = Record<string, string | undefined>;

/** One app-icon subdirectory of a theme and the pixel range it serves. */
interface ThemeDirectory {
	maxSize: number;
	minSize: number;
	relativePath: string;
	scale: number;
}

/**
 * An icon theme as found on disk: every root that carries it, its app-icon
 * directories ranked best-first for {@link LOOKUP_SIZE}, and its parents.
 */
interface IconTheme {
	directories: readonly ThemeDirectory[];
	inherits: readonly string[];
	roots: readonly string[];
}

/**
 * Builds a resolver from a Linux app to the icon file its desktop shows for
 * it, following the freedesktop Icon Theme spec: the `.desktop` entry's
 * `Icon=`, looked up through the user's theme, the themes it inherits, then
 * `hicolor` and the unthemed pixmap directories. Themes are read once per
 * resolver, so one detection pass shares a resolver across its targets.
 * @param options - Environment and home directory the lookup resolves against.
 * @returns A function mapping an app to an absolute PNG or SVG path, or `null`
 * when the host has no loadable icon for it.
 */
export function createLinuxAppIconResolver({
	env = process.env,
	homeDirectory = homedir(),
}: {
	env?: Environment;
	homeDirectory?: string;
} = {}): (identity: LinuxAppIdentity) => string | null {
	const dataRoots = resolveXdgDataRoots(env, homeDirectory);
	const iconBaseDirs = [
		path.join(homeDirectory, '.icons'),
		...dataRoots.map((root) => path.join(root, 'icons')),
	];
	const unthemedDirs = [
		...iconBaseDirs,
		...dataRoots.map((root) => path.join(root, 'pixmaps')),
	];
	const desktopEntryDirs = resolveDesktopEntryDirs(env, homeDirectory);
	const themes = resolveThemeChain(
		resolvePreferredTheme(env, homeDirectory),
		iconBaseDirs,
	);

	return (identity) => {
		const declaredIcon = readDesktopEntryIcon(
			identity.entryIds,
			desktopEntryDirs,
		);
		return firstMatch(
			declaredIcon ? [declaredIcon] : identity.entryIds,
			(icon) => resolveIconFile(icon, themes, unthemedDirs),
		);
	};
}

/**
 * Reads the `Icon=` value of the first installed `.desktop` entry for an app.
 * @param entryIds - The app's freedesktop ids, in preference order.
 * @param desktopEntryDirs - `applications/` directories to search.
 * @returns The icon name or absolute path, or `null` when there is none.
 */
function readDesktopEntryIcon(
	entryIds: readonly string[],
	desktopEntryDirs: readonly string[],
): string | null {
	const entry = findDesktopEntry(entryIds, desktopEntryDirs);
	const icon = entry
		? readKeyFile(entry.desktopFilePath)?.get(DESKTOP_ENTRY_GROUP)?.get('Icon')
		: undefined;
	return icon || null;
}

/**
 * Resolves one `Icon=` value to a file: an absolute path is taken as-is when
 * loadable, and a name is looked up through the theme chain and then the
 * unthemed directories.
 * @param icon - An icon name, or an absolute path to an icon file.
 * @param themes - Themes to search, in lookup order.
 * @param unthemedDirs - Directories searched for the bare file last.
 * @returns The icon's absolute path, or `null` when nothing loadable matches.
 */
function resolveIconFile(
	icon: string,
	themes: readonly IconTheme[],
	unthemedDirs: readonly string[],
): string | null {
	if (path.isAbsolute(icon)) {
		return LOADABLE_ICON_PATH.test(icon) && existsSync(icon) ? icon : null;
	}
	const iconName = icon.replace(ICON_NAME_SUFFIX, '');
	if (!isSafePathSegment(iconName)) {
		return null;
	}
	return (
		firstMatch(themes, (theme) => findInTheme(iconName, theme)) ??
		firstMatch(unthemedDirs, (directory) => findIconFile(directory, iconName))
	);
}

/**
 * Finds an icon in a theme, taking directories best-size-first and each
 * directory across every root the theme is installed under.
 * @param iconName - The icon name, without an extension.
 * @param theme - The theme to search.
 * @returns The icon's absolute path, or `null` when the theme lacks it.
 */
function findInTheme(iconName: string, theme: IconTheme): string | null {
	return firstMatch(theme.directories, (directory) =>
		firstMatch(theme.roots, (root) =>
			findIconFile(path.join(root, directory.relativePath), iconName),
		),
	);
}

/**
 * Finds an icon file directly inside one directory.
 * @param directory - Directory to look in.
 * @param iconName - The icon name, without an extension.
 * @returns The first existing `<name>.<ext>`, or `null`.
 */
function findIconFile(directory: string, iconName: string): string | null {
	return firstMatch(ICON_EXTENSIONS, (extension) => {
		const candidate = path.join(directory, `${iconName}.${extension}`);
		return existsSync(candidate) ? candidate : null;
	});
}

/**
 * Reads the icon theme the user's desktop is set to. Plasma records it in
 * `kdeglobals` and falls back to Breeze when unset; GTK desktops other than
 * GNOME mirror theirs into `settings.ini`. GNOME keeps its choice in dconf, so
 * it resolves to `null` there and the lookup rests on `hicolor`, where GNOME
 * apps install their icons.
 * @param env - Environment to read `XDG_CONFIG_HOME` and the desktop from.
 * @param homeDirectory - Home directory used when `XDG_CONFIG_HOME` is unset.
 * @returns The theme name, or `null` when the desktop does not say.
 */
function resolvePreferredTheme(
	env: Environment,
	homeDirectory: string,
): string | null {
	const configHome = env.XDG_CONFIG_HOME || path.join(homeDirectory, '.config');
	const kdeTheme = readKeyFile(path.join(configHome, 'kdeglobals'))
		?.get('Icons')
		?.get('Theme');
	const gtkTheme = GTK_SETTINGS_FILES.map((file) =>
		readKeyFile(path.join(configHome, file))
			?.get('Settings')
			?.get('gtk-icon-theme-name'),
	).find(Boolean);

	return isKdeSession(env)
		? kdeTheme || gtkTheme || KDE_DEFAULT_THEME
		: gtkTheme || kdeTheme || null;
}

/**
 * Reports whether the session is Plasma, whose icon theme lives in `kdeglobals`.
 * @param env - Environment carrying `XDG_CURRENT_DESKTOP`.
 * @returns True when the desktop list names KDE.
 */
function isKdeSession(env: Environment): boolean {
	return (env.XDG_CURRENT_DESKTOP ?? '')
		.split(':')
		.some((desktop) => desktop.toUpperCase() === 'KDE');
}

/**
 * Orders the themes a lookup walks: the user's theme, then its `Inherits=`
 * parents depth-first, with `hicolor` last as the spec requires.
 * @param preferred - The user's theme, or `null` for `hicolor` alone.
 * @param iconBaseDirs - `icons/` directories a theme may be installed under.
 * @returns The installed themes, in lookup order.
 */
function resolveThemeChain(
	preferred: string | null,
	iconBaseDirs: readonly string[],
): IconTheme[] {
	const chain: IconTheme[] = [];
	const visited = new Set<string>([HICOLOR_THEME]);
	const pending = preferred ? [preferred] : [];

	for (
		let name = pending.pop();
		name !== undefined && chain.length < MAX_THEME_CHAIN;
		name = pending.pop()
	) {
		if (visited.has(name) || !isSafePathSegment(name)) {
			continue;
		}
		visited.add(name);
		const theme = loadIconTheme(name, iconBaseDirs);
		if (theme) {
			chain.push(theme);
			pending.push(...[...theme.inherits].reverse());
		}
	}

	const hicolor = loadIconTheme(HICOLOR_THEME, iconBaseDirs);
	return hicolor ? [...chain, hicolor] : chain;
}

/**
 * Loads a theme from every base directory that carries it, reading the first
 * `index.theme` found as the spec directs.
 * @param name - Theme directory name, e.g. `breeze-dark`.
 * @param iconBaseDirs - `icons/` directories a theme may be installed under.
 * @returns The theme, or `null` when no base directory carries it.
 */
function loadIconTheme(
	name: string,
	iconBaseDirs: readonly string[],
): IconTheme | null {
	const roots = iconBaseDirs
		.map((baseDir) => path.join(baseDir, name))
		.filter(isDirectory);
	if (roots.length === 0) {
		return null;
	}

	const index = firstMatch(roots, (root) =>
		readKeyFile(path.join(root, THEME_INDEX_FILE)),
	);
	const declared = readDeclaredDirectories(index);
	const declaredPaths = new Set(
		declared.map((directory) => directory.relativePath),
	);
	const undeclared = discoverSizedDirectories(roots).filter(
		(directory) => !declaredPaths.has(directory.relativePath),
	);

	return {
		directories: rankDirectories([...declared, ...undeclared]),
		inherits: splitList(index?.get(THEME_HEADER_GROUP)?.get('Inherits')),
		roots,
	};
}

/**
 * Reads the app-icon directories an `index.theme` declares. A directory whose
 * `Context` names something other than applications is skipped, which keeps a
 * miss in a large theme like `hicolor` from probing hundreds of directories.
 * @param index - The parsed `index.theme`, or `null` when the theme has none.
 * @returns The declared directories that can hold an app icon.
 */
function readDeclaredDirectories(
	index: KeyFileGroups | null,
): ThemeDirectory[] {
	const header = index?.get(THEME_HEADER_GROUP);
	const relativePaths = [
		...splitList(header?.get('Directories')),
		...splitList(header?.get('ScaledDirectories')),
	];

	return relativePaths.flatMap((relativePath) => {
		const group = index?.get(relativePath);
		const context = group?.get('Context');
		if (!group || (context && context !== APPLICATIONS_CONTEXT)) {
			return [];
		}
		const directory = toThemeDirectory(relativePath, group);
		return directory ? [directory] : [];
	});
}

/**
 * Converts one directory group of an `index.theme` into the pixel range it
 * serves, per its `Type` (`Fixed`, `Scalable`, or the default `Threshold`).
 * @param relativePath - The directory's path relative to the theme root.
 * @param group - The directory's key/value group.
 * @returns The directory, or `null` when its path or `Size` is unusable.
 */
function toThemeDirectory(
	relativePath: string,
	group: ReadonlyMap<string, string>,
): ThemeDirectory | null {
	const size = parseCount(group.get('Size'));
	if (!size || !isSafeRelativePath(relativePath)) {
		return null;
	}
	const scale = parseCount(group.get('Scale')) || 1;

	switch (group.get('Type')) {
		case 'Fixed':
			return { maxSize: size, minSize: size, relativePath, scale };
		case 'Scalable':
			return {
				maxSize: parseCount(group.get('MaxSize')) ?? size,
				minSize: parseCount(group.get('MinSize')) ?? size,
				relativePath,
				scale,
			};
		default: {
			const threshold = parseCount(group.get('Threshold')) ?? DEFAULT_THRESHOLD;
			return {
				maxSize: size + threshold,
				minSize: size - threshold,
				relativePath,
				scale,
			};
		}
	}
}

/**
 * Finds `NxN/apps` and `scalable/apps` directories on disk whether or not the
 * theme's index declares them. hicolor's index stops at 512 px, yet some
 * packages install only a 1024 px icon there, and a lookup that trusts the
 * index alone never finds it.
 * @param roots - Every directory the theme is installed under.
 * @returns The discovered directories, sized from their names.
 */
function discoverSizedDirectories(roots: readonly string[]): ThemeDirectory[] {
	const names = new Set(roots.flatMap(listDirectory));

	return [...names].flatMap((name): ThemeDirectory[] => {
		const relativePath = path.posix.join(name, APPS_SUBDIRECTORY);
		if (name === SCALABLE_DIRECTORY) {
			return [{ maxSize: UNBOUNDED_SIZE, minSize: 1, relativePath, scale: 1 }];
		}
		const match = SIZED_DIRECTORY.exec(name);
		if (!match) {
			return [];
		}
		const size = Number(match[1]);
		const scale = match[2] ? Number(match[2]) : 1;
		return [{ maxSize: size, minSize: size, relativePath, scale }];
	});
}

/**
 * Orders directories best-first for {@link LOOKUP_SIZE}, so the first hit a
 * lookup finds is the one the spec's two-pass search would pick.
 * @param directories - The theme's app-icon directories.
 * @returns A new array, best match first.
 */
function rankDirectories(
	directories: readonly ThemeDirectory[],
): ThemeDirectory[] {
	return [...directories].sort((a, b) => sizeRank(a) - sizeRank(b));
}

/**
 * Scores a directory against {@link LOOKUP_SIZE}: `-1` for an unscaled
 * directory whose range covers it, otherwise the spec's size distance.
 * @param directory - The directory to score.
 * @returns The rank; lower is better.
 */
function sizeRank(directory: ThemeDirectory): number {
	const minPixels = directory.minSize * directory.scale;
	const maxPixels = directory.maxSize * directory.scale;
	if (LOOKUP_SIZE < minPixels) {
		return minPixels - LOOKUP_SIZE;
	}
	if (LOOKUP_SIZE > maxPixels) {
		return LOOKUP_SIZE - maxPixels;
	}
	return directory.scale === 1 ? -1 : 0;
}

/**
 * Returns the first non-null result of applying a lookup to each item in turn.
 * @param items - Items to try, in order.
 * @param find - Lookup applied to each item.
 * @returns The first non-null result, or `null` when every item misses.
 */
function firstMatch<Item, Result>(
	items: readonly Item[],
	find: (item: Item) => Result | null,
): Result | null {
	for (const item of items) {
		const result = find(item);
		if (result !== null) {
			return result;
		}
	}
	return null;
}

/**
 * Splits a comma-separated key-file list, dropping empty entries.
 * @param value - The raw value, if the key was present.
 * @returns The trimmed entries.
 */
function splitList(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * Parses a non-negative integer key-file value.
 * @param value - The raw value, if the key was present.
 * @returns The number, or `null` when absent or not an integer.
 */
function parseCount(value: string | undefined): number | null {
	return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * Reports whether a theme or icon name is safe to join onto a directory.
 * @param segment - The name taken from a host config or `.desktop` file.
 * @returns True when it names a single entry inside the directory.
 */
function isSafePathSegment(segment: string): boolean {
	return (
		segment !== '' &&
		segment !== '.' &&
		segment !== '..' &&
		!segment.includes('/') &&
		!segment.includes('\0')
	);
}

/**
 * Reports whether an `index.theme` directory stays inside the theme root.
 * @param relativePath - The directory path the index declares.
 * @returns True when every segment is a plain name.
 */
function isSafeRelativePath(relativePath: string): boolean {
	return relativePath.split('/').every(isSafePathSegment);
}

/**
 * Reports whether a path is a directory, treating any error as "no".
 * @param candidate - Path to test.
 * @returns True for an existing directory.
 */
function isDirectory(candidate: string): boolean {
	try {
		return statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Lists a directory's entries, treating any error as empty.
 * @param directory - Directory to read.
 * @returns The entry names.
 */
function listDirectory(directory: string): string[] {
	try {
		return readdirSync(directory);
	} catch {
		return [];
	}
}
