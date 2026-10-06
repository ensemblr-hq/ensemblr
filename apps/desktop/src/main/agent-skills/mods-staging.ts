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
 * a fresh one rather than a copy Claude has already written into. Because that
 * directory is writable by anything the user runs, a copy is rehashed before it
 * is handed over again and replaced when it no longer matches its name.
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

/**
 * Directory Claude Code writes type declarations into whenever it loads the
 * plugin. Left out of the hash and the copy, like {@link ENGINE_WRITTEN_FILE},
 * so a copy Claude has loaded still verifies and a development checkout Claude
 * once loaded in place hashes as it ships.
 */
const ENGINE_WRITTEN_DIRECTORY = '.claude-plugin/types';

/** Root file Claude Code writes whenever it loads the plugin. */
const ENGINE_WRITTEN_FILE = 'tsconfig.json';

/** Name prefix of a directory a fresh copy is written into before it is renamed into place. */
const STAGING_PREFIX = '.staging-';

/** Name prefix of a tampered copy moved aside so its replacement can take its name. */
const DISCARD_PREFIX = '.discard-';

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

/**
 * Staged roots already resolved in this process, keyed by sources and
 * destination. Only a successful staging is remembered, so a failure is retried.
 */
const stagedRoots = new Map<string, string>();

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
 * Whether a path relative to the plugin root is left out of the hash and the
 * copy: test-only files, and what Claude Code writes into a plugin it loads.
 * @param relativePath - POSIX path relative to the root.
 * @returns True for anything under `tests/` or `.claude-plugin/types/`, any
 *   `*.test.ts`, and the root `tsconfig.json`.
 */
function isLeftBehind(relativePath: string): boolean {
	return (
		relativePath.split('/')[0] === TESTS_DIRECTORY ||
		relativePath.endsWith(TEST_FILE_SUFFIX) ||
		relativePath === ENGINE_WRITTEN_FILE ||
		relativePath === ENGINE_WRITTEN_DIRECTORY ||
		relativePath.startsWith(`${ENGINE_WRITTEN_DIRECTORY}/`)
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
		if (isLeftBehind(relativePath)) {
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
 * Whether a staged copy still holds exactly what it was staged from: its
 * directory is named after the content hash, so the copy is rehashed with the
 * same walk and compared against its own name. The copy lives in a
 * user-writable directory, and an edited hook would otherwise disable a guard
 * for every later session.
 * @param target - The staged copy.
 * @returns True when the copy is a complete plugin whose content matches its name.
 */
function isIntactCopy(target: string): boolean {
	try {
		return (
			isModsRoot(target) &&
			hashPluginFiles(readPluginFiles(target)) === path.basename(target)
		);
	} catch {
		return false;
	}
}

/**
 * A fresh sibling path beside a staged copy, for a copy being written or one
 * being discarded.
 * @param target - The staged copy.
 * @param prefix - {@link STAGING_PREFIX} or {@link DISCARD_PREFIX}.
 * @returns A path in the same directory that nothing else uses.
 */
function siblingPath(target: string, prefix: string): string {
	return path.join(
		path.dirname(target),
		`${prefix}${path.basename(target)}-${randomUUID()}`,
	);
}

/**
 * Renames a fully written copy onto the target, moving a tampered copy aside
 * first because a directory cannot be renamed over a non-empty one.
 * @param temporary - The fully written copy.
 * @param target - Final directory of this copy.
 */
function swapIntoPlace(temporary: string, target: string): void {
	if (!existsSync(target)) {
		renameSync(temporary, target);
		return;
	}
	const discarded = siblingPath(target, DISCARD_PREFIX);
	renameSync(target, discarded);
	renameSync(temporary, target);
	rmSync(discarded, { force: true, recursive: true });
}

/**
 * Writes the files into a fresh directory beside the target and renames it into
 * place, replacing whatever is there, so a session never sees a half-written
 * copy. Losing the rename to another process that staged an intact copy first
 * is not a failure.
 * @param files - The plugin's files.
 * @param target - Final directory of this copy.
 */
function writeStagedCopy(files: readonly PluginFile[], target: string): void {
	const temporary = siblingPath(target, STAGING_PREFIX);
	try {
		for (const { bytes, relativePath } of files) {
			const destination = path.join(temporary, ...relativePath.split('/'));
			mkdirSync(path.dirname(destination), { recursive: true });
			writeFileSync(destination, bytes);
		}
		swapIntoPlace(temporary, target);
	} catch (error) {
		rmSync(temporary, { force: true, recursive: true });
		if (!isIntactCopy(target)) {
			throw error;
		}
	}
}

/**
 * Marks a staged copy as in use, so no process prunes it as stale.
 * @param target - The staged copy.
 * @param now - Current time, in epoch milliseconds.
 */
function touchCopy(target: string, now: number): void {
	const touchedAt = new Date(now);
	utimesSync(target, touchedAt, touchedAt);
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
 * already at that hash only when its content still matches, and prunes stale
 * siblings.
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
	if (!isIntactCopy(target)) {
		writeStagedCopy(files, target);
	}
	touchCopy(target, now);
	pruneStaleCopies(stagingParent, name, now);
	return target;
}

/**
 * Re-checks a copy this process staged earlier and marks it in use, so a
 * long-running process keeps it alive against the prune and never hands over a
 * copy that was deleted or edited since.
 * @param target - The memoized staged copy.
 * @returns True when the copy is intact and was touched.
 */
function revalidateCopy(target: string): boolean {
	if (!isIntactCopy(target)) {
		return false;
	}
	try {
		touchCopy(target, Date.now());
		return true;
	} catch {
		return false;
	}
}

/**
 * Stages the first candidate that holds a complete plugin. Any failure is
 * logged and contributes nothing.
 * @param sourceCandidates - Where the shipped plugin may live, most authoritative first.
 * @param stagingParent - Writable directory every staged copy lives in.
 * @returns The staged root, or null when there is none to hand over.
 */
function stageFirstCandidate(
	sourceCandidates: readonly string[],
	stagingParent: string,
): string | null {
	const sourceRoot = sourceCandidates.find(isModsRoot);
	if (!sourceRoot) {
		return null;
	}
	try {
		return stageAgentMods(sourceRoot, stagingParent);
	} catch (error) {
		console.warn('[agent-skills] could not stage the Claude Code mods.', {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Resolves the staged mods plugin root for this process: the first candidate
 * that holds a complete plugin, staged once and memoized. Every call re-checks
 * the memoized copy and stages again when it is gone or altered; a failure is
 * never memoized, so the next call retries it. A failure contributes nothing, so
 * the session launches as it would without mods.
 * @param sourceCandidates - Where the shipped plugin may live, most authoritative first.
 * @param stagingParent - Writable directory every staged copy lives in.
 * @returns The staged root, or null when there is none to hand over.
 */
export function readStagedAgentMods(
	sourceCandidates: readonly string[],
	stagingParent: string,
): string | null {
	const key = [...sourceCandidates, stagingParent].join('\0');
	const memoized = stagedRoots.get(key);
	if (memoized !== undefined && revalidateCopy(memoized)) {
		return memoized;
	}
	stagedRoots.delete(key);
	const staged = stageFirstCandidate(sourceCandidates, stagingParent);
	if (staged !== null) {
		stagedRoots.set(key, staged);
	}
	return staged;
}
