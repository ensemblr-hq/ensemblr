import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

export const ensemblrWorkspaceFiles: WorkspaceFileSummary[] = [
	{ id: 'dir-agents', kind: 'directory', name: '.agents', path: '.agents' },
	{ id: 'dir-claude', kind: 'directory', name: '.claude', path: '.claude' },
	{ id: 'dir-codex', kind: 'directory', name: '.codex', path: '.codex' },
	{
		id: 'dir-context',
		isIgnored: true,
		kind: 'directory',
		name: '.context',
		path: '.context',
	},
	{ id: 'dir-github', kind: 'directory', name: '.github', path: '.github' },
	{
		id: 'dir-vite',
		isIgnored: true,
		kind: 'directory',
		name: '.vite',
		path: '.vite',
	},
	{ id: 'dir-docs', kind: 'directory', name: 'docs', path: 'docs' },
	{
		id: 'dir-node-modules',
		isIgnored: true,
		kind: 'directory',
		name: 'node_modules',
		path: 'node_modules',
	},
	{
		id: 'dir-out',
		isIgnored: true,
		kind: 'directory',
		name: 'out',
		path: 'out',
	},
	{ id: 'dir-scripts', kind: 'directory', name: 'scripts', path: 'scripts' },
	{ id: 'dir-src', kind: 'directory', name: 'src', path: 'src' },
	{ id: 'dir-tests', kind: 'directory', name: 'tests', path: 'tests' },
	{
		id: 'file-gitignore',
		kind: 'file',
		name: '.gitignore',
		path: '.gitignore',
	},
	{
		id: 'file-gitkeep',
		kind: 'file',
		name: '.gitkeep',
		path: '.gitkeep',
	},
	{ id: 'file-agents', kind: 'file', name: 'AGENTS.md', path: 'AGENTS.md' },
	{ id: 'file-biome', kind: 'file', name: 'biome.json', path: 'biome.json' },
	{ id: 'file-bun-lock', kind: 'file', name: 'bun.lock', path: 'bun.lock' },
	{
		id: 'file-components',
		kind: 'file',
		name: 'components.json',
		path: 'components.json',
	},
	{
		id: 'file-ensemblr-settings',
		kind: 'file',
		name: 'settings.toml',
		path: '.ensemblr/settings.toml',
	},
	{ id: 'file-context', kind: 'file', name: 'CONTEXT.md', path: 'CONTEXT.md' },
	{
		id: 'file-forge-config',
		kind: 'file',
		name: 'forge.config.ts',
		path: 'forge.config.ts',
	},
	{
		id: 'file-package',
		kind: 'file',
		name: 'package.json',
		path: 'package.json',
	},
	{ id: 'file-readme', kind: 'file', name: 'README.md', path: 'README.md' },
];

export const agentLabWorkspaceFiles: WorkspaceFileSummary[] = [
	{ id: 'dir-docs', kind: 'directory', name: 'docs', path: 'docs' },
	{ id: 'dir-src', kind: 'directory', name: 'src', path: 'src' },
	{ id: 'dir-tests', kind: 'directory', name: 'tests', path: 'tests' },
	{
		id: 'file-package',
		kind: 'file',
		name: 'package.json',
		path: 'package.json',
	},
	{ id: 'file-readme', kind: 'file', name: 'README.md', path: 'README.md' },
];
