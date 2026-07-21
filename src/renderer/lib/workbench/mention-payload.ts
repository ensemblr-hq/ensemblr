import { readWorkspaceFile } from '@/renderer/api/ensemblr-queries';
import type {
	ExternalAttachment,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import {
	formatAttachedFileBlock,
	REFERENCED_FOLDERS_HEADER,
} from '@/shared/prompt-scaffolding';

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
/**
 * Extensions whose content is inlined verbatim in the prompt. Everything else
 * (images, pdf, office docs, archives, unknown binaries) is announced by path
 * with a placeholder so Pi inspects the saved file directly instead of the
 * prompt being flooded with — or corrupted by — binary bytes.
 */
const TEXT_INLINE_EXTENSIONS = new Set([
	'c',
	'cfg',
	'conf',
	'cjs',
	'cpp',
	'cs',
	'css',
	'csv',
	'go',
	'h',
	'htm',
	'html',
	'ini',
	'java',
	'js',
	'json',
	'jsonc',
	'jsx',
	'kt',
	'log',
	'lua',
	'md',
	'markdown',
	'mjs',
	'php',
	'py',
	'rb',
	'rs',
	'scss',
	'sh',
	'sql',
	'svg',
	'swift',
	'toml',
	'ts',
	'tsx',
	'tsv',
	'txt',
	'xml',
	'yaml',
	'yml',
]);
const ATTACHMENT_PLACEHOLDER =
	'[attachment saved in the workspace — inspect this file directly if needed]';

/** Wraps one workspace file's content in the shared attachment marker, truncated to budget. */
function formatAttachedFileSection(pathValue: string, content: string): string {
	return formatAttachedFileBlock(pathValue, truncateAttachmentContent(content));
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
 * Reads text file mentions via IPC and inlines their content in a fenced
 * `<attached_file>` block. Image mentions use a placeholder so Pi sees the
 * saved workspace path without flooding the prompt with binary bytes.
 * Directories are surfaced as a separate header so Pi knows the user referenced
 * them without expecting inline content.
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
			`${REFERENCED_FOLDERS_HEADER}\n${directoryRefs.map((entry) => `@${entry.path}`).join('\n')}`,
		);
	}

	const fileMentions = mentions.filter((entry) => entry.kind === 'file');
	const textFileMentions = fileMentions.filter((entry) =>
		shouldInlineAsText(entry.path),
	);
	// Text reads are independent, so issue them in parallel (Promise.all preserves
	// order). Results key back to their mention so the emitted sections stay in the
	// user's original mention order, interleaving image placeholders with text.
	const textResults = await Promise.all(
		textFileMentions.map((mention) =>
			readWorkspaceFile({ path: mention.path, workspaceCwd }),
		),
	);
	const resultByMention = new Map(
		textFileMentions.map((mention, index) => [mention, textResults[index]]),
	);
	for (const mention of fileMentions) {
		if (!shouldInlineAsText(mention.path)) {
			sections.push(
				formatAttachedFileSection(mention.path, ATTACHMENT_PLACEHOLDER),
			);
			continue;
		}
		const result = resultByMention.get(mention);
		if (!result) {
			continue;
		}
		if (result.error) {
			throw new Error(
				`Could not attach ${mention.path}: ${result.error.message}`,
			);
		}
		sections.push(formatAttachedFileSection(result.path, result.content ?? ''));
	}

	return sections.join('\n\n');
}

/** Returns true when a file's content should be inlined as text rather than referenced by path. */
function shouldInlineAsText(pathValue: string): boolean {
	const extension = pathValue.split('.').pop()?.toLowerCase();
	return extension ? TEXT_INLINE_EXTENSIONS.has(extension) : false;
}

/**
 * Formats large files referenced by absolute path (not copied into the
 * workspace) as a path-only section, so Pi opens each file directly rather than
 * receiving its bytes.
 */
export function formatExternalAttachmentText(
	externals: readonly ExternalAttachment[],
): string {
	if (externals.length === 0) {
		return '';
	}
	return externals
		.map((external) =>
			formatAttachedFileSection(
				external.absolutePath,
				'[external file — inspect this path directly]',
			),
		)
		.join('\n\n');
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
