import type { MenuBarDescriptor } from '@/shared/menu-bar';

/**
 * A menu bar shaped like the one main serializes on Linux, covering every row
 * the renderer has a branch for: plain items with and without a chord, a
 * disabled item, a checkbox run, a one-of-N radio run, a nested submenu, and
 * the disabled placeholder an empty dynamic submenu leaves behind.
 *
 * Hand-written rather than built from `src/main/menu`: the playground runs in a
 * browser with no Electron, and the point of the scene is the drawing, not the
 * serialization — which `tests/main/menu-bar-descriptor.test.ts` covers instead.
 */
export const MENU_BAR_FIXTURE: MenuBarDescriptor = {
	menus: [
		{
			enabled: true,
			id: '0',
			items: [
				{
					accelerator: 'Ctrl+Shift+N',
					enabled: true,
					id: '0.0',
					kind: 'action',
					label: 'New Workspace',
				},
				{
					accelerator: 'Ctrl+T',
					enabled: true,
					id: '0.1',
					kind: 'action',
					label: 'New Chat',
				},
				{ id: '0.2', kind: 'separator' },
				{
					enabled: true,
					id: '0.3',
					items: [
						{
							enabled: true,
							id: '0.3.0',
							kind: 'action',
							label: 'From GitHub…',
						},
						{
							enabled: true,
							id: '0.3.1',
							kind: 'action',
							label: 'From Local Folder…',
						},
					],
					kind: 'submenu',
					label: 'Add Repository',
				},
				{
					enabled: false,
					id: '0.4',
					items: [
						{
							enabled: false,
							id: '0.4.0',
							kind: 'action',
							label: 'No Recent Repositories',
						},
					],
					kind: 'submenu',
					label: 'Open Recent',
				},
				{ id: '0.5', kind: 'separator' },
				{
					accelerator: 'Ctrl+Q',
					enabled: true,
					id: '0.6',
					kind: 'action',
					label: 'Quit Ensemblr',
				},
			],
			kind: 'submenu',
			label: 'File',
		},
		{
			enabled: true,
			id: '1',
			items: [
				{
					accelerator: 'Ctrl+Z',
					enabled: true,
					id: '1.0',
					kind: 'action',
					label: 'Undo',
				},
				{
					accelerator: 'Ctrl+Shift+Z',
					enabled: true,
					id: '1.1',
					kind: 'action',
					label: 'Redo',
				},
				{ id: '1.2', kind: 'separator' },
				{
					accelerator: 'Ctrl+C',
					enabled: true,
					id: '1.3',
					kind: 'action',
					label: 'Copy',
				},
				{
					accelerator: 'Ctrl+V',
					enabled: true,
					id: '1.4',
					kind: 'action',
					label: 'Paste',
				},
			],
			kind: 'submenu',
			label: 'Edit',
		},
		{
			enabled: true,
			id: '2',
			items: [
				{
					accelerator: 'Ctrl+K',
					enabled: true,
					id: '2.0',
					kind: 'action',
					label: 'Command Palette…',
				},
				{ id: '2.1', kind: 'separator' },
				{
					accelerator: 'Ctrl+B',
					checked: true,
					enabled: true,
					id: '2.2',
					kind: 'action',
					label: 'Sidebar',
					mark: 'checkbox',
				},
				{
					accelerator: 'Ctrl+J',
					checked: false,
					enabled: true,
					id: '2.3',
					kind: 'action',
					label: 'Dock',
					mark: 'checkbox',
				},
				{ id: '2.4', kind: 'separator' },
				{
					enabled: true,
					id: '2.5',
					items: [
						{
							checked: false,
							enabled: true,
							id: '2.5.0',
							kind: 'action',
							label: 'System',
							mark: 'radio',
						},
						{
							checked: false,
							enabled: true,
							id: '2.5.1',
							kind: 'action',
							label: 'Light',
							mark: 'radio',
						},
						{
							checked: true,
							enabled: true,
							id: '2.5.2',
							kind: 'action',
							label: 'Dark',
							mark: 'radio',
						},
					],
					kind: 'submenu',
					label: 'Appearance',
				},
			],
			kind: 'submenu',
			label: 'View',
		},
		{
			enabled: true,
			id: '3',
			items: [
				{
					accelerator: 'Ctrl+R',
					checked: false,
					enabled: true,
					id: '3.0',
					kind: 'action',
					label: 'Run',
					mark: 'checkbox',
				},
				{
					enabled: false,
					id: '3.1',
					items: [
						{
							enabled: false,
							id: '3.1.0',
							kind: 'action',
							label: 'No Run Scripts',
						},
					],
					kind: 'submenu',
					label: 'Run Script',
				},
				{ id: '3.2', kind: 'separator' },
				{
					enabled: false,
					id: '3.3',
					kind: 'action',
					label: 'Rename Workspace…',
				},
			],
			kind: 'submenu',
			label: 'Workspace',
		},
		{
			enabled: true,
			id: '4',
			items: [
				{
					accelerator: 'Ctrl+/',
					enabled: true,
					id: '4.0',
					kind: 'action',
					label: 'Keyboard Shortcuts',
				},
				{ id: '4.1', kind: 'separator' },
				{ enabled: true, id: '4.2', kind: 'action', label: 'About Ensemblr' },
			],
			kind: 'submenu',
			label: 'Help',
		},
	],
	revision: 1,
};

/** The same bar with nothing live, which is what launch draws before the first report. */
export const EMPTY_MENU_BAR_FIXTURE: MenuBarDescriptor = {
	menus: [],
	revision: 0,
};
