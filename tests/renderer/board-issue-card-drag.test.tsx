// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import type { BoardIssueCard } from '@/renderer/types/workbench-shell';

import { renderWithProviders } from './support/dom';

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		to,
		...props
	}: { children: ReactNode; to: string } & ComponentProps<'a'>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

const { IssueCard } = await import(
	'@/renderer/components/workbench-shell/dashboard/issue-card'
);

function issue(overrides: Partial<BoardIssueCard> = {}): BoardIssueCard {
	return {
		item: { issue: {} as never, kind: 'linear-issue' },
		key: 'linear-1',
		labels: [],
		priority: null,
		projectId: null,
		provider: 'linear',
		reference: 'ENS-1',
		stateColor: null,
		stateName: 'Todo',
		stateType: 'unstarted',
		subtitle: 'Ensemblr',
		title: 'Wire the board',
		updatedAt: null,
		url: 'https://linear.app/e/issue/ENS-1',
		...overrides,
	};
}

function renderCard(overrides: Partial<BoardIssueCard> = {}) {
	renderWithProviders(
		<IssueCard
			allowReorder={true}
			isDismissed={false}
			issue={issue(overrides)}
			onAssign={() => undefined}
			onDismiss={() => undefined}
			onRestore={() => undefined}
		/>,
	);
	return screen.getByRole('link', { name: /Open issue/ });
}

// An anchor is draggable by default, so the browser makes it the `dragstart`
// target rather than the wrapper `useCardDnd` registered. Pragmatic-drag-and-drop
// then finds no matching draggable and abandons the drag, which stranded every
// card in the Backlog column.
describe('IssueCard drag source', () => {
	test('opts the Linear router link out of native dragging', () => {
		expect(renderCard()).toHaveAttribute('draggable', 'false');
	});

	test('opts the GitHub external link out of native dragging', () => {
		const link = renderCard({
			provider: 'github',
			reference: '#42',
			url: 'https://github.com/o/r/issues/42',
		});
		expect(link).toHaveAttribute('draggable', 'false');
		expect(link).toHaveAttribute('target', '_blank');
	});

	test('leaves the card wrapper as the only draggable element', () => {
		const link = renderCard();
		const nativelyDraggable = document.querySelectorAll(
			'[draggable]:not([draggable="false"])',
		);
		expect(Array.from(nativelyDraggable)).not.toContain(link);
	});
});
