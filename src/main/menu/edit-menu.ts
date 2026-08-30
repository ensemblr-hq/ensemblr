import type { DescribedMenuItem } from './menu-item';

import type { MenuLabels } from './menu-strings';

/**
 * Builds the Edit menu. Every item is a native role; the Speech submenu keeps
 * its macOS-owned `startSpeaking`/`stopSpeaking` items, which stay in the
 * system language.
 * @param labels - Native menu labels for the active language
 * @returns The Edit menu
 */
export function buildEditMenu(labels: MenuLabels): DescribedMenuItem {
	const macOnly: DescribedMenuItem[] = [
		{ label: labels.pasteAndMatchStyle, role: 'pasteAndMatchStyle' },
		{ label: labels.delete, role: 'delete' },
		{ label: labels.selectAll, role: 'selectAll' },
		{ type: 'separator' },
		{
			label: labels.speech,
			submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
		},
	];

	const otherPlatforms: DescribedMenuItem[] = [
		{ label: labels.delete, role: 'delete' },
		{ type: 'separator' },
		{ label: labels.selectAll, role: 'selectAll' },
	];

	return {
		label: labels.edit,
		submenu: [
			{ label: labels.undo, role: 'undo' },
			{ label: labels.redo, role: 'redo' },
			{ type: 'separator' },
			{ label: labels.cut, role: 'cut' },
			{ label: labels.copy, role: 'copy' },
			{ label: labels.paste, role: 'paste' },
			...(process.platform === 'darwin' ? macOnly : otherPlatforms),
		],
	};
}
