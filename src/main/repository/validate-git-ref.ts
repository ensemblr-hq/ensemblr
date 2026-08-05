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
 * Rejects refs git would refuse, plus refs that could smuggle an option into a
 * later git invocation.
 *
 * The leading-dash test runs per `/`-separated segment, not just on the whole
 * ref: `ensureBaseRefAvailable` splits a qualified ref and passes the tail to
 * `git fetch <remote> <branch>` as its own argv entry, so `origin/--upload-pack=…`
 * would clear a whole-ref check and still land where git reads it as an option.
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
 * Tests for characters git rejects outright or that carry range semantics a ref
 * must not smuggle into a rev-parse argument.
 * @param ref - The candidate ref.
 * @returns True when the ref contains a character it may not.
 */
function hasInvalidCharacters(ref: string): boolean {
	return /\s/.test(ref) || ref.includes('..');
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
