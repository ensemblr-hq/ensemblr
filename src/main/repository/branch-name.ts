/**
 * Git-ref helpers owned by the main process: continuation-branch naming and ref
 * parsing. Prefix/slug composition lives in `src/shared/branch-name.ts` because
 * the renderer's rename dialog composes the same names.
 */

/**
 * Trailing `-v<n>` continuation marker, matching the dash the branch slug
 * already separates words with. A branch that legitimately ends in `-v<n>` —
 * `bump-eslint-v9` — is read as a marker and bumped rather than re-marked.
 * Bounded to nine digits so a parsed version always stays a safe integer.
 */
const CONTINUATION_SUFFIX_PATTERN = /-v(\d{1,9})$/;

/** Prefix every local branch ref carries. */
const LOCAL_REF_PREFIX = 'refs/heads/';

/** Prefix every remote-tracking ref carries, ahead of its `<remote>/` segment. */
const REMOTE_REF_PREFIX = 'refs/remotes/';

/** Symbolic remote-tracking ref that names a default branch rather than a branch. */
const REMOTE_HEAD_REF = 'HEAD';

/**
 * Names the branch a workspace continues onto after its pull request merged:
 * the current name plus a `-v<n>` marker, bumping an existing marker rather
 * than stacking a second one. Skips names already taken so a repeat continue
 * never collides with a branch left behind by an earlier one.
 * @param branchName - Branch the workspace is currently on.
 * @param existingBranches - Branch names already present in the repository, local and remote-tracking alike.
 * @returns The next unused continuation branch name.
 */
export function nextContinuationBranchName(
	branchName: string,
	existingBranches: Iterable<string>,
): string {
	const taken = new Set(existingBranches);
	const marker = CONTINUATION_SUFFIX_PATTERN.exec(branchName);
	const base = marker ? branchName.slice(0, marker.index) : branchName;
	let version = marker ? Number.parseInt(marker[1], 10) + 1 : 1;
	while (taken.has(`${base}-v${version}`)) {
		version += 1;
	}
	return `${base}-v${version}`;
}

/**
 * Reduces a full git ref to the branch name a continuation could collide with,
 * so `refs/heads/bach` and `refs/remotes/origin/bach` both rule out `bach`.
 * A remote-tracking `HEAD` names its remote's default branch rather than a
 * branch of its own, so it claims nothing.
 * @param ref - Full ref path as reported by `git for-each-ref`.
 * @returns The bare branch name, or `null` when the ref claims no name.
 */
export function branchNameFromRef(ref: string): string | null {
	const trimmed = ref.trim();
	if (trimmed.startsWith(LOCAL_REF_PREFIX)) {
		return trimmed.slice(LOCAL_REF_PREFIX.length) || null;
	}
	if (!trimmed.startsWith(REMOTE_REF_PREFIX)) {
		return null;
	}
	const withoutPrefix = trimmed.slice(REMOTE_REF_PREFIX.length);
	const remoteSeparator = withoutPrefix.indexOf('/');
	if (remoteSeparator <= 0) {
		return null;
	}
	const branch = withoutPrefix.slice(remoteSeparator + 1);
	return branch && branch !== REMOTE_HEAD_REF ? branch : null;
}
