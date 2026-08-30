// @vitest-environment happy-dom

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { AppMenuBar } from '@/renderer/components/workbench-shell/window-controls';
import type { MenuBarAction, MenuBarDescriptor } from '@/shared/menu-bar';

import { renderWithProviders } from './support/dom';

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
