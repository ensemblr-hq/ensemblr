// Bun's hoisted linker installs this workspace's dependencies into the
// monorepo root's `node_modules`, and two tools look for some of them under
// this app's own directory and nowhere else:
//
// - Electron Forge locates Electron at `<app>/node_modules/electron`, and only
//   climbs to an ancestor when it finds an npm, yarn or pnpm lockfile there —
//   never `bun.lock` — so `electron-forge start` and `package` fail without it.
// - `@electron/packager` copies the app directory and nothing above it, so the
//   runtime packages `forge.config.ts` keeps through `PACKAGE_KEEP_*` would be
//   absent from every packaged app. `forge.config.ts` sets `derefSymlinks`, so
//   a link here ships the real files.
//
// This runs as the workspace's `postinstall`, and links each of those packages
// into `apps/desktop/node_modules`. A real directory already there — Bun
// installs one locally when a version conflicts with the hoisted copy — is the
// correct one and is left alone.
import {
	lstatSync,
	mkdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_ROOT, findInstalledPackage } from './installed-packages.mjs';

/**
 * Packages a tool resolves from the app directory alone. Forge's
 * `PACKAGE_KEEP_PREFIXES` names the last three; keep the two lists in step.
 */
const APP_LOCAL_PACKAGES = [
	'electron',
	'node-pty',
	'node-addon-api',
	'@anthropic-ai/claude-agent-sdk',
];

/**
 * Reads what currently sits at a link path without following it.
 * @param linkPath - Absolute path inside the app's `node_modules`
 * @returns `missing`, `directory` for a real install, or the symlink's target
 */
function inspectLinkPath(linkPath) {
	try {
		const stats = lstatSync(linkPath);
		return stats.isSymbolicLink()
			? { kind: 'link', target: readlinkSync(linkPath) }
			: { kind: 'directory' };
	} catch (error) {
		if (error.code === 'ENOENT') return { kind: 'missing' };
		throw error;
	}
}

/**
 * Links one hoisted package into the app's `node_modules`, replacing a stale
 * link and leaving a real install untouched.
 * @param name - Package name, scoped or not
 * @param appRoot - Absolute path to the app directory; the desktop app by default
 * @returns Whether a link was written
 */
export function linkHoistedPackage(name, appRoot = APP_ROOT) {
	const linkPath = join(appRoot, 'node_modules', name);
	const current = inspectLinkPath(linkPath);
	if (current.kind === 'directory') return false;

	const installed = findInstalledPackage(name, dirname(appRoot));
	if (installed === null) {
		throw new Error(
			`link-hoisted-packages: ${name} is not installed above ${appRoot}. Run \`bun install\` from the repository root.`,
		);
	}

	const target = relative(dirname(linkPath), installed);
	if (current.kind === 'link' && current.target === target) return false;
	if (current.kind === 'link') rmSync(linkPath);

	mkdirSync(dirname(linkPath), { recursive: true });
	symlinkSync(target, linkPath, 'dir');
	return true;
}

/**
 * Whether this module is the script Node was asked to run, rather than an
 * import from a test.
 * @returns True when invoked as `node scripts/link-hoisted-packages.mjs`
 */
function isInvokedDirectly() {
	const invoked = process.argv[1];
	return (
		invoked !== undefined &&
		realpathSync(invoked) === fileURLToPath(import.meta.url)
	);
}

if (isInvokedDirectly()) {
	const linked = APP_LOCAL_PACKAGES.filter((name) => linkHoistedPackage(name));
	if (linked.length > 0) {
		console.log(
			`link-hoisted-packages: linked ${linked.join(', ')} into apps/desktop/node_modules.`,
		);
	}
}
