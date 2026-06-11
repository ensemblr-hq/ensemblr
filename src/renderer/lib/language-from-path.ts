import type { BundledLanguage } from 'shiki';

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
