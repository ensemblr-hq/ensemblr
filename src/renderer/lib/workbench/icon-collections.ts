import { addCollection } from '@iconify/react';
import { icons as logosIcons } from '@iconify-json/logos';
import { icons as vscodeIcons } from '@iconify-json/vscode-icons';

/**
 * Registers every Iconify collection the renderer draws from — `vscode-icons`
 * for file-type glyphs and `logos` for agent brand marks — so `<Icon>` resolves
 * them offline. `src/renderer/main.tsx` calls this once before the first render:
 * Iconify answers any prefix no collection has claimed with an HTTP request to
 * `api.iconify.design`, which in a desktop app means a blank icon until the
 * network answers, so registration belongs to the entry rather than to each
 * module that happens to draw a glyph.
 */
export function registerIconCollections(): void {
	addCollection(vscodeIcons);
	addCollection(logosIcons);
}
