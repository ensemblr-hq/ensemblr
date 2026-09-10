import { addCollection } from '@iconify/react';
import { icons as logosIcons } from '@iconify-json/logos';
import { icons as vscodeIcons } from '@iconify-json/vscode-icons';

/** Shortcut arrow badge shared by the file and folder symlink glyphs. */
const symlinkBadge =
	'<rect x="0" y="16" width="16" height="16" rx="2" fill="#1976d2"/><path d="M3 28v-3a3 3 0 0 1 3-3h6m-4-4 4 4-4 4" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';

/**
 * Registers every Iconify collection the renderer draws from — `vscode-icons`
 * for file types, `ensemblr` for symlinks, and `logos` for brands — so `<Icon>` resolves
 * them offline. `src/renderer/main.tsx` calls this once before the first render:
 * Iconify answers any prefix no collection has claimed with an HTTP request to
 * `api.iconify.design`, which in a desktop app means a blank icon until the
 * network answers, so registration belongs to the entry rather than to each
 * module that happens to draw a glyph.
 */
export function registerIconCollections(): void {
	addCollection(vscodeIcons);
	addCollection(logosIcons);
	addCollection({
		prefix: 'ensemblr',
		width: 32,
		height: 32,
		icons: {
			'file-symlink': {
				body: vscodeIcons.icons['default-file'].body + symlinkBadge,
			},
			'folder-symlink': {
				body: vscodeIcons.icons['default-folder'].body + symlinkBadge,
			},
		},
	});
}
