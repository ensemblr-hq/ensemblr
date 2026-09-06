/** Why a git ref was rejected; callers map this onto their own diagnostic codes. */
export type GitRefRejectionReason = 'empty' | 'invalid-chars' | 'too-long';

/** A rejected git ref, carrying both the machine code and the wording to show. */
export interface GitRefRejection {
	message: string;
	reason: GitRefRejectionReason;
}

/** Longest ref Ensemblr accepts, matching git's own ref-name budget. */
export const GIT_REF_MAX_LENGTH = 255;

/**
 * Rejects refs git would refuse, plus refs that would make a later git
 * invocation do something other than read the ref.
 *
 * A ref reaching this function is not always one the user typed:
 * `create-workspace` validates the `branchFrom` recorded in a repository's
 * committed `.ensemblr/settings.toml`, which outranks the user's own setting,
 * so the value can belong to whoever wrote the repository. `ensureBaseRefAvailable`
 * then splits it at the first `/` and passes remote and tail to `git fetch` as
 * separate argv entries, which is where each test below earns its place:
 *
 * - The leading-dash test runs per `/`-separated segment rather than on the
 *   whole ref, because `origin/--upload-pack=…` clears a whole-ref check and
 *   still lands where git reads it as an option.
 * - `:` would make the tail a *writing* refspec — `origin/+main:refs/heads/master`
 *   force-updates a local branch — and would make the leading segment an
 *   scp-style URL pointing at a host of the author's choosing.
 * - `~` and `^` turn the argument into a revision expression, and `?`, `*` and
 *   `[` into a glob, so the ref that resolves is not the ref that was named.
 * @param ref - The candidate ref, remote-qualified or bare.
 * @returns The rejection when the ref is unusable, otherwise null.
 */
export function validateGitRef(ref: string): GitRefRejection | null {
	if (!ref) {
		return { message: 'Enter a branch name.', reason: 'empty' };
	}
	if (ref.length > GIT_REF_MAX_LENGTH) {
		return {
			message: `Branch names must be ${GIT_REF_MAX_LENGTH} characters or fewer.`,
			reason: 'too-long',
		};
	}
	if (hasInvalidCharacters(ref) || ref.split('/').some(looksLikeOption)) {
		return {
			message: 'Branch name contains invalid characters.',
			reason: 'invalid-chars',
		};
	}
	return null;
}

/**
 * Whitespace plus the punctuation `git check-ref-format` forbids in a ref name:
 * `:`, `?`, `*`, `[`, `\`, `^`, `~`. The class reads awkwardly because the
 * literal `[` may not be escaped inside one — Biome's `noUselessEscapeInRegex`
 * rejects `\[` there — so the list above is the readable copy of it.
 *
 * Refusing all of them rather than only the characters with a known exploit is
 * what keeps the guard from needing a new case each time a caller finds another
 * place to spend a ref. Git's remaining rules — control characters, `@{`, a
 * `.lock` suffix, a lone `@` — are left to git, because a ref breaking one of
 * those fails to resolve rather than changing what the command does.
 */
const FORBIDDEN_REF_CHARACTERS = /[\s:?*[\\^~]/;

/**
 * Tests for characters git rejects outright or that carry refspec, revision, or
 * glob semantics a ref must not smuggle into a later git argument.
 * @param ref - The candidate ref.
 * @returns True when the ref contains a character it may not.
 */
function hasInvalidCharacters(ref: string): boolean {
	return FORBIDDEN_REF_CHARACTERS.test(ref) || ref.includes('..');
}

/**
 * Tests whether a ref segment would be read as a command-line option once git
 * receives it as a standalone argument.
 * @param segment - One `/`-separated component of a ref.
 * @returns True when the segment begins with a dash.
 */
function looksLikeOption(segment: string): boolean {
	return segment.startsWith('-');
}
