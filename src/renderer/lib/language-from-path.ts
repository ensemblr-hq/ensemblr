import { type BundledLanguage, bundledLanguages } from 'shiki';

const EXTENSION_LANGUAGE: Record<string, string> = {
	bash: 'bash',
	c: 'c',
	cjs: 'javascript',
	cpp: 'cpp',
	cs: 'csharp',
	css: 'css',
	fish: 'fish',
	go: 'go',
	graphql: 'graphql',
	h: 'c',
	hpp: 'cpp',
	html: 'html',
	java: 'java',
	js: 'javascript',
	json: 'json',
	jsonc: 'jsonc',
	jsx: 'jsx',
	kt: 'kotlin',
	md: 'markdown',
	mdx: 'mdx',
	mjs: 'javascript',
	php: 'php',
	prisma: 'prisma',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	scss: 'scss',
	sh: 'bash',
	sql: 'sql',
	svelte: 'svelte',
	svg: 'xml',
	swift: 'swift',
	toml: 'toml',
	ts: 'typescript',
	tsx: 'tsx',
	vue: 'vue',
	xml: 'xml',
	yaml: 'yaml',
	yml: 'yaml',
	zsh: 'bash',
};

const BASENAME_LANGUAGE: Record<string, string> = {
	dockerfile: 'docker',
	makefile: 'makefile',
};

/**
 * Maps a file path to a Shiki language for syntax highlighting. Falls back to
 * plain `text` (a Shiki special language outside `BundledLanguage`, hence the
 * cast — the same convention as the tool-output classifier).
 */
export function languageForFilePath(filePath: string): BundledLanguage {
	const basename = filePath.split('/').at(-1)?.toLowerCase() ?? '';
	const byBasename = BASENAME_LANGUAGE[basename];
	if (byBasename) {
		return byBasename as BundledLanguage;
	}
	const extension = basename.includes('.')
		? (basename.split('.').at(-1) ?? '')
		: '';
	return (EXTENSION_LANGUAGE[extension] ?? 'text') as BundledLanguage;
}

/**
 * Resolves a free-form fence tag (` ```ts `, ` ```Dockerfile `) to a grammar
 * Shiki actually bundles.
 *
 * The guard is load-bearing: `createHighlighter` rejects on an unknown grammar,
 * and an assistant can fence a block with any word at all, so an unchecked tag
 * would surface as an unhandled rejection rather than an unhighlighted block.
 * @param tag - The language tag written on the fence
 * @returns The matching bundled grammar, or plain `text` when there is none
 */
export function toBundledLanguage(tag: string): BundledLanguage {
	const normalized = tag.trim().toLowerCase();
	if (normalized.length === 0) {
		return 'text' as BundledLanguage;
	}
	if (normalized in bundledLanguages) {
		return normalized as BundledLanguage;
	}
	const byAlias =
		BASENAME_LANGUAGE[normalized] ?? EXTENSION_LANGUAGE[normalized];
	return (byAlias ?? 'text') as BundledLanguage;
}
