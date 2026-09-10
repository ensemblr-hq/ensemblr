// @vitest-environment happy-dom

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { AgentsPanel } from '../../../src/renderer/components/workbench-shell/agents-panel/agents-panel';
import type { AgentConversation } from '../../../src/renderer/types/agents';
import { renderWithProviders } from '../support/dom';

const conversations: readonly AgentConversation[] = [
	{
		activity: { title: 'Inactive tool preview' },
		chatTabId: 'root',
		contextUsage: { maxTokens: 200_000, reading: 'live', usedTokens: 50_000 },
		depth: 0,
		isClosed: false,
		model: 'Claude Sonnet 4.5',
		parentChatTabId: null,
		runtime: 'claude',
		status: 'idle',
		title: 'Parent chat',
	},
	{
		activity: {
			parallelCount: 3,
			target: 'src/renderer/components/workbench-shell',
			title: 'Reading files',
		},
		chatTabId: 'child',
		contextUsage: null,
		depth: 1,
		isClosed: false,
		model: 'GPT-5.3 Codex',
		parentChatTabId: 'root',
		runtime: 'pi',
		status: 'working',
		title: 'Build the agents panel',
	},
];

test('renders the hierarchy and selects an open conversation', async () => {
	const onSelect = vi.fn();
	const { container } = renderWithProviders(
		<AgentsPanel
			conversations={conversations}
			onRestore={vi.fn()}
			onSelect={onSelect}
			selectedChatTabId='child'
		/>,
	);

	expect(container.querySelector('.rounded-full')).toBeNull();
	expect(screen.getByText('Working')).toBeVisible();
	expect(container.querySelector('header')).toBeNull();
	expect(screen.queryByRole('heading', { name: 'Agents' })).toBeNull();
	expect(screen.getAllByText('Context')).toHaveLength(2);
	expect(screen.getByText('Reading files')).toBeVisible();
	expect(screen.getByText('+2 parallel')).toBeVisible();
	expect(screen.queryByText('Inactive tool preview')).toBeNull();

	const child = screen.getByRole('button', {
		name: /Open Build the agents panel/,
	});
	expect(child).toHaveAttribute('aria-current', 'true');
	await userEvent.click(child);
	expect(onSelect).toHaveBeenCalledWith('child');
});

test('shows explicit non-interactive runtime icons and tolerates an absent runtime', async () => {
	const withoutRuntime: AgentConversation = {
		...conversations[0],
		chatTabId: 'without-runtime',
		model: 'GPT-5.3 Codex',
		runtime: undefined,
		title: 'Runtime unavailable',
	};
	renderWithProviders(
		<AgentsPanel
			conversations={[...conversations, withoutRuntime]}
			onRestore={vi.fn()}
			onSelect={vi.fn()}
		/>,
	);

	const claudeIcon = screen.getAllByRole('img', { name: 'Claude Code' })[0];
	const piIcon = screen.getByRole('img', { name: 'Pi' });
	expect(claudeIcon.tagName).toBe('SPAN');
	expect(piIcon.tagName).toBe('SPAN');
	expect(screen.getAllByRole('button')).toHaveLength(3);
	expect(
		within(
			screen.getByRole('button', { name: 'Open Runtime unavailable' }),
		).queryByRole('img'),
	).toBeNull();

	await userEvent.hover(piIcon);
	expect(screen.queryByRole('tooltip')).toBeNull();
});

test('keeps a closed parent above open descendants without counting it as open', async () => {
	const onRestore = vi.fn();
	const rows: readonly AgentConversation[] = [
		{
			activity: { title: 'Stale tool' },
			chatTabId: 'archived-parent',
			contextUsage: {
				maxTokens: 100_000,
				reading: 'last-recorded',
				usedTokens: 40_000,
			},
			depth: 0,
			isClosed: true,
			model: 'Claude Sonnet 4.5',
			parentChatTabId: null,
			status: 'working',
			title: 'Archived parent',
		},
		{
			chatTabId: 'open-child',
			contextUsage: null,
			depth: 1,
			isClosed: false,
			model: 'GPT-5.3 Codex',
			parentChatTabId: 'archived-parent',
			status: 'working',
			title: 'Open child',
		},
	];
	renderWithProviders(
		<AgentsPanel
			conversations={rows}
			onRestore={onRestore}
			onSelect={vi.fn()}
		/>,
	);

	const openSection = screen.getByRole('region', {
		name: 'Open conversations',
	});
	const openButtons = within(openSection).getAllByRole('button');
	expect(
		openButtons.map((button) => button.getAttribute('aria-label')),
	).toEqual(['Restore Archived parent', 'Open Open child']);
	expect(within(openSection).getByText('Closed parent chat')).toHaveClass(
		'sr-only',
	);
	expect(screen.queryByText('Stale tool')).toBeNull();

	const restoreButtons = screen.getAllByRole('button', {
		name: 'Restore Archived parent',
	});
	expect(restoreButtons).toHaveLength(1);
	await userEvent.click(restoreButtons[0]);
	expect(onRestore).toHaveBeenCalledWith('archived-parent');
});

test('nests connected branches under their actual parents and leaves archive rows flat', () => {
	const leaf: AgentConversation = {
		...conversations[1],
		chatTabId: 'leaf',
		parentChatTabId: 'child',
		depth: 2,
		title: 'Verify panel',
	};
	const closed: AgentConversation = {
		...leaf,
		chatTabId: 'closed-leaf',
		isClosed: true,
		title: 'Archived leaf',
	};
	renderWithProviders(
		<AgentsPanel
			conversations={[leaf, closed, ...conversations]}
			onRestore={vi.fn()}
			onSelect={vi.fn()}
		/>,
	);
	const root = screen
		.getByRole('button', { name: 'Open Parent chat' })
		.closest('li');
	const child = screen
		.getByRole('button', { name: 'Open Build the agents panel' })
		.closest('li');
	const leafRow = screen
		.getByRole('button', { name: 'Open Verify panel' })
		.closest('li');
	expect(root?.querySelector(':scope > ul')).toContainElement(child);
	expect(child?.querySelector(':scope > ul')).toContainElement(leafRow);
	expect(
		screen
			.getByRole('region', { name: 'Closed conversations' })
			.querySelector('[data-agent-branch]'),
	).toBeNull();
	expect(screen.getByText('Parent chat: Build the agents panel')).toBeVisible();
});

test('keeps an orphan leaf identity without inventing a hierarchy guide', () => {
	const orphan: AgentConversation = {
		...conversations[1],
		chatTabId: 'orphan-leaf',
		depth: 2,
		parentChatTabId: 'missing-parent',
		title: 'Orphan leaf',
	};
	renderWithProviders(
		<AgentsPanel
			conversations={[orphan]}
			onRestore={vi.fn()}
			onSelect={vi.fn()}
		/>,
	);

	const openSection = screen.getByRole('region', {
		name: 'Open conversations',
	});
	const row = screen.getByRole('button', { name: 'Open Orphan leaf' });
	expect(row.querySelector('.lucide-leaf')).toBeInTheDocument();
	expect(row.querySelector('.lucide-message-square')).toBeNull();
	expect(openSection.querySelector('[data-agent-branch]')).toBeNull();
});

test('explains a last-recorded context reading', async () => {
	const rows: readonly AgentConversation[] = [
		{
			chatTabId: 'closed',
			contextUsage: {
				maxTokens: 100_000,
				reading: 'last-recorded',
				usedTokens: 40_000,
			},
			depth: 0,
			isClosed: true,
			model: 'Claude Sonnet 4.5',
			parentChatTabId: null,
			status: 'idle',
			title: 'Recorded reading',
		},
	];
	renderWithProviders(
		<AgentsPanel conversations={rows} onRestore={vi.fn()} onSelect={vi.fn()} />,
	);

	await userEvent.hover(screen.getByText('40%'));
	expect(
		await screen.findByText('Last recorded: 40,000 of 100,000 tokens'),
	).toBeVisible();
});

test('explains an unavailable context reading', async () => {
	renderWithProviders(
		<AgentsPanel
			conversations={[
				conversations[0],
				{ ...conversations[1], contextUsage: null },
			]}
			onRestore={vi.fn()}
			onSelect={vi.fn()}
		/>,
	);

	await userEvent.hover(screen.getByText('—'));
	expect(await screen.findByText('Context unavailable')).toBeVisible();
});

test('keeps a failed restoration retryable and disables it only while pending', async () => {
	const onRestore = vi.fn();
	const closed: AgentConversation = {
		chatTabId: 'closed',
		contextUsage: null,
		depth: 0,
		isClosed: true,
		model: 'GPT-5.3 Codex',
		parentChatTabId: null,
		restoreState: 'error',
		status: 'idle',
		title: 'Retryable chat',
	};
	const view = renderWithProviders(
		<AgentsPanel
			conversations={[closed]}
			onRestore={onRestore}
			onSelect={vi.fn()}
		/>,
	);

	expect(screen.getByText('Restore failed. Try again.')).toBeVisible();
	const retryableRow = screen.getByRole('button', {
		name: 'Restore Retryable chat',
	});
	await userEvent.click(retryableRow);
	expect(onRestore).toHaveBeenCalledWith('closed');

	view.rerender(
		<AgentsPanel
			conversations={[{ ...closed, restoreState: 'pending' }]}
			onRestore={onRestore}
			onSelect={vi.fn()}
		/>,
	);
	const pendingRow = screen.getByRole('button', {
		name: 'Restore Retryable chat',
	});
	expect(pendingRow).toBeDisabled();
	expect(pendingRow).toHaveAttribute('aria-busy', 'true');
	expect(pendingRow).toHaveTextContent('Restoring…');
});

test('describes archived context on the keyboard-accessible row and never animates it', () => {
	const archived = {
		...conversations[0],
		isClosed: true,
		status: 'working' as const,
	};
	const { container } = renderWithProviders(
		<AgentsPanel
			conversations={[archived]}
			onRestore={vi.fn()}
			onSelect={vi.fn()}
		/>,
	);
	expect(
		screen.getByRole('button', { name: 'Restore Parent chat' }),
	).toHaveAccessibleDescription(/Last recorded: 50,000 of 200,000 tokens/);
	expect(container.querySelector('.animate-pulse')).toBeNull();
});

test('renders empty, loading, and retryable error states', async () => {
	const onRetry = vi.fn();
	const view = renderWithProviders(
		<AgentsPanel conversations={[]} onRestore={vi.fn()} onSelect={vi.fn()} />,
	);
	expect(screen.getByText('No agent conversations yet.')).toBeVisible();

	view.rerender(
		<AgentsPanel
			conversations={[]}
			onRestore={vi.fn()}
			onSelect={vi.fn()}
			state='loading'
		/>,
	);
	expect(screen.getByRole('status')).toHaveTextContent(
		'Loading agent conversations…',
	);

	view.rerender(
		<AgentsPanel
			conversations={[]}
			onRestore={vi.fn()}
			onRetry={onRetry}
			onSelect={vi.fn()}
			state='error'
		/>,
	);
	expect(screen.getByRole('alert')).toHaveTextContent(
		'Could not load agent conversations.',
	);
	await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
	expect(onRetry).toHaveBeenCalledOnce();
});
