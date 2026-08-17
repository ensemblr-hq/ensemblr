/**
 * Renders one file's unified patch as a standalone markdown document the
 * composer can store and attach. Deliberately un-localized: this text is written
 * for the agent, which `buildLanguageDirective` steers separately, so translating
 * it would make what the model reads vary by UI language.
 */

import { clampReviewContext } from '@/renderer/lib/workbench/review-context';

/** Filename stem used when a path sanitizes down to nothing. */
const UNKNOWN_STEM = 'unknown';

/**
 * Builds the filename a diff document is stored under, so the chip's tooltip and
 * the agent's `<attached_file path>` both name the file the patch came from
 * rather than a hash.
 * @param filePath - Workspace-relative path the patch was taken against
 * @returns A conservative filename stem plus its `.md` extension
 */
export function diffDocumentFilename(filePath: string): string {
	const stem = filePath
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9_-]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');
	return `diff-${stem || UNKNOWN_STEM}.md`;
}

/**
 * Renders the patch as a fenced diff under a heading naming its file, clamped to
 * the review-context cap so one enormous rewrite cannot spend the agent's whole
 * context before the user's question is read. The patch is clamped before it is
 * fenced, so a truncated document still closes its code block.
 * @param filePath - Workspace-relative path the patch was taken against
 * @param patch - The unified patch text
 * @returns The markdown document to persist
 */
export function renderDiffDocument({
	filePath,
	patch,
}: {
	filePath: string;
	patch: string;
}): string {
	return [
		`# Diff for \`${filePath}\``,
		'',
		// i18next-instrument-ignore -- markdown fence, and agent-facing prose
		'```diff',
		clampReviewContext(patch.trimEnd()),
		'```',
		'',
	].join('\n');
}
