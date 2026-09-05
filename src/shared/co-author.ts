/**
 * The co-author identity Ensemblr credits itself with, and the commit trailer
 * built from it.
 *
 * GitHub attributes a co-author by matching the trailer's email against an
 * account, so the address is load-bearing rather than decorative: it belongs to
 * the `ensemblr-dev` user account (id 325224161), where it is the public — and
 * therefore verified — address. An organization address would render the same
 * line and earn nothing, because organizations are never credited as co-authors.
 */

/** Display name in the trailer, matching the `ensemblr-dev` account's name. */
export const ENSEMBLR_CO_AUTHOR_NAME = 'Ensemblr';

/** Public, verified address on the `ensemblr-dev` GitHub user account. */
export const ENSEMBLR_CO_AUTHOR_EMAIL = 'howdy@ensemblr.dev';

/**
 * The finished trailer line. Composed from the two constants above rather than
 * written out again so the identity has exactly one definition.
 */
export const ENSEMBLR_CO_AUTHOR_TRAILER = `Co-authored-by: ${ENSEMBLR_CO_AUTHOR_NAME} <${ENSEMBLR_CO_AUTHOR_EMAIL}>`;

/**
 * The trailers a commit should carry, as a list so a caller can spread it into a
 * git argv without branching on whether the setting is on.
 * @param enabled - Whether the user opted into crediting Ensemblr.
 * @returns The trailer lines to append, empty when the setting is off.
 */
export function buildCoAuthorTrailers(enabled: boolean): string[] {
	return enabled ? [ENSEMBLR_CO_AUTHOR_TRAILER] : [];
}
