import type { KeymapBinding } from '@/renderer/types/keymap';
import type {
	GithubRepositoryEntry,
	GithubRepositoryListResult,
} from '@/shared/ipc/contracts/clone';

const MAX_RESULTS = 50;
const URL_SCHEME_PATTERN = /^[a-z]+:\/\//i;

/**
 * True when the input looks like a URL to paste (scheme:// or scp-style
 * `git@host:...`) rather than free-text to search by. `owner/name` shorthand
 * is intentionally treated as search text — it matches via `fullName`.
 */
export function isUrlLikeInput(value: string): boolean {
	return URL_SCHEME_PATTERN.test(value) || value.startsWith('git@');
}

/**
 * Filters and ranks repos against a free-text query. Every whitespace-split
 * token must match (AND) somewhere in `fullName`/name/owner/description.
 * Matches rank fullName-prefix > name-prefix > name-substring > owner >
 * description, tiebroken by `updatedAt` descending, capped to 50 results.
 * Returns a new array; never mutates `entries`.
 */
export function filterGithubRepositories(
	entries: readonly GithubRepositoryEntry[],
	query: string,
): GithubRepositoryEntry[] {
	const trimmedQuery = query.trim().toLowerCase();
	if (!trimmedQuery) {
		return [];
	}
	const tokens = trimmedQuery.split(/\s+/);

	const matched = entries.filter((entry) => {
		const fields = searchableFields(entry);
		return tokens.every((token) =>
			fields.some((field) => field.includes(token)),
		);
	});

	return matched
		.map((entry) => ({ entry, rank: rankMatch(entry, trimmedQuery) }))
		.sort((a, b) => {
			if (a.rank !== b.rank) {
				return a.rank - b.rank;
			}
			return b.entry.updatedAt.localeCompare(a.entry.updatedAt);
		})
		.slice(0, MAX_RESULTS)
		.map(({ entry }) => entry);
}

/** Derived view-state for the clone dialog's repo list, per {@link deriveRepoSearchView}. */
interface RepoSearchView {
	displayedEntries: GithubRepositoryEntry[];
	emptyMessage: string;
	footerHint: string | undefined;
	isDisplayLoading: boolean;
	liveError: string | undefined;
}

/**
 * Derives what the repo list should show from the recent + full query results.
 * When searching, results filter over the full set once it succeeds, otherwise
 * over the recent set as a progressive fallback; the "Searching all
 * repositories…" hint stays visible while the full query is still in flight, and
 * a full-scope error only surfaces while searching. Pure so its branch matrix is
 * unit-testable without React.
 */
export function deriveRepoSearchView(input: {
	full: GithubRepositoryListResult | undefined;
	isFullLoading: boolean;
	isRecentLoading: boolean;
	isSearching: boolean;
	query: string;
	recent: GithubRepositoryListResult | undefined;
}): RepoSearchView {
	const { full, isFullLoading, isRecentLoading, isSearching, query, recent } =
		input;
	const recentEntries = recent?.entries ?? [];
	const searchSource =
		full?.status === 'success' ? full.entries : recentEntries;
	return {
		displayedEntries: isSearching
			? filterGithubRepositories(searchSource, query)
			: recentEntries,
		emptyMessage: isSearching
			? 'No matching repositories.'
			: 'No repos to suggest yet.',
		footerHint:
			isSearching && isFullLoading ? 'Searching all repositories…' : undefined,
		isDisplayLoading: isSearching
			? isRecentLoading && isFullLoading
			: isRecentLoading,
		liveError:
			isSearching && full?.status === 'failure'
				? full.error
				: recent?.status === 'failure'
					? recent.error
					: undefined,
	};
}

/**
 * Builds the keymap table for the search input: arrow keys move the highlight
 * (only while searching), Enter confirms the highlighted/first result, and
 * ⌘Enter submits the clone. Pure — takes plain state plus callbacks — so the
 * guard logic is unit-testable without mounting the dialog.
 */
export function buildRepoSearchKeyBindings(input: {
	entries: readonly GithubRepositoryEntry[];
	highlightIndex: number;
	isSearching: boolean;
	onHighlightMove: (delta: number) => void;
	onSelect: (repo: GithubRepositoryEntry) => void;
	onSubmit: () => void;
}): KeymapBinding<HTMLInputElement>[] {
	const {
		entries,
		highlightIndex,
		isSearching,
		onHighlightMove,
		onSelect,
		onSubmit,
	} = input;
	return [
		[
			'autocomplete.next',
			() => {
				if (!isSearching) {
					return false;
				}
				onHighlightMove(1);
			},
		],
		[
			'autocomplete.prev',
			() => {
				if (!isSearching) {
					return false;
				}
				onHighlightMove(-1);
			},
		],
		[
			'autocomplete.confirm',
			(event) => {
				const repo = confirmKeyResult(
					event.key,
					event.nativeEvent.isComposing,
					isSearching,
					entries,
					highlightIndex,
				);
				if (!repo) {
					return false;
				}
				onSelect(repo);
			},
		],
		[
			'dialog.submit',
			() => {
				onSubmit();
			},
		],
	];
}

/**
 * Resolves which repo a confirm keypress in the search box should select, or
 * `null` when the press must fall through untouched: not Enter, an in-flight IME
 * composition, not in search mode, or no selectable row. A `highlightIndex` of
 * `-1` means "no active row" and resolves to the first result. Kept a pure
 * function (primitive args, no event object) so every branch is unit-testable.
 */
export function confirmKeyResult(
	key: string,
	isComposing: boolean,
	isSearching: boolean,
	entries: readonly GithubRepositoryEntry[],
	highlightIndex: number,
): GithubRepositoryEntry | null {
	if (key !== 'Enter' || isComposing || !isSearching) {
		return null;
	}
	if (entries.length === 0) {
		return null;
	}
	return entries[highlightIndex === -1 ? 0 : highlightIndex] ?? null;
}

/** Clamps the next highlighted row index to `[0, length - 1]`; never cycles. */
export function nextHighlightIndex(
	current: number,
	delta: number,
	length: number,
): number {
	if (length <= 0) {
		return -1;
	}
	return Math.min(Math.max(current + delta, 0), length - 1);
}

/** Last path segment of `owner/name`, used for name-specific ranking. */
function repositoryName(entry: GithubRepositoryEntry): string {
	const segments = entry.fullName.split('/');
	return segments[segments.length - 1] ?? entry.fullName;
}

/**
 * Collects the lowercased repository fields a search query is matched against.
 * @param entry - The repository entry to read
 * @returns Full name, short name, owner login, and description, all lowercased
 */
function searchableFields(entry: GithubRepositoryEntry): string[] {
	return [
		entry.fullName.toLowerCase(),
		repositoryName(entry).toLowerCase(),
		entry.ownerLogin.toLowerCase(),
		(entry.description ?? '').toLowerCase(),
	];
}

/** Lower is better. `query` is already trimmed + lowercased. */
function rankMatch(entry: GithubRepositoryEntry, query: string): number {
	const fullName = entry.fullName.toLowerCase();
	const name = repositoryName(entry).toLowerCase();
	const owner = entry.ownerLogin.toLowerCase();
	const description = (entry.description ?? '').toLowerCase();

	if (fullName.startsWith(query)) {
		return 0;
	}
	if (name.startsWith(query)) {
		return 1;
	}
	if (name.includes(query)) {
		return 2;
	}
	if (owner.includes(query)) {
		return 3;
	}
	if (description.includes(query)) {
		return 4;
	}
	return 5;
}
