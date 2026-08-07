/**
 * Heuristics for deciding whether an inline-code span in assistant markdown is
 * a workspace file reference worth surfacing as an attachment chip, kept out of
 * the markdown renderer so the classification can be tested in isolation.
 */

const INLINE_ATTACHMENT_EXTENSIONS = new Set([
	'astro',
	'avif',
	'bash',
	'c',
	'cjs',
	'cpp',
	'cs',
	'css',
	'csv',
	'cts',
	'env',
	'fish',
	'gif',
	'go',
	'h',
	'htm',
	'html',
	'ico',
	'java',
	'jpeg',
	'jpg',
	'js',
	'json',
	'jsonc',
	'jsx',
	'kt',
	'less',
	'log',
	'lua',
	'md',
	'mdx',
	'mjs',
	'mts',
	'php',
	'png',
	'prisma',
	'py',
	'rb',
	'rs',
	'sass',
	'scss',
	'sh',
	'sql',
	'svg',
	'swift',
	'toml',
	'ts',
	'tsv',
	'tsx',
	'txt',
	'webp',
	'xml',
	'yaml',
	'yml',
	'zsh',
]);

const INLINE_ATTACHMENT_FILENAMES = new Set([
	'.env',
	'.env.local',
	'.gitignore',
	'.npmrc',
	'.nvmrc',
	'changelog',
	'dockerfile',
	'license',
	'makefile',
	'readme',
]);

// Common library display names collide with the `.js`/`.ts` extension rule
// (e.g. `Node.js`); treat a bare, single-segment match against this set as
// prose, not a file, so mentioning a framework does not render a dead chip.
const INLINE_ATTACHMENT_LIBRARY_NAMES = new Set([
	'angular.js',
	'backbone.js',
	'chart.js',
	'd3.js',
	'discord.js',
	'ember.js',
	'express.js',
	'next.js',
	'node.js',
	'nuxt.js',
	'react.js',
	'three.js',
	'vue.js',
]);

const INLINE_ATTACHMENT_SAFE_PATH_PATTERN =
	/^(?:~\/|\.{1,2}\/)?[A-Za-z0-9._@+:-]+(?:\/[A-Za-z0-9._@+:-]+)*$/;

/**
 * Returns a previewable path when an inline-code value looks like a file
 * reference, or null when it reads as ordinary prose or a library name.
 * @param text - Raw inline-code text.
 * @returns Workspace path without any trailing line/column suffix, or null.
 */
export function attachmentPathFromInlineCode(text: string): string | null {
	const candidate = text.trim();
	if (
		candidate.length === 0 ||
		candidate.length > 240 ||
		/\s/.test(candidate) ||
		!INLINE_ATTACHMENT_SAFE_PATH_PATTERN.test(candidate)
	) {
		return null;
	}
	const pathWithoutLineSuffix = candidate.replace(/:\d+(?::\d+)?$/, '');
	const basename = basenameForPath(pathWithoutLineSuffix).toLowerCase();
	const isBareName = !pathWithoutLineSuffix.includes('/');
	if (isBareName && INLINE_ATTACHMENT_LIBRARY_NAMES.has(basename)) {
		return null;
	}
	if (
		INLINE_ATTACHMENT_FILENAMES.has(basename) ||
		basename.startsWith('.env.') ||
		hasInlineAttachmentExtension(basename)
	) {
		return pathWithoutLineSuffix;
	}
	return null;
}

/** Returns the final path segment from a slash-delimited path. */
function basenameForPath(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	const separatorIndex = trimmed.lastIndexOf('/');
	return separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed;
}

/** Reports whether a basename has an extension commonly used by workspace files. */
function hasInlineAttachmentExtension(basename: string): boolean {
	const extensionIndex = basename.lastIndexOf('.');
	if (extensionIndex < 0 || extensionIndex === basename.length - 1) {
		return false;
	}
	return INLINE_ATTACHMENT_EXTENSIONS.has(basename.slice(extensionIndex + 1));
}
