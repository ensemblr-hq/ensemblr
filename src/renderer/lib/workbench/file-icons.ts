import type { IconifyJSON } from '@iconify/react';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

import { ICON_SUBSET } from './icon-subset.gen';

const iconPrefix = 'vscode-icons';

/** Lowercased directory names that decide their own folder icon. */
const folderIconByName: Record<string, string> = {
	'.claude': 'folder-type-claude',
	'.git': 'folder-type-git',
	'.github': 'folder-type-github',
	docs: 'folder-type-docs',
	nix: 'folder-type-nix',
	node_modules: 'folder-type-node',
	out: 'folder-type-dist',
	scripts: 'folder-type-script',
	src: 'folder-type-src',
	tests: 'folder-type-test',
};

/**
 * Whole file names, lowercased, that decide their own icon. This is where a
 * repository's extension-less files — build files, ownership files, plain-text
 * docs, and dotfiles with no extension of their own — get a glyph. Lockfiles
 * live here too: a `.lock` extension names no ecosystem, so each one is keyed
 * by its whole name and an unknown one keeps the default glyph.
 */
const fileIconByName: Record<string, string> = {
	'.browserslistrc': 'file-type-browserslist',
	'.dockerignore': 'file-type-docker',
	'.editorconfig': 'file-type-editorconfig',
	'.env': 'file-type-dotenv',
	'.envrc': 'file-type-direnv',
	'.eslintignore': 'file-type-eslint',
	'.eslintrc': 'file-type-eslint',
	'.git': 'file-type-git',
	'.git-blame-ignore-revs': 'file-type-git',
	'.gitattributes': 'file-type-git',
	'.gitconfig': 'file-type-git',
	'.gitignore': 'file-type-git',
	'.gitkeep': 'file-type-git',
	'.gitmodules': 'file-type-git',
	'.justfile': 'file-type-just',
	'.mailmap': 'file-type-git',
	'.node-version': 'file-type-node',
	'.npmignore': 'file-type-npm',
	'.npmrc': 'file-type-npm',
	'.nvmrc': 'file-type-node',
	'.prettierignore': 'file-type-prettier',
	'.prettierrc': 'file-type-prettier',
	'.python-version': 'file-type-pyenv',
	'.ruby-version': 'file-type-ruby',
	'.yarnrc': 'file-type-yarn',
	agents: 'file-type-agents',
	'agents.md': 'file-type-agents',
	authors: 'file-type-text',
	'biome.json': 'file-type-biome',
	brewfile: 'file-type-brew',
	'bun.lock': 'file-type-bun',
	'bun.lockb': 'file-type-bun',
	'cargo.lock': 'file-type-rust',
	changelog: 'file-type-text',
	changes: 'file-type-text',
	'cmakelists.txt': 'file-type-cmake',
	codeowners: 'file-type-codeowners',
	'components.json': 'file-type-json',
	'composer.lock': 'file-type-php',
	containerfile: 'file-type-docker',
	context: 'file-type-markdown',
	'context.md': 'file-type-markdown',
	contributors: 'file-type-text',
	'deno.lock': 'file-type-deno',
	dockerfile: 'file-type-docker',
	'flake.lock': 'file-type-nix',
	'forge.config.ts': 'file-type-config',
	gemfile: 'file-type-ruby',
	'gemfile.lock': 'file-type-ruby',
	gnumakefile: 'file-type-makefile',
	history: 'file-type-text',
	justfile: 'file-type-just',
	maintainers: 'file-type-text',
	makefile: 'file-type-makefile',
	'mix.lock': 'file-type-elixir',
	'package.json': 'file-type-npm',
	'package.resolved': 'file-type-swift',
	'pdm.lock': 'file-type-pdm',
	'pipfile.lock': 'file-type-python',
	'poetry.lock': 'file-type-poetry',
	procfile: 'file-type-procfile',
	'pubspec.lock': 'file-type-dartlang',
	rakefile: 'file-type-rake',
	readme: 'file-type-text',
	todo: 'file-type-todo',
	'uv.lock': 'file-type-uv',
	vagrantfile: 'file-type-vagrant',
	version: 'file-type-text',
	'yarn.lock': 'file-type-yarn',
};

/**
 * Lowercased name prefixes whose every variant shares the family icon:
 * `.env.local` is still dotenv, `Dockerfile.dev` is still a Dockerfile.
 */
const fileIconByNamePrefix: Record<string, string> = {
	'.env.': 'file-type-dotenv',
	'containerfile.': 'file-type-docker',
	'dockerfile.': 'file-type-docker',
};

/** The name-prefix families as pairs, so resolving a file does not rebuild them. */
const FILE_ICON_NAME_PREFIXES: readonly (readonly [string, string])[] =
	Object.entries(fileIconByNamePrefix);

/**
 * Lowercased stems of legal documents, which keep their icon whether they ship
 * bare or as `.md`/`.txt` — `LICENSE`, `LICENSE.md` and `NOTICE.txt` alike. A
 * stem may carry its own dotted suffix, as GNU's `COPYING.LESSER` does.
 */
const fileIconByDocumentStem: Record<string, string> = {
	copying: 'file-type-license',
	'copying.lesser': 'file-type-license',
	'copying.lib': 'file-type-license',
	copyright: 'file-type-license',
	licence: 'file-type-license',
	license: 'file-type-license',
	'license-apache': 'file-type-license',
	'license-apache-2.0': 'file-type-license',
	'license-mit': 'file-type-license',
	'license.apache': 'file-type-license',
	'license.mit': 'file-type-license',
	notice: 'file-type-license',
	unlicense: 'file-type-unlicense',
};

/** Extensions a legal document may carry on top of its stem. */
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'txt']);

const fileIconByExtension: Record<string, string> = {
	avif: 'file-type-image',
	bash: 'file-type-shell',
	bmp: 'file-type-image',
	c: 'file-type-c',
	cjs: 'file-type-js',
	cmake: 'file-type-cmake',
	cpp: 'file-type-cpp',
	cs: 'file-type-csharp',
	css: 'file-type-css',
	csv: 'file-type-excel',
	doc: 'file-type-word',
	dockerfile: 'file-type-docker',
	docx: 'file-type-word',
	entitlements: 'file-type-xml',
	fish: 'file-type-shell',
	gif: 'file-type-image',
	go: 'file-type-go',
	graphql: 'file-type-graphql',
	h: 'file-type-cheader',
	hpp: 'file-type-cppheader',
	htm: 'file-type-html',
	html: 'file-type-html',
	icns: 'file-type-image',
	ico: 'file-type-image',
	java: 'file-type-java',
	jpeg: 'file-type-image',
	jpg: 'file-type-image',
	js: 'file-type-js',
	json: 'file-type-json',
	jsonc: 'file-type-json',
	jsx: 'file-type-js',
	kt: 'file-type-kotlin',
	log: 'file-type-log',
	m: 'file-type-objectivec',
	markdown: 'file-type-markdown',
	md: 'file-type-markdown',
	mdx: 'file-type-mdx',
	mjs: 'file-type-js',
	mk: 'file-type-makefile',
	mm: 'file-type-objectivecpp',
	mts: 'file-type-typescript',
	nix: 'file-type-nix',
	odt: 'file-type-word',
	pdf: 'file-type-pdf2',
	php: 'file-type-php',
	plist: 'file-type-xml',
	png: 'file-type-image',
	ppt: 'file-type-powerpoint',
	pptx: 'file-type-powerpoint',
	prisma: 'file-type-prisma',
	py: 'file-type-python',
	rb: 'file-type-ruby',
	rs: 'file-type-rust',
	rtf: 'file-type-word',
	scss: 'file-type-scss',
	sh: 'file-type-shell',
	sql: 'file-type-sql',
	storyboard: 'file-type-storyboard',
	svelte: 'file-type-svelte',
	svg: 'file-type-svg',
	swift: 'file-type-swift',
	tiff: 'file-type-image',
	toml: 'file-type-toml',
	ts: 'file-type-typescript',
	tsv: 'file-type-excel',
	tsx: 'file-type-reactts',
	txt: 'file-type-text',
	vue: 'file-type-vue',
	webp: 'file-type-image',
	xib: 'file-type-xib',
	xls: 'file-type-excel',
	xlsx: 'file-type-excel',
	xml: 'file-type-xml',
	yaml: 'file-type-yaml',
	yml: 'file-type-yaml',
	zip: 'file-type-zip',
	zsh: 'file-type-shell',
};

/**
 * Extensions whose glyph lives outside vscode-icons, as fully-qualified iconify
 * names. vscode-icons has no freedesktop desktop-entry glyph, so a `.desktop`
 * launcher takes the Linux mascot from `logos`.
 */
const qualifiedFileIconByExtension: Record<string, string> = {
	desktop: 'logos:linux-tux',
};

/** Icon this file falls back to when no name or extension rule matches. */
const DEFAULT_FILE_ICON = 'default-file';

/** Icon a directory falls back to when its name matches no rule. */
const DEFAULT_FOLDER_ICON = 'default-folder';

/**
 * Every bare vscode-icons name this module can produce, including the derived
 * open-folder variants. `tests/renderer/icon-collections.test.ts` asserts each
 * one resolves in the trimmed collection, so a table entry the icon-subset
 * generator failed to pick up is a red test rather than a blank glyph.
 */
export const WORKSPACE_FILE_ICON_NAMES: readonly string[] = [
	...new Set([
		DEFAULT_FILE_ICON,
		DEFAULT_FOLDER_ICON,
		...Object.values(fileIconByName),
		...Object.values(fileIconByNamePrefix),
		...Object.values(fileIconByDocumentStem),
		...Object.values(fileIconByExtension),
		...Object.values(folderIconByName),
	]),
];

/** File identity and optional symlink target needed to choose an icon. */
type WorkspaceFileIconTarget = Pick<
	WorkspaceFileSummary,
	'kind' | 'name' | 'symlinkTargetKind'
>;

/**
 * Picks a shortcut icon for symlinks, otherwise a VSCode file or folder icon —
 * or, for the few extensions vscode-icons does not cover, a glyph from another
 * bundled collection.
 * @param file - File/folder identity and optional symlink target kind.
 * @param options - When `isExpanded` is set, directories resolve to their
 *   open-folder glyph (falling back to the closed one if no `-opened` variant
 *   exists in the icon set).
 * @returns A fully-qualified iconify name (e.g. `vscode-icons:file-type-js`).
 */
export function getWorkspaceFileIconName(
	file: WorkspaceFileIconTarget,
	options?: { isExpanded?: boolean },
): string {
	if (file.symlinkTargetKind) {
		return file.symlinkTargetKind === 'directory'
			? 'ensemblr:folder-symlink'
			: 'ensemblr:file-symlink';
	}

	if (file.kind === 'directory') {
		const baseIcon =
			lookupIcon(folderIconByName, file.name.toLowerCase()) ??
			DEFAULT_FOLDER_ICON;
		const openIcon = `${baseIcon}-opened`;
		const iconName =
			options?.isExpanded && folderIconExists(openIcon) ? openIcon : baseIcon;

		return `${iconPrefix}:${iconName}`;
	}

	const fileName = file.name.toLowerCase();

	return (
		lookupIcon(qualifiedFileIconByExtension, getFileExtension(fileName)) ??
		`${iconPrefix}:${getFileIconName(fileName)}`
	);
}

/**
 * Resolves a file's bare vscode-icons name, trying the most specific rule
 * first: the whole name, a name-prefix family, a legal-document stem, then
 * the extension.
 * @param name - The file name, lowercased.
 * @returns A bare vscode-icons name, or the default file glyph.
 */
function getFileIconName(name: string): string {
	const extension = getFileExtension(name);

	return (
		lookupIcon(fileIconByName, name) ??
		getFileIconNameByPrefix(name) ??
		getDocumentIconName(name, extension) ??
		lookupIcon(fileIconByExtension, extension) ??
		DEFAULT_FILE_ICON
	);
}

/**
 * Reads an icon table by its own keys only, so a file or folder named
 * `constructor` or `__proto__` misses rather than resolving to an
 * `Object.prototype` member.
 * @param table - One of this module's icon tables.
 * @param key - The name, stem, or extension to look up.
 * @returns The mapped icon, or undefined when the table has no such key.
 */
function lookupIcon(
	table: Record<string, string>,
	key: string,
): string | undefined {
	return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * Finds the family icon for a name that extends a known prefix.
 * @param name - The file name, lowercased.
 * @returns The family's icon, or undefined when no prefix matches.
 */
function getFileIconNameByPrefix(name: string): string | undefined {
	return FILE_ICON_NAME_PREFIXES.find(([prefix]) =>
		name.startsWith(prefix),
	)?.[1];
}

/**
 * Finds the icon for a legal document such as `LICENSE`, `NOTICE.md` or
 * `COPYING.LESSER`: the name, less a trailing `.md`/`.txt`, must be a known
 * stem, so `license.ts` is left to its extension.
 * @param name - The file name, lowercased.
 * @param extension - The name's extension, without the leading dot.
 * @returns The document's icon, or undefined when the name is not one.
 */
function getDocumentIconName(
	name: string,
	extension: string,
): string | undefined {
	const stem = DOCUMENT_EXTENSIONS.has(extension)
		? name.slice(0, -(extension.length + 1))
		: name;
	return lookupIcon(fileIconByDocumentStem, stem);
}

/**
 * Picks the appropriate VSCode icon name for a workspace-relative file path.
 * @param filePath - Workspace-relative file path.
 * @returns A fully-qualified iconify name (e.g. `vscode-icons:file-type-js`).
 */
export function getWorkspaceFileIconNameForPath(filePath: string): string {
	return getWorkspaceFileIconName({
		kind: 'file',
		name: getFileName(filePath),
	});
}

/** Reports whether a (non-prefixed) folder icon name exists in the VSCode set. */
function folderIconExists(name: string): boolean {
	const collection: IconifyJSON = ICON_SUBSET['vscode-icons'];
	return Boolean(collection.icons[name] ?? collection.aliases?.[name]);
}

/**
 * Returns the final path segment for a workspace-relative file path.
 * @param filePath - Workspace-relative file path.
 * @returns The file name segment, or the original path when no segment exists.
 */
function getFileName(filePath: string): string {
	const normalizedPath = filePath.replaceAll('\\', '/');
	const segments = normalizedPath.split('/').filter(Boolean);
	return segments[segments.length - 1] ?? filePath;
}

/**
 * Returns the lowercase extension of a file name, or empty string when absent.
 * @param name - File name.
 * @returns The extension, without the leading dot.
 */
function getFileExtension(name: string) {
	const extensionStart = name.lastIndexOf('.');

	if (extensionStart <= 0 || extensionStart === name.length - 1) {
		return '';
	}

	return name.slice(extensionStart + 1).toLowerCase();
}
