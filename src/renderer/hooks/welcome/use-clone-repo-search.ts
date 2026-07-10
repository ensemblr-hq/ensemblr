import { useQuery } from '@tanstack/react-query';
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useMemo,
	useState,
} from 'react';

import {
	githubRepositoryFullListQuery,
	githubRepositoryListQuery,
} from '@/renderer/api/ensemblr-queries';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import {
	buildRepoSearchKeyBindings,
	deriveRepoSearchView,
	isUrlLikeInput,
	nextHighlightIndex,
} from '@/renderer/lib/welcome/github-repo-search';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type { GithubRepositoryEntry } from '@/shared/ipc/contracts/clone';

/** Search view-state and input handlers returned by {@link useCloneRepoSearch}. */
interface UseCloneRepoSearchResult {
	displayedEntries: GithubRepositoryEntry[];
	emptyMessage: string;
	footerHint: string | undefined;
	handleUrlChange: (value: string) => void;
	handleUrlKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
	highlightIndex: number;
	isDisplayLoading: boolean;
	isSearching: boolean;
	liveError: string | undefined;
	selectRepo: (repo: GithubRepositoryEntry) => void;
}

/**
 * Owns the clone dialog's repo-search behaviour: the recent + full gh-backed
 * queries, free-text filtering, keyboard highlight/confirm, and the derived
 * empty/loading/error copy. The full-scope query is fetched lazily — only once
 * the input holds a search term — so pasting a URL never triggers the heavier
 * multi-page fetch. The caller owns the shared `url` value (it doubles as the
 * clone target); this hook drives it through `handleUrlChange`/`selectRepo`.
 * @param options - The shared url value/setter, an enabled flag, and the submit callback.
 * @returns Search view-state plus input change/keydown handlers.
 */
export function useCloneRepoSearch({
	enabled,
	onSubmit,
	setUrl,
	url,
}: {
	enabled: boolean;
	onSubmit: () => void;
	setUrl: (value: string) => void;
	url: string;
}): UseCloneRepoSearchResult {
	const [highlightIndex, setHighlightIndex] = useState(-1);

	const trimmedUrl = url.trim();
	const isSearching = trimmedUrl.length > 0 && !isUrlLikeInput(trimmedUrl);

	const { data: recentData, isLoading: isRecentListLoading } = useQuery({
		...githubRepositoryListQuery,
		enabled,
	});
	const { data: fullData, isLoading: isFullListLoading } = useQuery({
		...githubRepositoryFullListQuery,
		enabled: enabled && isSearching,
	});

	// Memoized so `displayedEntries` keeps a stable identity across renders whose
	// inputs are unchanged; otherwise the fresh filter/sort array on every render
	// would defeat the `keyBindings` memo below.
	const view = useMemo(
		() =>
			deriveRepoSearchView({
				full: fullData,
				isFullLoading: isFullListLoading,
				isRecentLoading: isRecentListLoading,
				isSearching,
				query: trimmedUrl,
				recent: recentData,
			}),
		[
			fullData,
			isFullListLoading,
			isRecentListLoading,
			isSearching,
			recentData,
			trimmedUrl,
		],
	);
	const { displayedEntries } = view;

	// A stale highlight (e.g. the full-scope query resolves and narrows the list)
	// must never point past the last row; collapse it to "no selection".
	const highlight =
		highlightIndex < displayedEntries.length ? highlightIndex : -1;

	const handleUrlChange = useCallback(
		(value: string) => {
			setUrl(value);
			setHighlightIndex(-1);
		},
		[setUrl],
	);

	const selectRepo = useCallback(
		(repo: GithubRepositoryEntry) => {
			setUrl(`https://github.com/${repo.fullName}.git`);
			setHighlightIndex(-1);
		},
		[setUrl],
	);

	const moveHighlight = useCallback(
		(delta: number) => {
			setHighlightIndex((current) => {
				const base = current < displayedEntries.length ? current : -1;
				return nextHighlightIndex(base, delta, displayedEntries.length);
			});
		},
		[displayedEntries.length],
	);

	const keyBindings = useMemo<readonly KeymapBinding<HTMLInputElement>[]>(
		() =>
			buildRepoSearchKeyBindings({
				entries: displayedEntries,
				highlightIndex: highlight,
				isSearching,
				onHighlightMove: moveHighlight,
				onSelect: selectRepo,
				onSubmit,
			}),
		[
			displayedEntries,
			highlight,
			isSearching,
			moveHighlight,
			onSubmit,
			selectRepo,
		],
	);
	const handleUrlKeyDown = useKeymapHandler(keyBindings);

	return {
		...view,
		handleUrlChange,
		handleUrlKeyDown,
		highlightIndex: highlight,
		isSearching,
		selectRepo,
	};
}
