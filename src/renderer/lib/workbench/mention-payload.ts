import { readWorkspaceFile } from '@/renderer/api/ensemble-queries';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

/** Wraps one workspace file's content in an explicit attachment marker. */
export function formatAttachedFileSection(
	pathValue: string,
	content: string,
): string {
	const safePath = pathValue.replaceAll('"', '&quot;');
	return `<attached_file path="${safePath}">\n${content}\n</attached_file>`;
}

/**
 * Formats the selected @ mentions (workspace files + directories) into the
 * text payload that gets appended to the user's prompt when sent to Pi.
 *
 * Reads each file mention via IPC and inlines its content in a fenced
 * `<attached_file>` block. Directories are surfaced as a separate header so
 * Pi knows the user referenced them without expecting inline content.
 *
 * Throws when a file read fails, so the caller can surface the error to the
 * user before clearing the composer.
 */
export async function formatMentionAttachmentText({
	mentions,
	workspaceCwd,
}: {
	mentions: readonly WorkspaceFileSummary[];
	workspaceCwd: string;
}): Promise<string> {
	if (mentions.length === 0) {
		return '';
	}

	const sections: string[] = [];
	const directoryRefs = mentions.filter((entry) => entry.kind === 'directory');
	if (directoryRefs.length > 0) {
		sections.push(
			`Referenced workspace folders:\n${directoryRefs.map((entry) => `@${entry.path}`).join('\n')}`,
		);
	}

	for (const mention of mentions) {
		if (mention.kind !== 'file') {
			continue;
		}
		const result = await readWorkspaceFile({
			path: mention.path,
			workspaceCwd,
		});
		if (result.error) {
			throw new Error(
				`Could not attach ${mention.path}: ${result.error.message}`,
			);
		}
		sections.push(formatAttachedFileSection(result.path, result.content ?? ''));
	}

	return sections.join('\n\n');
}
