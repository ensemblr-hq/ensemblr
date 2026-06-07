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
	AGENTS: 'file-type-agents',
	'AGENTS.md': 'file-type-agents',
	'biome.json': 'file-type-biome',
	'bun.lock': 'file-type-bun',
	'components.json': 'file-type-json',
	'conductor.json': 'file-type-config',
	CONTEXT: 'file-type-markdown',
	'CONTEXT.md': 'file-type-markdown',
	'forge.config.ts': 'file-type-config',
	'package.json': 'file-type-npm',
};

const fileIconByExtension: Record<string, string> = {
	css: 'file-type-css',
	js: 'file-type-js',
	json: 'file-type-json',
	lock: 'file-type-bun',
	md: 'file-type-markdown',
	mjs: 'file-type-js',
	ts: 'file-type-typescript',
	tsx: 'file-type-reactts',
};

type WorkspaceFileIconTarget = Pick<WorkspaceFileSummary, 'kind' | 'name'>;

/**
 * Picks the appropriate VSCode icon name for a workspace file or folder.
 * @param file - File/folder name and kind.
 * @returns A fully-qualified iconify name (e.g. `vscode-icons:file-type-js`).
 */
export function getWorkspaceFileIconName(
	file: WorkspaceFileIconTarget,
): string {
	const iconName =
		file.kind === 'directory'
			? (folderIconByName[file.name] ?? 'default-folder')
			: (fileIconByName[file.name] ??
				fileIconByExtension[getFileExtension(file.name)] ??
				'default-file');

	return `${iconPrefix}:${iconName}`;
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
