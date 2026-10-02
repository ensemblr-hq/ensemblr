import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useMemo } from 'react';

/**
 * Persisted keys of backlog issues the user dropped on the Canceled column.
 * Dismissal is local to Ensemblr — nothing is written back to Linear or GitHub
 * (ADR 0024) — so the key is all that is kept, and restoring it puts the issue
 * back in Backlog.
 */
export const dismissedBoardIssueKeysAtom = atomWithStorage<string[]>(
	'ensemblr_dashboard_dismissed_issue_keys',
	[],
	undefined,
	{ getOnInit: true },
);

/** The dismissed backlog issue keys plus the actions that change them. */
export interface BoardIssueDismissals {
	dismiss: (issueKey: string) => void;
	dismissedKeys: string[];
	/** Drops keys for issues that are no longer on the board at all. */
	prune: (liveKeys: readonly string[]) => void;
	restore: (issueKey: string) => void;
}

/**
 * Reads and writes the set of backlog issues hidden from the board.
 * @returns The dismissed keys plus stable dismiss/restore/prune actions.
 */
export function useBoardIssueDismissals(): BoardIssueDismissals {
	const [dismissedKeys, setDismissedKeys] = useAtom(
		dismissedBoardIssueKeysAtom,
	);

	return useMemo(
		() => ({
			dismiss: (issueKey) =>
				setDismissedKeys((keys) =>
					keys.includes(issueKey) ? keys : [...keys, issueKey],
				),
			dismissedKeys,
			prune: (liveKeys) =>
				setDismissedKeys((keys) => {
					const live = new Set(liveKeys);
					const kept = keys.filter((key) => live.has(key));
					return kept.length === keys.length ? keys : kept;
				}),
			restore: (issueKey) =>
				setDismissedKeys((keys) => keys.filter((key) => key !== issueKey)),
		}),
		[dismissedKeys, setDismissedKeys],
	);
}
