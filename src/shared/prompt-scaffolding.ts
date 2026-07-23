/**
 * Single source of truth for the prompt-scaffolding markers the composer wraps a
 * user's message in: the referenced-folders header, `<user_preferences>` blocks,
 * and `<attached_file>` blocks. The renderer composes prompts with these markers
 * and parses them back out; the main process strips them when deriving a tab
 * title. Both runtimes import from here so a wording change stays in sync across
 * the process boundary instead of silently leaking scaffolding into titles.
 */

/** Header line the composer prepends before a list of `@folder` references. */
export const REFERENCED_FOLDERS_HEADER = 'Referenced workspace folders:';

/** Tag wrapping the injected `general` master prompt (the user's preferences). */
export const USER_PREFERENCES_TAG = 'user_preferences';

/** Tag wrapping an inlined workspace file or composed action attachment. */
const ATTACHED_FILE_TAG = 'attached_file';

/**
 * Wraps a file's content in the shared `<attached_file>` envelope, escaping
 * double quotes in the path so the marker stays parseable. Callers pass content
 * already truncated to their own budget.
 * @param path - Workspace-relative path the content came from.
 * @param content - The (already size-bounded) content to embed.
 * @returns The `<attached_file>` block for the given path and content.
 */
export function formatAttachedFileBlock(path: string, content: string): string {
	const safePath = path.replaceAll('"', '&quot;');
	return `<${ATTACHED_FILE_TAG} path="${safePath}">\n${content}\n</${ATTACHED_FILE_TAG}>`;
}

/**
 * Fresh global regex matching every `<attached_file>` block; capture group 1 is
 * the raw path attribute and group 2 the block content. Returned fresh per call
 * so callers never share a stateful `lastIndex`.
 * @returns A new `RegExp` for `<attached_file>` blocks.
 */
export function attachedFileBlockPattern(): RegExp {
	return new RegExp(
		`<${ATTACHED_FILE_TAG} path="([^"]*)">\\n([\\s\\S]*?)\\n</${ATTACHED_FILE_TAG}>`,
		'g',
	);
}

/**
 * Fresh global regex matching every `<user_preferences>` block, with the block
 * body in capture group 1. Returned fresh per call to avoid a shared `lastIndex`.
 * @returns A new `RegExp` for `<user_preferences>` blocks.
 */
export function userPreferencesBlockPattern(): RegExp {
	return new RegExp(
		`<${USER_PREFERENCES_TAG}>\\n([\\s\\S]*?)\\n</${USER_PREFERENCES_TAG}>`,
		'g',
	);
}

/**
 * Fresh start-anchored regex matching a leading referenced-folders block, with
 * the `@folder` lines in capture group 1. Non-global: it extracts the single
 * block the composer places at the top of a message.
 * @returns A new `RegExp` anchored to a leading referenced-folders block.
 */
export function leadingReferencedFoldersPattern(): RegExp {
	return new RegExp(`^${REFERENCED_FOLDERS_HEADER}\\n((?:@[^\\n]+\\n?)+)\\s*`);
}

/**
 * Fresh global regex matching a referenced-folders block anywhere in the text,
 * for stripping interleaved blocks a start-anchored pattern would miss.
 * @returns A new global `RegExp` for referenced-folders blocks.
 */
export function referencedFoldersBlockPattern(): RegExp {
	return new RegExp(
		`${REFERENCED_FOLDERS_HEADER}\\n(?:@[^\\n]+\\n?)+\\s*`,
		'g',
	);
}
