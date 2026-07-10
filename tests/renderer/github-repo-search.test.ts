import { expect, test } from 'vitest';

import {
	buildRepoSearchKeyBindings,
	confirmKeyResult,
	deriveRepoSearchView,
	filterGithubRepositories,
	isUrlLikeInput,
	nextHighlightIndex,
} from '../../src/renderer/lib/welcome/github-repo-search.ts';
import type {
	GithubRepositoryEntry,
	GithubRepositoryListResult,
} from '../../src/shared/ipc/contracts/clone';

function repo(
	overrides: Partial<GithubRepositoryEntry> = {},
): GithubRepositoryEntry {
	return {
		avatarUrl: null,
		description: null,
		fullName: 'octo/hello-world',
		isPrivate: false,
		ownerLogin: 'octo',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

// --- isUrlLikeInput ---------------------------------------------------------

test('isUrlLikeInput recognizes an https URL', () => {
	expect(isUrlLikeInput('https://github.com/octo/hello-world')).toBe(true);
});

test('isUrlLikeInput recognizes an ssh:// URL', () => {
	expect(isUrlLikeInput('ssh://git@github.com/octo/hello-world.git')).toBe(
		true,
	);
});

test('isUrlLikeInput recognizes a scp-style git@ URL', () => {
	expect(isUrlLikeInput('git@github.com:octo/hello-world.git')).toBe(true);
});

test('isUrlLikeInput treats owner/name shorthand as search text', () => {
	expect(isUrlLikeInput('octo/hello-world')).toBe(false);
});

test('isUrlLikeInput treats empty input as not URL-like', () => {
	expect(isUrlLikeInput('')).toBe(false);
});

// --- filterGithubRepositories -----------------------------------------------

test('filterGithubRepositories returns an empty array for a blank query', () => {
	expect(filterGithubRepositories([repo()], '   ')).toEqual([]);
});

test('filterGithubRepositories ranks a fullName-prefix match above a name-prefix match', () => {
	const fullNameMatch = repo({ fullName: 'ensemblr/core' });
	const namePrefixMatch = repo({ fullName: 'octo/ensemblr-extras' });
	const results = filterGithubRepositories(
		[namePrefixMatch, fullNameMatch],
		'ensemblr',
	);
	expect(results.map((entry) => entry.fullName)).toEqual([
		'ensemblr/core',
		'octo/ensemblr-extras',
	]);
});

test('filterGithubRepositories ranks a name-prefix match above a name-substring match', () => {
	const namePrefixMatch = repo({ fullName: 'octo/ensemblr-extras' });
	const nameSubstringMatch = repo({ fullName: 'octo/the-ensemblr' });
	const results = filterGithubRepositories(
		[nameSubstringMatch, namePrefixMatch],
		'ensemblr',
	);
	expect(results.map((entry) => entry.fullName)).toEqual([
		'octo/ensemblr-extras',
		'octo/the-ensemblr',
	]);
});

test('filterGithubRepositories ranks a name-substring match above an owner-only match', () => {
	const nameSubstringMatch = repo({ fullName: 'octo/the-ensemblr' });
	const ownerMatch = repo({
		fullName: 'the-ensemblr-inc/widgets',
		ownerLogin: 'the-ensemblr-inc',
	});
	const results = filterGithubRepositories(
		[ownerMatch, nameSubstringMatch],
		'ensemblr',
	);
	expect(results.map((entry) => entry.fullName)).toEqual([
		'octo/the-ensemblr',
		'the-ensemblr-inc/widgets',
	]);
});

test('filterGithubRepositories ranks an owner-only match above a description-only match', () => {
	const ownerMatch = repo({
		fullName: 'the-ensemblr-inc/widgets',
		ownerLogin: 'the-ensemblr-inc',
	});
	const descriptionMatch = repo({
		description: 'Built for the ensemblr team',
		fullName: 'octo/widgets',
	});
	const results = filterGithubRepositories(
		[descriptionMatch, ownerMatch],
		'ensemblr',
	);
	expect(results.map((entry) => entry.fullName)).toEqual([
		'the-ensemblr-inc/widgets',
		'octo/widgets',
	]);
});

test('filterGithubRepositories AND-matches multiple whitespace-separated tokens', () => {
	const match = repo({ fullName: 'psoldunov/ensemblr' });
	const missingToken = repo({ fullName: 'psoldunov/other' });
	const results = filterGithubRepositories(
		[match, missingToken],
		'psoldunov ensemblr',
	);
	expect(results.map((entry) => entry.fullName)).toEqual([
		'psoldunov/ensemblr',
	]);
});

test('filterGithubRepositories tiebreaks equal ranks by updatedAt descending', () => {
	const older = repo({
		fullName: 'octo/widgets-old',
		updatedAt: '2026-01-01T00:00:00.000Z',
	});
	const newer = repo({
		fullName: 'octo/widgets-new',
		updatedAt: '2026-02-01T00:00:00.000Z',
	});
	const results = filterGithubRepositories([older, newer], 'widgets');
	expect(results.map((entry) => entry.fullName)).toEqual([
		'octo/widgets-new',
		'octo/widgets-old',
	]);
});

test('filterGithubRepositories caps results at 50', () => {
	const entries = Array.from({ length: 75 }, (_, index) =>
		repo({ fullName: `octo/widgets-${index}` }),
	);
	const results = filterGithubRepositories(entries, 'widgets');
	expect(results.length).toBe(50);
});

test('filterGithubRepositories treats a null description as unsearchable rather than throwing', () => {
	const entry = repo({ description: null, fullName: 'octo/widgets' });
	expect(() =>
		filterGithubRepositories([entry], 'nonexistent-term'),
	).not.toThrow();
	expect(filterGithubRepositories([entry], 'nonexistent-term')).toEqual([]);
});

test('filterGithubRepositories does not mutate the input array', () => {
	const entries = [
		repo({
			fullName: 'octo/b-widgets',
			updatedAt: '2026-01-01T00:00:00.000Z',
		}),
		repo({
			fullName: 'octo/a-widgets',
			updatedAt: '2026-02-01T00:00:00.000Z',
		}),
	];
	const snapshot = [...entries];

	filterGithubRepositories(entries, 'widgets');

	expect(entries).toEqual(snapshot);
});

// --- deriveRepoSearchView ----------------------------------------------------

function listResult(
	overrides: Partial<GithubRepositoryListResult> = {},
): GithubRepositoryListResult {
	return {
		entries: [],
		generatedAt: '2026-01-01T00:00:00.000Z',
		status: 'success',
		...overrides,
	};
}

test('deriveRepoSearchView shows the recent entries verbatim when not searching', () => {
	const recent = listResult({ entries: [repo({ fullName: 'octo/recent' })] });
	const view = deriveRepoSearchView({
		full: undefined,
		isFullLoading: false,
		isRecentLoading: false,
		isSearching: false,
		query: '',
		recent,
	});
	expect(view.displayedEntries.map((entry) => entry.fullName)).toEqual([
		'octo/recent',
	]);
	expect(view.emptyMessage).toBe('No repos to suggest yet.');
	expect(view.footerHint).toBeUndefined();
});

test('deriveRepoSearchView filters over recents and shows the hint while the full list loads', () => {
	const recent = listResult({
		entries: [repo({ fullName: 'octo/widgets' }), repo({ fullName: 'octo/x' })],
	});
	const view = deriveRepoSearchView({
		full: undefined,
		isFullLoading: true,
		isRecentLoading: false,
		isSearching: true,
		query: 'widgets',
		recent,
	});
	expect(view.displayedEntries.map((entry) => entry.fullName)).toEqual([
		'octo/widgets',
	]);
	expect(view.footerHint).toBe('Searching all repositories…');
	expect(view.emptyMessage).toBe('No matching repositories.');
});

test('deriveRepoSearchView filters over the full set once it succeeds', () => {
	const recent = listResult({ entries: [repo({ fullName: 'octo/recent' })] });
	const full = listResult({
		entries: [repo({ fullName: 'octo/deep-widgets' })],
	});
	const view = deriveRepoSearchView({
		full,
		isFullLoading: false,
		isRecentLoading: false,
		isSearching: true,
		query: 'widgets',
		recent,
	});
	expect(view.displayedEntries.map((entry) => entry.fullName)).toEqual([
		'octo/deep-widgets',
	]);
	expect(view.footerHint).toBeUndefined();
});

test('deriveRepoSearchView surfaces the full error while searching, falling back to recents', () => {
	const recent = listResult({ entries: [repo({ fullName: 'octo/widgets' })] });
	const full = listResult({ error: 'full boom', status: 'failure' });
	const view = deriveRepoSearchView({
		full,
		isFullLoading: false,
		isRecentLoading: false,
		isSearching: true,
		query: 'widgets',
		recent,
	});
	expect(view.liveError).toBe('full boom');
	// Falls back to the recent set rather than the failed full set.
	expect(view.displayedEntries.map((entry) => entry.fullName)).toEqual([
		'octo/widgets',
	]);
});

test('deriveRepoSearchView surfaces a recent error when not searching', () => {
	const recent = listResult({ error: 'recent boom', status: 'failure' });
	const view = deriveRepoSearchView({
		full: undefined,
		isFullLoading: false,
		isRecentLoading: false,
		isSearching: false,
		query: '',
		recent,
	});
	expect(view.liveError).toBe('recent boom');
});

test('deriveRepoSearchView only reports loading while both queries are in flight when searching', () => {
	const base = {
		full: undefined,
		isSearching: true,
		query: 'x',
		recent: listResult(),
	};
	expect(
		deriveRepoSearchView({
			...base,
			isFullLoading: true,
			isRecentLoading: true,
		}).isDisplayLoading,
	).toBe(true);
	expect(
		deriveRepoSearchView({
			...base,
			isFullLoading: true,
			isRecentLoading: false,
		}).isDisplayLoading,
	).toBe(false);
});

// --- buildRepoSearchKeyBindings ----------------------------------------------

type UrlKeyHandler = ReturnType<typeof buildRepoSearchKeyBindings>[number][1];

function handlerFor(
	bindings: ReturnType<typeof buildRepoSearchKeyBindings>,
	id: string,
): UrlKeyHandler {
	const found = bindings.find(([bindingId]) => bindingId === id);
	if (!found) {
		throw new Error(`no binding for ${id}`);
	}
	return found[1];
}

function keyEvent(key: string, isComposing = false) {
	return {
		key,
		nativeEvent: { isComposing },
	} as unknown as Parameters<UrlKeyHandler>[0];
}

test('buildRepoSearchKeyBindings moves the highlight only while searching', () => {
	const moves: number[] = [];
	const searching = buildRepoSearchKeyBindings({
		entries: [repo()],
		highlightIndex: -1,
		isSearching: true,
		onHighlightMove: (delta) => moves.push(delta),
		onSelect: () => {},
		onSubmit: () => {},
	});
	handlerFor(searching, 'autocomplete.next')(keyEvent('ArrowDown'));
	handlerFor(searching, 'autocomplete.prev')(keyEvent('ArrowUp'));
	expect(moves).toEqual([1, -1]);

	const idle = buildRepoSearchKeyBindings({
		entries: [repo()],
		highlightIndex: -1,
		isSearching: false,
		onHighlightMove: (delta) => moves.push(delta),
		onSelect: () => {},
		onSubmit: () => {},
	});
	expect(handlerFor(idle, 'autocomplete.next')(keyEvent('ArrowDown'))).toBe(
		false,
	);
	expect(moves).toEqual([1, -1]);
});

test('buildRepoSearchKeyBindings confirms the highlighted repo on Enter but falls through on Tab', () => {
	const selected: string[] = [];
	const bindings = buildRepoSearchKeyBindings({
		entries: [repo({ fullName: 'octo/a' }), repo({ fullName: 'octo/b' })],
		highlightIndex: 1,
		isSearching: true,
		onHighlightMove: () => {},
		onSelect: (chosen) => selected.push(chosen.fullName),
		onSubmit: () => {},
	});
	const confirm = handlerFor(bindings, 'autocomplete.confirm');
	expect(confirm(keyEvent('Tab'))).toBe(false);
	confirm(keyEvent('Enter'));
	expect(selected).toEqual(['octo/b']);
});

test('buildRepoSearchKeyBindings submits on the dialog.submit binding', () => {
	let submitted = 0;
	const bindings = buildRepoSearchKeyBindings({
		entries: [],
		highlightIndex: -1,
		isSearching: false,
		onHighlightMove: () => {},
		onSelect: () => {},
		onSubmit: () => {
			submitted += 1;
		},
	});
	handlerFor(bindings, 'dialog.submit')(keyEvent('Enter'));
	expect(submitted).toBe(1);
});

// --- confirmKeyResult --------------------------------------------------------

test('confirmKeyResult picks the first result when nothing is highlighted', () => {
	const entries = [repo({ fullName: 'octo/a' }), repo({ fullName: 'octo/b' })];
	expect(confirmKeyResult('Enter', false, true, entries, -1)?.fullName).toBe(
		'octo/a',
	);
});

test('confirmKeyResult picks the highlighted result', () => {
	const entries = [repo({ fullName: 'octo/a' }), repo({ fullName: 'octo/b' })];
	expect(confirmKeyResult('Enter', false, true, entries, 1)?.fullName).toBe(
		'octo/b',
	);
});

test('confirmKeyResult returns null for a non-Enter key (e.g. Tab)', () => {
	const entries = [repo({ fullName: 'octo/a' })];
	expect(confirmKeyResult('Tab', false, true, entries, -1)).toBeNull();
});

test('confirmKeyResult returns null while an IME composition is in flight', () => {
	const entries = [repo({ fullName: 'octo/a' })];
	expect(confirmKeyResult('Enter', true, true, entries, -1)).toBeNull();
});

test('confirmKeyResult returns null when not searching', () => {
	const entries = [repo({ fullName: 'octo/a' })];
	expect(confirmKeyResult('Enter', false, false, entries, -1)).toBeNull();
});

test('confirmKeyResult returns null when there are no results', () => {
	expect(confirmKeyResult('Enter', false, true, [], -1)).toBeNull();
});

test('confirmKeyResult returns null when the highlight is out of range', () => {
	const entries = [repo({ fullName: 'octo/a' })];
	expect(confirmKeyResult('Enter', false, true, entries, 5)).toBeNull();
});

// --- nextHighlightIndex ------------------------------------------------------

test('nextHighlightIndex moves forward within bounds', () => {
	expect(nextHighlightIndex(0, 1, 5)).toBe(1);
});

test('nextHighlightIndex clamps at the last index instead of cycling', () => {
	expect(nextHighlightIndex(4, 1, 5)).toBe(4);
});

test('nextHighlightIndex clamps at zero instead of cycling backward', () => {
	expect(nextHighlightIndex(0, -1, 5)).toBe(0);
});

test('nextHighlightIndex starts at the first row when moving forward from -1', () => {
	expect(nextHighlightIndex(-1, 1, 5)).toBe(0);
});

test('nextHighlightIndex returns -1 for an empty list', () => {
	expect(nextHighlightIndex(0, 1, 0)).toBe(-1);
});
