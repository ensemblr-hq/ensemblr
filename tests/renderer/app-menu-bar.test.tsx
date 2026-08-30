// @vitest-environment happy-dom

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { AppMenuBar } from '@/renderer/components/workbench-shell/window-controls';
import type { MenuBarAction, MenuBarDescriptor } from '@/shared/menu-bar';

import { renderWithProviders } from './support/dom';

/** The utility every disabled row carries, whatever kind of row it is. */
const DISABLED_DIM_CLASS = 'data-disabled:opacity-50';

/** A bar with one menu, whose rows each test supplies. */
function barOf(
	items: MenuBarDescriptor['menus'][number]['items'],
): MenuBarDescriptor {
	return {
		menus: [
			{ enabled: true, id: '0', items, kind: 'submenu', label: 'Workspace' },
		],
		revision: 3,
	};
}

/** Renders the bar and opens its only menu. */
async function openMenu(bar: MenuBarDescriptor): Promise<{
	onSelect: ReturnType<typeof vi.fn>;
}> {
	const onSelect = vi.fn();
	renderWithProviders(<AppMenuBar menuBar={bar} onSelect={onSelect} />);
	await userEvent.click(screen.getByRole('menuitem', { name: 'Workspace' }));
	return { onSelect };
}

describe('AppMenuBar', () => {
	test('draws nothing until main has sent a bar', () => {
		const { container } = renderWithProviders(
			<AppMenuBar menuBar={{ menus: [], revision: 0 }} onSelect={vi.fn()} />,
		);

		expect(container).toBeEmptyDOMElement();
	});

	test('a menu title opens the rows main put under it', async () => {
		await openMenu(
			barOf([
				{ enabled: true, id: '0.0', kind: 'action', label: 'Run Setup Script' },
			]),
		);

		expect(
			await screen.findByRole('menuitem', { name: /Run Setup Script/ }),
		).toBeInTheDocument();
	});

	test('picking a row reports it back', async () => {
		const row: MenuBarAction = {
			accelerator: 'Ctrl+R',
			enabled: true,
			id: '0.0',
			kind: 'action',
			label: 'Run Setup Script',
		};
		const { onSelect } = await openMenu(barOf([row]));

		await userEvent.click(
			await screen.findByRole('menuitem', { name: /Run Setup Script/ }),
		);

		expect(onSelect).toHaveBeenCalledWith(row);
	});

	test('a disabled row reports nothing', async () => {
		const { onSelect } = await openMenu(
			barOf([
				{
					enabled: false,
					id: '0.0',
					kind: 'action',
					label: 'Rename Workspace',
				},
			]),
		);

		await userEvent.click(
			await screen.findByRole('menuitem', { name: /Rename Workspace/ }),
		);

		expect(onSelect).not.toHaveBeenCalled();
	});

	// A dynamic submenu disables itself once it has no entries, so this is the
	// state a workspace with no run scripts actually draws.
	test('a disabled submenu row is dimmed the way a disabled row is', async () => {
		await openMenu(
			barOf([
				{
					enabled: false,
					id: '0.0',
					items: [
						{
							enabled: false,
							id: '0.0.0',
							kind: 'action',
							label: 'No Run Scripts',
						},
					],
					kind: 'submenu',
					label: 'Run Script',
				},
				{
					enabled: false,
					id: '0.1',
					kind: 'action',
					label: 'Rename Workspace',
				},
			]),
		);

		const submenu = await screen.findByRole('menuitem', { name: /Run Script/ });
		const row = screen.getByRole('menuitem', { name: /Rename Workspace/ });

		expect(submenu).toHaveAttribute('data-disabled');
		expect(submenu).toHaveClass(DISABLED_DIM_CLASS);
		expect(row).toHaveClass(DISABLED_DIM_CLASS);
	});

	test('a chord is shown beside the row that claims one', async () => {
		await openMenu(
			barOf([
				{
					accelerator: 'Ctrl+R',
					enabled: true,
					id: '0.0',
					kind: 'action',
					label: 'Run',
				},
			]),
		);

		expect(
			await screen.findByRole('menuitem', { name: /Run\s+Ctrl\+R/ }),
		).toBeInTheDocument();
	});

	test('a checkbox row carries its checked state', async () => {
		await openMenu(
			barOf([
				{
					checked: true,
					enabled: true,
					id: '0.0',
					kind: 'action',
					label: 'Sidebar',
					mark: 'checkbox',
				},
			]),
		);

		expect(
			await screen.findByRole('menuitemcheckbox', { name: /Sidebar/ }),
		).toBeChecked();
	});

	test('a run of one-of-N rows becomes a radio group with one selected', async () => {
		await openMenu(
			barOf([
				{
					checked: false,
					enabled: true,
					id: '0.0',
					kind: 'action',
					label: 'Light',
					mark: 'radio',
				},
				{
					checked: true,
					enabled: true,
					id: '0.1',
					kind: 'action',
					label: 'Dark',
					mark: 'radio',
				},
			]),
		);

		expect(
			await screen.findByRole('menuitemradio', { name: /Dark/ }),
		).toBeChecked();
		expect(
			screen.getByRole('menuitemradio', { name: /Light/ }),
		).not.toBeChecked();
	});

	test('a nested submenu opens its own rows', async () => {
		await openMenu(
			barOf([
				{
					enabled: true,
					id: '0.0',
					items: [
						{ enabled: true, id: '0.0.0', kind: 'action', label: 'Dev Server' },
					],
					kind: 'submenu',
					label: 'Run Script',
				},
			]),
		);

		await userEvent.click(
			await screen.findByRole('menuitem', { name: /Run Script/ }),
		);

		expect(
			await screen.findByRole('menuitem', { name: /Dev Server/ }),
		).toBeInTheDocument();
	});

	test('a level holding a mark insets its unmarked rows so the labels line up', async () => {
		await openMenu(
			barOf([
				{
					checked: false,
					enabled: true,
					id: '0.0',
					kind: 'action',
					label: 'Run',
					mark: 'checkbox',
				},
				{ enabled: true, id: '0.1', kind: 'action', label: 'Run Setup Script' },
			]),
		);

		expect(
			await screen.findByRole('menuitem', { name: /Run Setup Script/ }),
		).toHaveAttribute('data-inset', 'true');
	});

	test('a level with no marks leaves its rows flush', async () => {
		await openMenu(
			barOf([
				{ enabled: true, id: '0.0', kind: 'action', label: 'Run Setup Script' },
			]),
		);

		expect(
			await screen.findByRole('menuitem', { name: /Run Setup Script/ }),
		).not.toHaveAttribute('data-inset', 'true');
	});

	test('every menu main sent gets a title in the bar', () => {
		renderWithProviders(
			<AppMenuBar
				menuBar={{
					menus: [
						{
							enabled: true,
							id: '0',
							items: [],
							kind: 'submenu',
							label: 'File',
						},
						{
							enabled: true,
							id: '1',
							items: [],
							kind: 'submenu',
							label: 'Edit',
						},
					],
					revision: 1,
				}}
				onSelect={vi.fn()}
			/>,
		);

		const bar = screen.getByRole('menubar');
		expect(
			within(bar)
				.getAllByRole('menuitem')
				.map((item) => item.textContent),
		).toEqual(['File', 'Edit']);
	});
});

/** A row that stands in for any command, plus the field the bar is opened over. */
const FOCUS_ROW: MenuBarAction = {
	enabled: true,
	id: '0.0',
	kind: 'action',
	label: 'Focus Composer',
};

/**
 * Renders the bar over a field and focuses that field, which is the state the
 * drawn bar is actually reached from.
 */
function renderOverField(
	bar: MenuBarDescriptor,
	onSelect: (item: MenuBarAction) => void,
): HTMLInputElement {
	renderWithProviders(
		<>
			<AppMenuBar menuBar={bar} onSelect={onSelect} />
			<input aria-label='Composer' />
		</>,
	);
	const field = screen.getByRole('textbox', { name: 'Composer' });
	field.focus();
	return field as HTMLInputElement;
}

/** Opens the bar's only menu and picks {@link FOCUS_ROW} from it. */
async function openAndChoose(): Promise<void> {
	await userEvent.click(screen.getByRole('menuitem', { name: 'Workspace' }));
	await userEvent.click(
		await screen.findByRole('menuitem', { name: /Focus Composer/ }),
	);
}

describe('AppMenuBar focus handover', () => {
	test('a chosen row is reported only once the menu has released focus', async () => {
		const openContentsAtReport: number[] = [];
		const onSelect = vi.fn(() => {
			openContentsAtReport.push(
				document.querySelectorAll('[data-slot="menubar-content"]').length,
			);
		});

		renderOverField(barOf([FOCUS_ROW]), onSelect);
		await openAndChoose();
		await waitFor(() => {
			expect(onSelect).toHaveBeenCalledWith(FOCUS_ROW);
		});

		expect(openContentsAtReport).toEqual([0]);
	});

	test('focus goes back to what the bar was opened over, not to the trigger', async () => {
		const field = renderOverField(barOf([FOCUS_ROW]), vi.fn());

		await openAndChoose();

		await waitFor(() => {
			expect(document.activeElement).toBe(field);
		});
	});

	// The round trip through main lands a tick or more after the menu closed, so
	// a trigger restore left on Radix's own timer would win this race.
	test('a command that moves focus after the round trip keeps it', async () => {
		const moved = vi.fn();
		const onSelect = vi.fn(() => {
			setTimeout(() => {
				screen.getByRole('textbox', { name: 'Elsewhere' }).focus();
				moved();
			}, 0);
		});

		renderWithProviders(
			<>
				<AppMenuBar menuBar={barOf([FOCUS_ROW])} onSelect={onSelect} />
				<input aria-label='Elsewhere' />
			</>,
		);
		await openAndChoose();
		await waitFor(() => {
			expect(moved).toHaveBeenCalled();
		});

		expect(document.activeElement).toBe(
			screen.getByRole('textbox', { name: 'Elsewhere' }),
		);
	});

	// A submenu row closes the whole menu, so the root content's handler is the
	// one that runs; Radix hard-codes the sub-content's own and ignores any given.
	test('a row inside a submenu is reported and hands focus back too', async () => {
		const row: MenuBarAction = {
			enabled: true,
			id: '0.0.0',
			kind: 'action',
			label: 'Dev Server',
		};
		const onSelect = vi.fn();
		const field = renderOverField(
			barOf([
				{
					enabled: true,
					id: '0.0',
					items: [row],
					kind: 'submenu',
					label: 'Run Script',
				},
			]),
			onSelect,
		);

		await userEvent.click(screen.getByRole('menuitem', { name: 'Workspace' }));
		await userEvent.click(
			await screen.findByRole('menuitem', { name: /Run Script/ }),
		);
		await userEvent.click(
			await screen.findByRole('menuitem', { name: /Dev Server/ }),
		);
		await waitFor(() => {
			expect(document.activeElement).toBe(field);
		});

		expect(onSelect).toHaveBeenCalledWith(row);
	});

	test('a menu dismissed without a choice still returns focus to its trigger', async () => {
		const onSelect = vi.fn();
		renderOverField(barOf([FOCUS_ROW]), onSelect);
		const trigger = screen.getByRole('menuitem', { name: 'Workspace' });

		await userEvent.click(trigger);
		await screen.findByRole('menuitem', { name: /Focus Composer/ });
		await userEvent.keyboard('{Escape}');
		await waitFor(() => {
			expect(document.activeElement).toBe(trigger);
		});

		expect(onSelect).not.toHaveBeenCalled();
	});

	// A dismissal leaves the trigger focused, so the reopen that follows it is
	// where the bar would otherwise record itself as the row's origin.
	test('reopening after an escape still hands focus back to the field', async () => {
		const field = renderOverField(barOf([FOCUS_ROW]), vi.fn());
		const trigger = screen.getByRole('menuitem', { name: 'Workspace' });

		await userEvent.click(trigger);
		await screen.findByRole('menuitem', { name: /Focus Composer/ });
		await userEvent.keyboard('{Escape}');
		await waitFor(() => {
			expect(document.activeElement).toBe(trigger);
		});

		await openAndChoose();

		await waitFor(() => {
			expect(document.activeElement).toBe(field);
		});
	});

	test('reopening after a click-to-close still hands focus back to the field', async () => {
		const field = renderOverField(barOf([FOCUS_ROW]), vi.fn());
		const trigger = screen.getByRole('menuitem', { name: 'Workspace' });

		await userEvent.click(trigger);
		await screen.findByRole('menuitem', { name: /Focus Composer/ });
		await userEvent.click(trigger);

		await openAndChoose();

		await waitFor(() => {
			expect(document.activeElement).toBe(field);
		});
	});
});
