// @vitest-environment happy-dom

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';

import { AgentsMatrixScene } from '../../../playground/agents-matrix-preview.tsx';
import { AgentsNavigationScene } from '../../../playground/agents-navigation-preview.tsx';
import { renderWithProviders } from '../support/dom';

function expectSelectedTab(title: string) {
	expect(screen.getByTitle(title).closest('button')).toHaveAttribute(
		'aria-current',
		'page',
	);
}

test('puts Agents first with only the open count and no duplicate heading', () => {
	renderWithProviders(<AgentsMatrixScene />);
	const sidebar = screen.getByRole('complementary', {
		name: 'Agents',
	});

	const agentsTab = screen.getByRole('button', { name: 'Agents 5' });
	const tabs = Array.from(agentsTab.parentElement?.children ?? []);
	expect(tabs.map((tab) => tab.textContent)).toEqual([
		'Agents5',
		'All files',
		'Changes7',
		'Checks',
	]);
	expect(within(sidebar).queryByRole('heading', { name: 'Agents' })).toBeNull();
});

test('matrix restores and selects the same conversation', async () => {
	renderWithProviders(<AgentsMatrixScene />);
	await userEvent.click(
		screen.getByRole('button', { name: 'Restore Closed architecture audit' }),
	);
	expect(
		screen.getByRole('button', { name: 'Open Closed architecture audit' }),
	).toHaveAttribute('aria-current', 'true');
	expect(
		screen.queryByRole('button', { name: 'Restore Closed architecture audit' }),
	).toBeNull();
});

test('keeps chats upright and uses a real file tab to demonstrate preview pinning', async () => {
	const { container } = renderWithProviders(<AgentsNavigationScene />);
	expect(
		container.querySelector('[data-tab-key="root-review"] .italic'),
	).toBeNull();
	const preview = container.querySelector(
		'[data-tab-key="agents-file-preview"] span[title]',
	);
	expect(preview).toHaveClass('italic');
	await userEvent.dblClick(preview as HTMLElement);
	expect(preview).not.toHaveClass('italic');
	expect(
		screen.getByRole('complementary', { name: 'Agents' }),
	).not.toHaveTextContent('agents-panel.tsx');
});

test('sidebar selection drives the matching session tab', async () => {
	renderWithProviders(<AgentsNavigationScene />);

	await userEvent.click(
		screen.getByRole('button', { name: /Open Build hierarchy fixtures/ }),
	);
	expectSelectedTab('Build hierarchy fixtures');
});

test('closed ancestors remain once in the open hierarchy while descendants are open', async () => {
	renderWithProviders(<AgentsNavigationScene />);

	await userEvent.click(
		screen.getByRole('button', { name: 'Close Root roadmap tab' }),
	);
	await userEvent.click(
		screen.getByRole('button', { name: 'Close Build hierarchy fixtures tab' }),
	);

	const open = screen.getByRole('region', { name: 'Open conversations' });
	const closed = screen.getByRole('region', { name: 'Closed conversations' });
	for (const title of ['Root roadmap', 'Build hierarchy fixtures']) {
		expect(
			within(open).getByRole('button', { name: `Restore ${title}` }),
		).toBeVisible();
		expect(
			within(closed).queryByRole('button', { name: `Restore ${title}` }),
		).toBeNull();
	}
	expectSelectedTab(
		'Verify an intentionally very long leaf conversation title stays readable without taking over the rail',
	);
});

test('history and row restoration preserve identity and select the conversation', async () => {
	renderWithProviders(<AgentsNavigationScene />);

	await userEvent.click(
		screen.getByRole('button', { name: 'Restore Closed architecture audit' }),
	);
	expectSelectedTab('Closed architecture audit');

	await userEvent.click(
		screen.getByRole('button', {
			name: 'Close Closed architecture audit tab',
		}),
	);
	await userEvent.click(
		screen.getByRole('button', { name: 'Open closed chat tabs' }),
	);
	await userEvent.click(
		screen.getByRole('menuitem', { name: /Closed architecture audit/ }),
	);
	expectSelectedTab('Closed architecture audit');
});

test('narrow selection and restoration dismiss the sheet', async () => {
	renderWithProviders(<AgentsNavigationScene initialNarrow />);

	await userEvent.click(
		screen.getByRole('button', { name: /Open Build hierarchy fixtures/ }),
	);
	expect(screen.queryByRole('dialog')).toBeNull();

	await userEvent.click(
		screen.getByRole('button', { name: 'Open agents sidebar' }),
	);
	await userEvent.click(
		screen.getByRole('button', { name: 'Restore Closed architecture audit' }),
	);
	expect(screen.queryByRole('dialog')).toBeNull();
});

test('failed restoration stays closed and can be retried', async () => {
	renderWithProviders(<AgentsNavigationScene initialRestoreFailure />);

	await userEvent.click(
		screen.getByRole('button', { name: 'Restore Closed architecture audit' }),
	);
	expect(screen.getByText('Restore failed. Try again.')).toBeVisible();
	expect(
		screen.getByRole('button', { name: 'Restore Closed architecture audit' }),
	).toBeEnabled();

	await userEvent.click(
		screen.getByRole('button', { name: 'Restore Closed architecture audit' }),
	);
	expectSelectedTab('Closed architecture audit');
});
