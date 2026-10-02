// Locates what Bun installed for this app. The monorepo installs with Bun's
// hoisted linker, which puts this workspace's dependencies in the repository
// root's `node_modules` rather than in `apps/desktop/node_modules`, so a path
// built as `<app>/node_modules/<name>` misses nearly every one of them. These
// helpers search the way Node's resolver does — nearest `node_modules` first,
// then each parent's — without consulting a package's `exports`, which hides
// `package.json` for some of the packages the scripts here inspect.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The desktop app's root directory: the one holding its `package.json`. */
export const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Lists every `node_modules` directory Node's resolver would search from a
 * directory, nearest first.
 * @param fromDirectory - Absolute directory the search starts in
 * @returns Absolute `node_modules` paths from `fromDirectory` up to the filesystem root
 */
function nodeModulesChain(fromDirectory) {
	const own = join(fromDirectory, 'node_modules');
	const parent = dirname(fromDirectory);
	return parent === fromDirectory ? [own] : [own, ...nodeModulesChain(parent)];
}

/**
 * Finds the directory a package is installed in, as seen from `fromDirectory`.
 * @param name - Package name, scoped or not
 * @param fromDirectory - Absolute directory the search starts in; the app root by default
 * @returns Absolute path to the installed package, or null when none is installed
 */
export function findInstalledPackage(name, fromDirectory = APP_ROOT) {
	return (
		nodeModulesChain(fromDirectory)
			.map((nodeModules) => join(nodeModules, name))
			.find((candidate) => existsSync(join(candidate, 'package.json'))) ?? null
	);
}

/**
 * Finds an executable a dependency linked into a `node_modules/.bin`, as seen
 * from `fromDirectory`.
 * @param name - Executable name, such as `tsc`
 * @param fromDirectory - Absolute directory the search starts in; the app root by default
 * @returns Absolute path to the executable, or null when none is installed
 */
export function findInstalledBinary(name, fromDirectory = APP_ROOT) {
	return (
		nodeModulesChain(fromDirectory)
			.map((nodeModules) => join(nodeModules, '.bin', name))
			.find((candidate) => existsSync(candidate)) ?? null
	);
}
