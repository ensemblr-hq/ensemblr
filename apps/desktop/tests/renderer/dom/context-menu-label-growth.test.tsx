// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { CopyIcon } from 'lucide-react';
import { describe, expect, test, vi } from 'vitest';

import {
	ContextMenu,
	ContextMenuSub,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from '@/renderer/components/ui/context-menu';
import { FileMenuItem } from '@/renderer/components/workbench-shell/review-files/file-menu-items';
import { SidebarContextMenuItem } from '@/renderer/components/workbench-shell/sidebar-context-menu-item';
import {
	WorkbenchContextMenuContent,
	WorkbenchContextMenuSubContent,
} from '@/renderer/components/workbench-shell/workbench-context-menu-content';

import { renderWithProviders } from '../support/dom';

const MENU_LABEL = 'workbench actions';
const SUBMENU_LABEL = 'nested actions';

/**
 * Opens one workbench context menu holding both shared row components and a
 * submenu, so the assertions read the classes the real menus render rather than
 * a copy of them.
 */
function openMenu() {
	renderWithProviders(
		<ContextMenu>
			<ContextMenuTrigger>surface</ContextMenuTrigger>
			<WorkbenchContextMenuContent aria-label={MENU_LABEL} className='min-w-56'>
				<SidebarContextMenuItem>sidebar row</SidebarContextMenuItem>
				<FileMenuItem icon={CopyIcon} label='file row' onSelect={vi.fn()} />
				<ContextMenuSub>
					<ContextMenuSubTrigger className='min-h-8'>
						open in
					</ContextMenuSubTrigger>
					<WorkbenchContextMenuSubContent
						aria-label={SUBMENU_LABEL}
						className='min-w-48'
					>
						<SidebarContextMenuItem>nested row</SidebarContextMenuItem>
					</WorkbenchContextMenuSubContent>
				</ContextMenuSub>
			</WorkbenchContextMenuContent>
		</ContextMenu>,
	);
	fireEvent.contextMenu(screen.getByText('surface'));
	return screen.getByLabelText(MENU_LABEL);
}

describe('workbench context menu label growth', () => {
	test('the panel is sized by its content and capped rather than fixed', () => {
		const panel = openMenu();

		expect(panel.className).toContain('w-max');
		expect(panel.className).toContain('max-w-80');
		expect(panel.className).toContain('min-w-56');
	});

	test('rows take a height floor, so a wrapped label grows its own row', () => {
		openMenu();

		for (const label of ['sidebar row', 'file row']) {
			const row = screen
				.getByText(label)
				.closest('[data-slot="context-menu-item"]');

			expect(row?.className).toContain('min-h-8');
			expect(row?.className).not.toMatch(/(^|\s)h-8(\s|$)/);
		}
	});

	test('the submenu panel grows on the same terms as the menu above it', () => {
		openMenu();

		fireEvent.keyDown(screen.getByText('open in'), { key: 'ArrowRight' });
		const panel = screen.getByLabelText(SUBMENU_LABEL);

		expect(panel.className).toContain('w-max');
		expect(panel.className).toContain('max-w-80');
		expect(panel.className).toContain('min-w-48');
	});
});
