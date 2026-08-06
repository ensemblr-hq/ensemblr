/** Maximum allowed length of a workspace display name. */
export const WORKSPACE_NAME_MAX_LENGTH = 100;

/** Characters allowed in a workspace name. */
export const WORKSPACE_NAME_PATTERN = /^[A-Za-z0-9 ._-]+$/;

const DISALLOWED_RUN = /[^A-Za-z0-9 ._-]+/g;
const WHITESPACE_RUN = /\s+/g;
const LEADING_DOTS = /^\.+/;

/**
 * Rewrites arbitrary external text — a branch name, a pull-request title — into
 * a workspace display name the create and rename services accept.
 *
 * Every source label that reaches workspace creation comes from somewhere that
 * allows characters a workspace name may not: branches carry `/`, and pull
 * requests routinely carry `feat(scope):` or `[WIP]`. Passing one through raw
 * fails creation with `name-invalid` before git is ever reached, so callers
 * sanitize here rather than at each picker.
 * @param raw - The external label to convert.
 * @returns An accepted display name, or null when nothing usable survives and
 * the caller should fall back to a generated placeholder.
 */
export function toWorkspaceDisplayName(raw: string): string | null {
	const spaced = raw
		.replace(DISALLOWED_RUN, ' ')
		.replace(WHITESPACE_RUN, ' ')
		.trim();
	const undotted = spaced.replace(LEADING_DOTS, '').trim();
	return truncateAtWord(undotted) || null;
}

/**
 * Shortens a name to the accepted length, preferring the last whole word so a
 * truncated title does not trail a stray letter. A single token longer than the
 * limit is cut hard, since there is no boundary to fall back to.
 * @param name - The sanitized, already-trimmed name.
 * @returns The name, shortened when it exceeds the limit.
 */
function truncateAtWord(name: string): string {
	if (name.length <= WORKSPACE_NAME_MAX_LENGTH) {
		return name;
	}
	const clipped = name.slice(0, WORKSPACE_NAME_MAX_LENGTH);
	const lastSpace = clipped.lastIndexOf(' ');
	return (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd();
}
