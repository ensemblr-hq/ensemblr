import { describe, expect, it } from 'vitest';

import {
	getWorkspaceFileIconName,
	getWorkspaceFileIconNameForPath,
} from '@/renderer/lib/workbench/file-icons';

function iconFor(name: string): string {
	return getWorkspaceFileIconName({ kind: 'file', name });
}

describe('legal document icons', () => {
	it.each([
		'LICENSE',
		'LICENCE',
		'License',
		'license',
		'LICENSE.md',
		'LICENSE.txt',
		'LICENSE-MIT',
		'LICENSE-APACHE',
		'NOTICE',
		'NOTICE.txt',
		'COPYING',
		'COPYING.LESSER',
		'COPYING.LIB',
		'COPYRIGHT',
		'LICENSE.APACHE',
		'LICENSE.MIT',
		'LICENSE-APACHE-2.0',
		'LICENSE-APACHE-2.0.txt',
	])('uses the license icon for %s', (name) => {
		expect(iconFor(name)).toBe('vscode-icons:file-type-license');
	});

	it('uses the unlicense icon for UNLICENSE', () => {
		expect(iconFor('UNLICENSE')).toBe('vscode-icons:file-type-unlicense');
	});

	it.each([
		['license.ts', 'vscode-icons:file-type-typescript'],
		['notice.json', 'vscode-icons:file-type-json'],
		['licenses', 'vscode-icons:default-file'],
		['license.apache.ts', 'vscode-icons:file-type-typescript'],
		['copying.lesser.json', 'vscode-icons:file-type-json'],
	])('leaves %s to its own rule', (name, icon) => {
		expect(iconFor(name)).toBe(icon);
	});

	it('resolves nested paths by their final segment', () => {
		expect(getWorkspaceFileIconNameForPath('vendor/lib/NOTICE')).toBe(
			'vscode-icons:file-type-license',
		);
	});
});

describe('extension-less build and project files', () => {
	it.each([
		['Dockerfile', 'file-type-docker'],
		['Dockerfile.dev', 'file-type-docker'],
		['app.dockerfile', 'file-type-docker'],
		['Containerfile', 'file-type-docker'],
		['Makefile', 'file-type-makefile'],
		['makefile', 'file-type-makefile'],
		['GNUmakefile', 'file-type-makefile'],
		['rules.mk', 'file-type-makefile'],
		['CMakeLists.txt', 'file-type-cmake'],
		['Procfile', 'file-type-procfile'],
		['Justfile', 'file-type-just'],
		['Brewfile', 'file-type-brew'],
		['Vagrantfile', 'file-type-vagrant'],
		['Gemfile', 'file-type-ruby'],
		['Gemfile.lock', 'file-type-ruby'],
		['Rakefile', 'file-type-rake'],
		['CODEOWNERS', 'file-type-codeowners'],
		['TODO', 'file-type-todo'],
	])('maps %s to %s', (name, icon) => {
		expect(iconFor(name)).toBe(`vscode-icons:${icon}`);
	});

	it.each(['README', 'CHANGELOG', 'AUTHORS', 'CONTRIBUTORS', 'VERSION'])(
		'treats %s as a plain-text document',
		(name) => {
			expect(iconFor(name)).toBe('vscode-icons:file-type-text');
		},
	);

	it.each([
		['README.md', 'file-type-markdown'],
		['CHANGELOG.md', 'file-type-markdown'],
		['AGENTS', 'file-type-agents'],
		['CONTEXT', 'file-type-markdown'],
	])('keeps %s on %s', (name, icon) => {
		expect(iconFor(name)).toBe(`vscode-icons:${icon}`);
	});
});

describe('folder icons', () => {
	it.each([
		['docs', 'folder-type-docs'],
		['Docs', 'folder-type-docs'],
		['TESTS', 'folder-type-test'],
		['Scripts', 'folder-type-script'],
		['.GitHub', 'folder-type-github'],
	])('matches the %s directory case-insensitively', (name, icon) => {
		expect(getWorkspaceFileIconName({ kind: 'directory', name })).toBe(
			`vscode-icons:${icon}`,
		);
	});
});

describe('names that collide with Object.prototype', () => {
	it.each(['constructor', '__proto__', 'x.constructor'])(
		'falls back to the default file icon for %s',
		(name) => {
			expect(iconFor(name)).toBe('vscode-icons:default-file');
		},
	);

	it('lets constructor.md fall through its stem to the markdown icon', () => {
		expect(iconFor('constructor.md')).toBe('vscode-icons:file-type-markdown');
	});

	it('falls back to the default folder icon for a constructor directory', () => {
		expect(
			getWorkspaceFileIconName({ kind: 'directory', name: 'constructor' }),
		).toBe('vscode-icons:default-folder');
	});
});

describe('extension-less dotfiles', () => {
	it.each([
		['.editorconfig', 'file-type-editorconfig'],
		['.gitattributes', 'file-type-git'],
		['.gitmodules', 'file-type-git'],
		['.mailmap', 'file-type-git'],
		['.dockerignore', 'file-type-docker'],
		['.prettierrc', 'file-type-prettier'],
		['.prettierignore', 'file-type-prettier'],
		['.eslintrc', 'file-type-eslint'],
		['.node-version', 'file-type-node'],
		['.python-version', 'file-type-pyenv'],
		['.ruby-version', 'file-type-ruby'],
		['.envrc', 'file-type-direnv'],
		['.browserslistrc', 'file-type-browserslist'],
	])('maps %s to %s', (name, icon) => {
		expect(iconFor(name)).toBe(`vscode-icons:${icon}`);
	});
});
