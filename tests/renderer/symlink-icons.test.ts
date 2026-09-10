import { Icon } from '@iconify/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { getWorkspaceFileIconName } from '@/renderer/lib/workbench/file-icons';
import { registerIconCollections } from '@/renderer/lib/workbench/icon-collections';

describe('workspace symlink icons', () => {
	it('uses distinct file and folder shortcut icons instead of filename icons', () => {
		const file = { kind: 'file' as const, name: 'package.json' };
		const fileLink = { ...file, symlinkTargetKind: 'file' as const };
		const folderLink = { ...file, symlinkTargetKind: 'directory' as const };
		const brokenLink = { ...file, symlinkTargetKind: 'unknown' as const };

		expect(getWorkspaceFileIconName(fileLink)).toBe('ensemblr:file-symlink');
		expect(getWorkspaceFileIconName(folderLink)).toBe(
			'ensemblr:folder-symlink',
		);
		expect(getWorkspaceFileIconName(brokenLink)).toBe('ensemblr:file-symlink');
		expect(getWorkspaceFileIconName(file)).toBe('vscode-icons:file-type-npm');
	});

	it('bundles both shortcut glyphs so links render without network access', () => {
		registerIconCollections();
		const file = renderToStaticMarkup(
			createElement(Icon, { icon: 'ensemblr:file-symlink' }),
		);
		const folder = renderToStaticMarkup(
			createElement(Icon, { icon: 'ensemblr:folder-symlink' }),
		);

		expect(file).toContain('<svg');
		expect(folder).toContain('<svg');
		expect(file).not.toBe(folder);
	});
});
