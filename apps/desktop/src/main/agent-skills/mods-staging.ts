/**
 * Stages the Claude Code mods plugin Ensemblr ships into a writable directory
 * before any session loads it.
 *
 * Claude Code writes into a plugin folder that holds a hooks module: on every
 * load it lays `.claude-plugin/types/` and a root `tsconfig.json` there. Handing
 * it the shipped tree in place would therefore dirty a development checkout and
 * write into the signed macOS app bundle, so the tree is copied under the app's
 * user data instead, into a directory named after a hash of its content. Two
 * builds that ship the same mods share one copy; a build that changes them gets
 * a fresh one rather than a copy Claude has already written into.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** Directory under the user-data root that holds every staged copy. */
export const MODS_STAGING_DIRECTORY = 'claude-mods';

/** Manifest that marks a directory as a Claude Code plugin root. */
const PLUGIN_MANIFEST = path.join('.claude-plugin', 'plugin.json');

/** Hook registry every mods plugin carries. */
const HOOKS_MANIFEST = path.join('hooks', 'hooks.json');

/** Top-level directory of the plugin's own tests, which never ships to a session. */
const TESTS_DIRECTORY = 'tests';

/** Suffix of a test module kept beside the code it tests. */
const TEST_FILE_SUFFIX = '.test.ts';

/** Hex digits of the content hash a staged directory is named after. */
const HASH_LENGTH = 16;

/**
 * How long a sibling copy may go untouched before it is removed. Another app
 * process — a second release channel shares user data — may still be loading
 * its own copy, so only one nobody has staged for a day is treated as stale.
 */
const STALE_COPY_MS = 24 * 60 * 60 * 1000;

/** One file of the plugin, addressed relative to its root. */
interface PluginFile {
	bytes: Buffer;
	relativePath: string;
}

/** Staged roots already resolved in this process, keyed by sources and destination. */
const stagedRoots = new Map<string, string | null>();

/**
 * Whether a directory holds a complete mods plugin.
 * @param root - Candidate plugin root.
 * @returns True when both the plugin manifest and the hook registry are present.
 */
function isModsRoot(root: string): boolean {
	return (
		existsSync(path.join(root, PLUGIN_MANIFEST)) &&
		existsSync(path.join(root, HOOKS_MANIFEST))
	);
}

/**
 * Whether a path relative to the plugin root is test-only and stays behind.
 * @param relativePath - POSIX path relative to the root.
 * @returns True for anything under `tests/` and any `*.test.ts`.
 */
function isTestOnly(relativePath: string): boolean {
	return (
		relativePath.split('/')[0] === TESTS_DIRECTORY ||
		relativePath.endsWith(TEST_FILE_SUFFIX)
	);
}

/**
 * Orders names by UTF-16 code unit, so the hash never depends on the locale.
 * @param left - First name.
 * @param right - Second name.
 * @returns Negative, zero, or positive, as `Array.prototype.sort` expects.
 */
function compareNames(left: string, right: string): number {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

/**
 * Lists every regular file a session needs, in a stable order, with its bytes.
 * Symbolic links are skipped, so a copy can never reach outside the plugin.
 * @param root - Plugin root to read.
 * @param relativeDirectory - POSIX path of the directory being walked.
 * @returns The plugin's files, sorted by path.
 */
function readPluginFiles(
	root: string,
	relativeDirectory = '',
): readonly PluginFile[] {
	const entries = readdirSync(path.join(root, relativeDirectory), {
		withFileTypes: true,
	}).sort((left, right) => compareNames(left.name, right.name));
	return entries.flatMap((entry) => {
		const relativePath = relativeDirectory
			? `${relativeDirectory}/${entry.name}`
			: entry.name;
		if (isTestOnly(relativePath)) {
			return [];
		}
		if (entry.isDirectory()) {
			return readPluginFiles(root, relativePath);
		}
		return entry.isFile()
			? [{ bytes: readFileSync(path.join(root, relativePath)), relativePath }]
			: [];
	});
}

/**
 * Hashes the plugin's paths and bytes, so any change to what ships moves it.
 * @param files - The plugin's files, in stable order.
 * @returns The first {@link HASH_LENGTH} hex digits of the SHA-256.
 */
function hashPluginFiles(files: readonly PluginFile[]): string {
	const hash = createHash('sha256');
	for (const { bytes, relativePath } of files) {
		hash.update(relativePath).update('\0').update(bytes).update('\0');
	}
	return hash.digest('hex').slice(0, HASH_LENGTH);
}

/**
 * Writes the files into a fresh directory beside the target and renames it into
 * place, so a session never sees a half-written copy.
 * @param files - The plugin's files.
 * @param stagingParent - Directory every staged copy lives in.
 * @param target - Final directory of this copy.
 */
function writeStagedCopy(
	files: readonly PluginFile[],
	stagingParent: string,
	target: string,
): void {
	const temporary = path.join(
		stagingParent,
		`.staging-${path.basename(target)}-${randomUUID()}`,
	);
	try {
		for (const { bytes, relativePath } of files) {
			const destination = path.join(temporary, ...relativePath.split('/'));
			mkdirSync(path.dirname(destination), { recursive: true });
			writeFileSync(destination, bytes);
		}
		renameSync(temporary, target);
	} catch (error) {
		rmSync(temporary, { force: true, recursive: true });
		if (!isModsRoot(target)) {
			throw error;
		}
	}
}

/**
 * Removes one sibling copy when nobody has staged it for a day. Best-effort: a
 * copy that cannot be read or removed is left for the next launch.
 * @param sibling - The sibling copy's path.
 * @param now - Current time, in epoch milliseconds.
 * @returns True when the copy was removed.
 */
function removeIfStale(sibling: string, now: number): boolean {
	try {
		if (now - statSync(sibling).mtimeMs <= STALE_COPY_MS) {
			return false;
		}
		rmSync(sibling, { force: true, recursive: true });
		return true;
	} catch {
		return false;
	}
}

/**
 * Removes the sibling copies nobody has staged for a day.
 * @param stagingParent - Directory every staged copy lives in.
 * @param keep - Name of the copy this process uses.
 * @param now - Current time, in epoch milliseconds.
 */
function pruneStaleCopies(
	stagingParent: string,
	keep: string,
	now: number,
): void {
	for (const name of readdirSync(stagingParent)) {
		if (name !== keep) {
			removeIfStale(path.join(stagingParent, name), now);
		}
	}
}

/**
 * Copies a mods plugin into `<stagingParent>/<content-hash>/`, reusing a copy
 * already at that hash, and prunes stale siblings.
 * @param sourceRoot - The shipped plugin root.
 * @param stagingParent - Writable directory every staged copy lives in.
 * @param now - Current time, in epoch milliseconds.
 * @returns The staged plugin root.
 */
export function stageAgentMods(
	sourceRoot: string,
	stagingParent: string,
	now: number = Date.now(),
): string {
	const files = readPluginFiles(sourceRoot);
	const name = hashPluginFiles(files);
	const target = path.join(stagingParent, name);
	mkdirSync(stagingParent, { recursive: true });
	if (existsSync(target) && !isModsRoot(target)) {
		rmSync(target, { force: true, recursive: true });
	}
	if (!existsSync(target)) {
		writeStagedCopy(files, stagingParent, target);
	}
	const touchedAt = new Date(now);
	utimesSync(target, touchedAt, touchedAt);
	pruneStaleCopies(stagingParent, name, now);
	return target;
}

/**
 * Resolves the staged mods plugin root for this process: the first candidate
 * that holds a complete plugin, staged once and memoized. Any failure is logged
 * and contributes nothing, so the session launches as it would without mods.
 * @param sourceCandidates - Where the shipped plugin may live, most authoritative first.
 * @param stagingParent - Writable directory every staged copy lives in.
 * @returns The staged root, or null when there is none to hand over.
 */
export function readStagedAgentMods(
	sourceCandidates: readonly string[],
	stagingParent: string,
): string | null {
	const key = [...sourceCandidates, stagingParent].join('\0');
	if (stagedRoots.has(key)) {
		return stagedRoots.get(key) ?? null;
	}
	const sourceRoot = sourceCandidates.find(isModsRoot);
	let staged: string | null = null;
	try {
		staged = sourceRoot ? stageAgentMods(sourceRoot, stagingParent) : null;
	} catch (error) {
		console.warn('[agent-skills] could not stage the Claude Code mods.', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
	stagedRoots.set(key, staged);
	return staged;
}
