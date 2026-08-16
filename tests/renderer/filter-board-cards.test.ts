import { describe, expect, test } from 'vitest';

import { filterBoardCards } from '../../src/renderer/lib/workbench/filter-board-cards';
import { DEFAULT_BOARD_FILTERS } from '../../src/renderer/state/workspace';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import type {
	BoardCard,
	BoardIssueCard,
} from '../../src/renderer/types/workbench-shell';

function workspaceCard({
	branchName = 'psoldunov/board',
	id,
	name,
	projectId = 'repo-1',
	projectName = 'copland',
	updatedAt,
}: {
	branchName?: string;
	id: string;
	name: string;
	projectId?: string;
	projectName?: string;
	updatedAt?: string;
}): BoardCard {
	const workspace = {
		branchName,
		id,
		name,
		projectId,
		...(updatedAt ? { updatedAt } : {}),
	} as WorkspaceShellModel;
	const project = { id: projectId, name: projectName } as ProjectShellModel;
	return { kind: 'workspace', project, workspace };
}

function issueCard(overrides: Partial<BoardIssueCard> = {}): BoardCard {
	const issue: BoardIssueCard = {
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
	return { issue, kind: 'issue' };
}

const keysOf = (cards: BoardCard[]) =>
	cards.map((card) =>
		card.kind === 'workspace' ? card.workspace.id : card.issue.key,
	);

describe('filterBoardCards source facet', () => {
	const cards = [
		workspaceCard({ id: 'w1', name: 'Fern' }),
		issueCard({ key: 'lin', provider: 'linear' }),
		issueCard({ key: 'gh', projectId: 'repo-1', provider: 'github' }),
	];

	test('keeps everything when no source is selected', () => {
		expect(keysOf(filterBoardCards(cards, DEFAULT_BOARD_FILTERS))).toEqual([
			'w1',
			'lin',
			'gh',
		]);
	});

	test('narrows to the selected sources', () => {
		const filtered = filterBoardCards(cards, {
			...DEFAULT_BOARD_FILTERS,
			sources: ['linear', 'github'],
		});
		expect(keysOf(filtered)).toEqual(['lin', 'gh']);
	});

	test('treats every workspace card as the workspace source', () => {
		const filtered = filterBoardCards(cards, {
			...DEFAULT_BOARD_FILTERS,
			sources: ['workspace'],
		});
		expect(keysOf(filtered)).toEqual(['w1']);
	});
});

describe('filterBoardCards repository facet', () => {
	const cards = [
		workspaceCard({ id: 'w1', name: 'Fern', projectId: 'repo-1' }),
		workspaceCard({ id: 'w2', name: 'Larch', projectId: 'repo-2' }),
		issueCard({ key: 'gh', projectId: 'repo-2', provider: 'github' }),
		issueCard({ key: 'lin', projectId: null }),
	];

	test('narrows repo-scoped cards to the selected repositories', () => {
		const filtered = filterBoardCards(cards, {
			...DEFAULT_BOARD_FILTERS,
			repoIds: ['repo-2'],
		});
		expect(keysOf(filtered)).toEqual(['w2', 'gh', 'lin']);
	});

	test('keeps cards that belong to no repository, which Linear issues never do', () => {
		const filtered = filterBoardCards(cards, {
			...DEFAULT_BOARD_FILTERS,
			repoIds: ['repo-1'],
		});
		expect(keysOf(filtered)).toEqual(['w1', 'lin']);
	});
});

describe('filterBoardCards free-text query', () => {
	const cards = [
		workspaceCard({ branchName: 'psoldunov/toolbar', id: 'w1', name: 'Fern' }),
		issueCard({ key: 'lin', title: 'Wire the board' }),
		issueCard({
			key: 'gh',
			labels: ['composer'],
			reference: '#42',
			title: 'Paste loses the file',
		}),
	];

	test('matches a workspace on its branch name', () => {
		const filtered = filterBoardCards(cards, {
			...DEFAULT_BOARD_FILTERS,
			query: 'TOOLBAR',
		});
		expect(keysOf(filtered)).toEqual(['w1']);
	});

	test('matches an issue on its title, reference, and labels', () => {
		expect(
			keysOf(
				filterBoardCards(cards, { ...DEFAULT_BOARD_FILTERS, query: 'board' }),
			),
		).toEqual(['lin']);
		expect(
			keysOf(
				filterBoardCards(cards, { ...DEFAULT_BOARD_FILTERS, query: '#4' }),
			),
		).toEqual(['gh']);
		expect(
			keysOf(
				filterBoardCards(cards, {
					...DEFAULT_BOARD_FILTERS,
					query: 'composer',
				}),
			),
		).toEqual(['gh']);
	});

	test('ignores surrounding whitespace and keeps everything when blank', () => {
		expect(
			keysOf(
				filterBoardCards(cards, { ...DEFAULT_BOARD_FILTERS, query: '  ' }),
			),
		).toHaveLength(3);
	});
});

describe('filterBoardCards sort', () => {
	const cards = [
		issueCard({ key: 'low', priority: 4, updatedAt: '2026-08-10T00:00:00Z' }),
		issueCard({
			key: 'urgent',
			priority: 1,
			updatedAt: '2026-08-01T00:00:00Z',
		}),
		issueCard({ key: 'none', priority: null, updatedAt: null }),
	];

	test('manual leaves the caller order alone', () => {
		expect(keysOf(filterBoardCards(cards, DEFAULT_BOARD_FILTERS))).toEqual([
			'low',
			'urgent',
			'none',
		]);
	});

	test('priority sorts urgent first and unprioritized last', () => {
		const filtered = filterBoardCards(cards, {
			...DEFAULT_BOARD_FILTERS,
			sort: 'priority',
		});
		expect(keysOf(filtered)).toEqual(['urgent', 'low', 'none']);
	});

	test('updated sorts newest first and undated last', () => {
		const filtered = filterBoardCards(cards, {
			...DEFAULT_BOARD_FILTERS,
			sort: 'updated',
		});
		expect(keysOf(filtered)).toEqual(['low', 'urgent', 'none']);
	});

	test('updated reads a workspace timestamp too', () => {
		const mixed = [
			workspaceCard({
				id: 'older',
				name: 'Fern',
				updatedAt: '2026-08-02T00:00:00Z',
			}),
			workspaceCard({
				id: 'newer',
				name: 'Larch',
				updatedAt: '2026-08-15T00:00:00Z',
			}),
		];
		const filtered = filterBoardCards(mixed, {
			...DEFAULT_BOARD_FILTERS,
			sort: 'updated',
		});
		expect(keysOf(filtered)).toEqual(['newer', 'older']);
	});

	test('does not mutate the input list', () => {
		const input = [...cards];
		filterBoardCards(input, { ...DEFAULT_BOARD_FILTERS, sort: 'priority' });
		expect(keysOf(input)).toEqual(['low', 'urgent', 'none']);
	});
});
