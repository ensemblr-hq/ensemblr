/**
 * Single source of truth for the prompt-scaffolding markers the composer wraps a
 * user's message in: the referenced-folders and linked-directories headers,
 * `<user_preferences>` blocks, and `<attached_file>` blocks. The renderer composes prompts with these markers
 * and parses them back out; the main process strips them when deriving a tab
 * title. Both runtimes import from here so a wording change stays in sync across
 * the process boundary instead of silently leaking scaffolding into titles.
 */

import {
	formatBlockAttributes,
	readBlockAttributes,
} from './block-attributes.ts';

/** Header line the composer prepends before a list of `@folder` references. */
export const REFERENCED_FOLDERS_HEADER = 'Referenced workspace folders:';

/** Header used by the legacy absolute-path linked-directory preamble. */
const LEGACY_LINKED_DIRECTORIES_HEADER = 'Linked directories:';

/** Tag wrapping the current linked-directory prompt context. */
const LINKED_DIRECTORIES_TAG = 'linked_directories';

/** Agent guidance accompanying the linked-directory paths. */
const LINKED_DIRECTORIES_INSTRUCTIONS =
	'User-linked external reference directories. Read relevant files using absolute paths. Their contents are not copied here. This does not grant blanket permission to write. The workspace remains your cwd, and ordinary permissions still apply.';

/** Tag wrapping the injected `general` master prompt (the user's preferences). */
export const USER_PREFERENCES_TAG = 'user_preferences';

/**
 * Header injected before the user's per-action preferences, telling the agent
 * those preferences win over the built-in base prompt. Mirrors
 * `base-prompt-examples/user-settings-addon.md`.
 *
 * Shared rather than renderer-private because main composes the same review
 * prompt for `startReview` that the Review button composes in the renderer, and
 * a second copy of this header would drift the moment either was reworded.
 */
export const USER_PREF_ADDON =
	"IMPORTANT: The following are the user's custom preferences. These preferences take precedence over any default guidelines or instructions above. When there is a conflict, always follow the user's preferences.";

/** Tag wrapping an inlined workspace file or composed action attachment. */
const ATTACHED_FILE_TAG = 'attached_file';

/**
 * Substitutes the `${…}` fields a base prompt references, leaving any field the
 * caller did not supply spelled as it was written.
 *
 * Leaving an unknown field alone rather than blanking it is what keeps a prompt
 * that mentions a placeholder the caller has no value for readable: an empty
 * string reads as a missing sentence, while the token itself reads as a gap.
 * @param template - The base prompt carrying `${FIELD}` placeholders.
 * @param fields - Values to substitute, keyed by field name.
 * @returns The interpolated prompt.
 */
export function interpolatePromptFields(
	template: string,
	fields: Record<string, string>,
): string {
	return template.replaceAll(/\$\{(\w+)\}/g, (match, key: string) =>
		key in fields ? fields[key] : match,
	);
}

/**
 * What a chip stood for when the message was sent, beyond the path it was read
 * from. A `.context/` document is addressed by a generated filename, so a
 * transcript, a tracker issue, a patch, and a review comment all read back as an
 * anonymous `<uuid>.md` unless the block carries what the user actually saw.
 *
 * Both fields are optional and omitted when they add nothing: an ordinary
 * `@src/foo.ts` mention is already named by its own basename, and spending
 * prompt bytes to repeat it would change what every agent sees for no gain.
 */
export interface AttachedFileDescriptor {
	/** Human-readable name the chip showed, when it is not the path's basename. */
	label?: string;
	/** Opaque glyph token the renderer maps back to a mark; see `AttachmentMark`. */
	mark?: string;
}

/**
 * Escapes the one character that could end the `path` attribute early.
 *
 * The path is deliberately *not* run through the shared `escapeBlockAttribute`:
 * it is captured as `([^"]*)`, which already tolerates `&`, `<`, and `>`, and
 * entity-escaping those would hand the agent a filename that does not exist.
 * The whole point of the block is to name a file the agent can go and read, so
 * `docs/Q&A.md` has to reach it spelled that way.
 * @param path - The raw path.
 * @returns The path with its quotes entity-escaped.
 */
function escapeAttachedFilePath(path: string): string {
	return path.replaceAll('"', '&quot;');
}

/**
 * Reads a path back, undoing {@link escapeAttachedFilePath}. Narrow by design:
 * a block persisted before descriptors existed escaped its path the same way, so
 * one grammar covers both.
 * @param rawPath - The escaped path attribute.
 * @returns The original path.
 */
function unescapeAttachedFilePath(rawPath: string): string {
	return rawPath.replaceAll('&quot;', '"');
}

/**
 * Wraps a file's content in the shared `<attached_file>` envelope, escaping each
 * attribute for the grammar it sits in so the marker stays parseable. Callers
 * pass content already truncated to their own budget.
 *
 * `path` is always written, even when empty: {@link attachedFileBlockPattern}
 * requires it, so omitting it would emit a block nothing can match — and an
 * unmatched block is one the title deriver cannot strip.
 * @param path - Workspace-relative path the content came from.
 * @param content - The (already size-bounded) content to embed.
 * @param descriptor - What the chip showed, for a path that does not name itself.
 * @returns The `<attached_file>` block for the given path and content.
 */
export function formatAttachedFileBlock(
	path: string,
	content: string,
	descriptor: AttachedFileDescriptor = {},
): string {
	const descriptorRun = formatBlockAttributes([
		['label', descriptor.label ?? ''],
		['mark', descriptor.mark ?? ''],
	]);
	const attributes = `path="${escapeAttachedFilePath(path)}"${
		descriptorRun ? ` ${descriptorRun}` : ''
	}`;
	return `<${ATTACHED_FILE_TAG} ${attributes}>\n${content}\n</${ATTACHED_FILE_TAG}>`;
}

/**
 * Fresh global regex matching every `<attached_file>` block: capture group 1 is
 * the raw path, group 2 the rest of the attribute run, and group 3 the block
 * content. Returned fresh per call so callers never share a stateful
 * `lastIndex`.
 *
 * The trailing run is optional, so a block persisted before descriptors existed
 * still matches and still yields its path and content.
 * @returns A new `RegExp` for `<attached_file>` blocks.
 */
export function attachedFileBlockPattern(): RegExp {
	return new RegExp(
		`<${ATTACHED_FILE_TAG} path="([^"]*)"([^>]*)>\\n([\\s\\S]*?)\\n</${ATTACHED_FILE_TAG}>`,
		'g',
	);
}

/**
 * Reads an `<attached_file>` block's path and descriptor back out of the two
 * attribute capture groups {@link attachedFileBlockPattern} produces.
 * @param rawPath - Capture group 1, the escaped path.
 * @param rawAttributes - Capture group 2, the rest of the attribute run.
 * @returns The path plus whatever descriptor fields the block carried.
 */
export function parseAttachedFileAttributes(
	rawPath: string,
	rawAttributes: string,
): AttachedFileDescriptor & { path: string } {
	const values = readBlockAttributes(rawAttributes);
	const label = values.get('label');
	const mark = values.get('mark');
	return {
		...(label ? { label } : {}),
		...(mark ? { mark } : {}),
		path: unescapeAttachedFilePath(rawPath),
	};
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
 * Fresh global regex matching a referenced-folders block wherever it appears,
 * with the `@folder` lines in capture group 1. Not start-anchored: a chip sits
 * where the user put it, so the block can open a message or fall mid-sentence.
 * @returns A new global `RegExp` for referenced-folders blocks.
 */
export function referencedFoldersBlockPattern(): RegExp {
	return new RegExp(
		`${REFERENCED_FOLDERS_HEADER}\\n((?:@[^\\n]+\\n?)+)\\s*`,
		'g',
	);
}

/**
 * Serializes linked directories into a bounded prompt block. JSON preserves
 * every path byte while the fixed guidance explains that these are standing,
 * read-oriented references rather than inlined attachments or a write grant.
 * @param paths - Absolute linked-directory paths for this chat.
 * @returns The linked-directory prompt block.
 */
export function formatLinkedDirectoriesBlock(paths: readonly string[]): string {
	return `<${LINKED_DIRECTORIES_TAG}>\n${JSON.stringify(paths)}\n${LINKED_DIRECTORIES_INSTRUCTIONS}\n</${LINKED_DIRECTORIES_TAG}>`;
}

/**
 * Fresh global regex matching current linked-directory blocks, with the JSON
 * path array in capture group 1. A closing tag bounds the context so a slash in
 * the following user message can never be consumed as another directory.
 * @returns A new global `RegExp` for current linked-directory blocks.
 */
export function linkedDirectoriesBlockPattern(): RegExp {
	return /<linked_directories>\n(\[[^\n]*\])\n[\s\S]*?\n<\/linked_directories>/g;
}

/**
 * Parses the JSON path-array capture from {@link linkedDirectoriesBlockPattern}.
 * @param serializedPaths - The JSON line inside a linked-directory block.
 * @returns The lossless paths, or null when the block is malformed.
 */
export function parseLinkedDirectoriesPaths(
	serializedPaths: string,
): readonly string[] | null {
	try {
		const parsed: unknown = JSON.parse(serializedPaths);
		return Array.isArray(parsed) &&
			parsed.every((path) => typeof path === 'string')
			? parsed
			: null;
	} catch {
		return null;
	}
}

/**
 * Fresh global regex matching the unbounded legacy header and absolute paths.
 * New prompts use {@link linkedDirectoriesBlockPattern}; this survives only so
 * persisted histories remain legible.
 * @returns A new global `RegExp` for legacy linked-directory blocks.
 */
export function legacyLinkedDirectoriesBlockPattern(): RegExp {
	return new RegExp(
		`${LEGACY_LINKED_DIRECTORIES_HEADER}\\n((?:/[^\\n]+\\n?)+)\\s*`,
		'g',
	);
}
