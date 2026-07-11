import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dependency manifests whose contents pin a workspace's dependency graph,
 * spanning the ecosystems Ensemblr worktrees commonly use. Every candidate
 * present in the worktree feeds the setup fingerprint, so a change to any one of
 * them re-triggers setup; a polyglot repo with several manifests is covered by
 * all of them at once. Kept in a fixed order so the fingerprint is stable
 * regardless of filesystem iteration order.
 */
const LOCKFILE_CANDIDATES = [
	'package-lock.json',
	'npm-shrinkwrap.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'bun.lock',
	'bun.lockb',
	'Cargo.lock',
	'poetry.lock',
	'Pipfile.lock',
	'uv.lock',
	'requirements.txt',
	'go.sum',
	'Gemfile.lock',
	'composer.lock',
	'mix.lock',
	'pubspec.lock',
	'Package.resolved',
	'gradle.lockfile',
] as const;

/**
 * Reads a lockfile's raw bytes from a worktree, returning null when it is
 * absent or unreadable. Bytes (not decoded text) so binary lockfiles such as
 * `bun.lockb` fingerprint faithfully.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param candidate - Lockfile name to read, relative to the worktree root.
 * @returns The file bytes, or null when the candidate is missing or unreadable.
 */
function readLockfile(worktreePath: string, candidate: string): Buffer | null {
	try {
		return readFileSync(join(worktreePath, candidate));
	} catch {
		return null;
	}
}

/**
 * Computes a stable fingerprint of a workspace's setup inputs: the setup command
 * plus the contents of every dependency lockfile present in the worktree. Two
 * runs with the same command and unchanged lockfiles share a fingerprint, so
 * setup can be skipped; adding, removing, or editing any covered lockfile
 * changes it, so setup re-runs. When no lockfile is present the fingerprint
 * covers the command alone, so setup runs once and is remembered thereafter.
 *
 * The fingerprint is declarative — it tracks the dependencies a project
 * *declares*, not what is installed on disk. Deleting an install directory
 * (e.g. `node_modules`) without touching a lockfile does not change it, so a
 * manual reinstall must be triggered explicitly in that case.
 * @param options - The worktree path and the resolved setup command.
 * @returns A hex-encoded SHA-256 fingerprint.
 */
export function computeSetupFingerprint({
	command,
	worktreePath,
}: {
	command: string;
	worktreePath: string;
}): string {
	const hash = createHash('sha256').update(command);

	for (const candidate of LOCKFILE_CANDIDATES) {
		const contents = readLockfile(worktreePath, candidate);

		if (contents === null) {
			continue;
		}

		hash.update('\0').update(candidate).update('\0').update(contents);
	}

	return hash.digest('hex');
}
