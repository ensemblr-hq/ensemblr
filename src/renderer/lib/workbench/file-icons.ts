import { addCollection } from '@iconify/react';
import { icons as vscodeIcons } from '@iconify-json/vscode-icons';

import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

addCollection(vscodeIcons);

const iconPrefix = 'vscode-icons';

const folderIconByName: Record<string, string> = {
	'.claude': 'folder-type-claude',
	'.git': 'folder-type-git',
	'.github': 'folder-type-github',
	docs: 'folder-type-docs',
	node_modules: 'folder-type-node',
	out: 'folder-type-dist',
	scripts: 'folder-type-script',
	src: 'folder-type-src',
	tests: 'folder-type-test',
};

const fileIconByName: Record<string, string> = {
	'.git': 'file-type-git',
	'.gitignore': 'file-type-git',
	'.gitkeep': 'file-type-git',
	'.npmrc': 'file-type-npm',
	'.nvmrc': 'file-type-node',
	AGENTS: 'file-type-agents',
	'AGENTS.md': 'file-type-agents',
	'biome.json': 'file-type-biome',
	'bun.lock': 'file-type-bun',
	'components.json': 'file-type-json',
	CONTEXT: 'file-type-markdown',
	'CONTEXT.md': 'file-type-markdown',
	'forge.config.ts': 'file-type-config',
	'package.json': 'file-type-npm',
};

const fileIconByExtension: Record<string, string> = {
	avif: 'file-type-image',
	bmp: 'file-type-image',
	cjs: 'file-type-js',
	css: 'file-type-css',
	csv: 'file-type-excel',
	doc: 'file-type-word',
	docx: 'file-type-word',
	gif: 'file-type-image',
	go: 'file-type-go',
	htm: 'file-type-html',
	html: 'file-type-html',
	jpeg: 'file-type-image',
	jpg: 'file-type-image',
	js: 'file-type-js',
	json: 'file-type-json',
	jsx: 'file-type-js',
	lock: 'file-type-bun',
	log: 'file-type-log',
	md: 'file-type-markdown',
	markdown: 'file-type-markdown',
	mjs: 'file-type-js',
	mts: 'file-type-typescript',
	odt: 'file-type-word',
	pdf: 'file-type-pdf2',
	png: 'file-type-image',
	ppt: 'file-type-powerpoint',
	pptx: 'file-type-powerpoint',
	py: 'file-type-python',
	rs: 'file-type-rust',
	rtf: 'file-type-word',
	sh: 'file-type-shell',
	svg: 'file-type-svg',
	tiff: 'file-type-image',
	toml: 'file-type-toml',
	ts: 'file-type-typescript',
	tsv: 'file-type-excel',
	tsx: 'file-type-reactts',
	txt: 'file-type-text',
	webp: 'file-type-image',
	xls: 'file-type-excel',
	xlsx: 'file-type-excel',
	xml: 'file-type-xml',
	yaml: 'file-type-yaml',
	yml: 'file-type-yaml',
	zip: 'file-type-zip',
};

/** Minimal file or folder shape needed to choose an icon: its name and kind. */
type WorkspaceFileIconTarget = Pick<WorkspaceFileSummary, 'kind' | 'name'>;

/**
 * Picks the appropriate VSCode icon name for a workspace file or folder.
 * @param file - File/folder name and kind.
 * @param options - When `isExpanded` is set, directories resolve to their
 *   open-folder glyph (falling back to the closed one if no `-opened` variant
 *   exists in the icon set).
 * @returns A fully-qualified iconify name (e.g. `vscode-icons:file-type-js`).
 */
export function getWorkspaceFileIconName(
	file: WorkspaceFileIconTarget,
	options?: { isExpanded?: boolean },
): string {
	if (file.kind === 'directory') {
		const baseIcon = folderIconByName[file.name] ?? 'default-folder';
		const openIcon = `${baseIcon}-opened`;
		const iconName =
			options?.isExpanded && folderIconExists(openIcon) ? openIcon : baseIcon;

		return `${iconPrefix}:${iconName}`;
	}

	const iconName =
		fileIconByName[file.name] ??
		fileIconByExtension[getFileExtension(file.name)] ??
		'default-file';

	return `${iconPrefix}:${iconName}`;
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
	return Boolean(vscodeIcons.icons[name] ?? vscodeIcons.aliases?.[name]);
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
