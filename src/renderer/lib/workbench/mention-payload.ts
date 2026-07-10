import { readWorkspaceFile } from '@/renderer/api/ensemblr-queries';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

/**
 * Upper bound on inlined attachment content sent to Pi. Long `.context`
 * transcripts otherwise dominate the prompt and Pi tends to parrot the
 * content verbatim in its reply. Caller-side truncation keeps the prompt
 * focused while leaving a visible marker so the model knows context was
 * elided.
 */
const ATTACHED_FILE_MAX_CHARS = 8_000;
const ATTACHED_FILE_HEAD_CHARS = 2_500;
const ATTACHED_FILE_TAIL_CHARS = 5_000;

/** Wraps one workspace file's content in an explicit attachment marker. */
function formatAttachedFileSection(pathValue: string, content: string): string {
	const safePath = pathValue.replaceAll('"', '&quot;');
	return `<attached_file path="${safePath}">\n${truncateAttachmentContent(content)}\n</attached_file>`;
}

/**
 * Keeps the opening for topic anchoring and the tail for the latest state,
 * replacing the middle with a `[...elided N chars...]` marker. Mirrors the
 * head/tail strategy the session-summary writer already uses for transcript
 * elision so the renderer and main process behave consistently.
 */
function truncateAttachmentContent(content: string): string {
	if (content.length <= ATTACHED_FILE_MAX_CHARS) {
		return content;
	}
	const head = content.slice(0, ATTACHED_FILE_HEAD_CHARS);
	const tail = content.slice(content.length - ATTACHED_FILE_TAIL_CHARS);
	const elided = content.length - head.length - tail.length;
	return `${head}\n\n[...elided ${elided.toLocaleString('en-US')} chars...]\n\n${tail}`;
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

	const fileMentions = mentions.filter((entry) => entry.kind === 'file');
	// Reads are independent, so issue them in parallel. Results stay in mention
	// order (Promise.all preserves order), and we re-check errors in order so the
	// first failing mention deterministically wins — matching sequential reads.
	const results = await Promise.all(
		fileMentions.map((mention) =>
			readWorkspaceFile({ path: mention.path, workspaceCwd }),
		),
	);
	for (let index = 0; index < fileMentions.length; index += 1) {
		const mention = fileMentions[index];
		const result = results[index];
		if (result.error) {
			throw new Error(
				`Could not attach ${mention.path}: ${result.error.message}`,
			);
		}
		sections.push(formatAttachedFileSection(result.path, result.content ?? ''));
	}

	return sections.join('\n\n');
}

/**
 * Reads each uploaded file as text and wraps it in the shared `<attached_file>`
 * envelope so Pi receives uploads alongside @ mentions. Falls back to a
 * `[binary]` placeholder if a file cannot be decoded as text.
 */
export async function formatUploadAttachmentText(
	uploads: readonly File[],
): Promise<string> {
	if (uploads.length === 0) {
		return '';
	}
	// Decodes are independent; read them in parallel. Promise.all preserves the
	// upload order so the rendered sections still match the user's selection.
	const sections = await Promise.all(
		uploads.map(async (file) => {
			let content: string;
			try {
				content = await file.text();
			} catch {
				content = '[binary upload — content could not be decoded as text]';
			}
			return formatAttachedFileSection(file.name, content);
		}),
	);
	return sections.join('\n\n');
}
