/**
 * Splits a persisted user prompt text into the leading `<attached_file>`
 * markers and the trailing user-typed message.
 *
 * The composer serializes mention/upload attachments as
 * `<attached_file path="...">content</attached_file>` blocks prepended to the
 * user's typed text (see `formatAttachedFileSection`). The renderer round-trips
 * the same shape from the persisted event stream, so we extract the leading
 * blocks here and surface them as chips.
 */

export interface ParsedPromptAttachment {
	content: string;
	path: string;
}

export interface ParsedPrompt {
	attachments: readonly ParsedPromptAttachment[];
	text: string;
}

const ATTACHED_FILE_PATTERN =
	/^<attached_file path="([^"]*)">\n([\s\S]*?)\n<\/attached_file>\s*/;

const REFERENCED_FOLDERS_PATTERN =
	/^Referenced workspace folders:\n((?:@[^\n]+\n?)+)\s*/;

export function parsePromptAttachments(prompt: string): ParsedPrompt {
	let remaining = prompt;
	const attachments: ParsedPromptAttachment[] = [];

	const folderMatch = REFERENCED_FOLDERS_PATTERN.exec(remaining);
	if (folderMatch) {
		const block = folderMatch[1] ?? '';
		const paths = block
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.startsWith('@'))
			.map((line) => line.slice(1));
		for (const path of paths) {
			attachments.push({ content: '', path });
		}
		remaining = remaining.slice(folderMatch[0].length);
	}

	while (true) {
		const match = ATTACHED_FILE_PATTERN.exec(remaining);
		if (!match) {
			break;
		}
		const decodedPath = (match[1] ?? '').replaceAll('&quot;', '"');
		attachments.push({
			content: match[2] ?? '',
			path: decodedPath,
		});
		remaining = remaining.slice(match[0].length);
	}

	return { attachments, text: remaining.trim() };
}

/** Convenience: just the chip-displayable path basename. */
export function chipLabelForPath(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	const idx = trimmed.lastIndexOf('/');
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
