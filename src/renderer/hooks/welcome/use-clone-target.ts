import { useCallback, useState } from 'react';

import { isUrlLikeInput } from '@/renderer/lib/welcome';
import type { CloneBranchSelection } from '@/renderer/types/welcome';

/** What the clone dialog is pointed at, and the affordances derived from it. */
interface CloneTarget {
	branchDisabled: boolean;
	branchSelection: CloneBranchSelection | null;
	/** Whether the URL names something clonable rather than a bare search term. */
	hasClonableUrl: boolean;
	setBranchSelection: (selection: CloneBranchSelection | null) => void;
	setUrl: (url: string) => void;
	trimmedUrl: string;
	url: string;
}

/**
 * Owns the repository the clone dialog points at together with the branch
 * picked from it, because the two are one piece of state: a branch belongs to
 * the repository it was listed from, so retargeting the dialog at another URL
 * has to drop it rather than clone one repo at another's branch name.
 * @param isBusy - Whether a clone is running, which locks the branch picker.
 * @returns The URL and branch fields plus what the form derives from them.
 */
export function useCloneTarget(isBusy: boolean): CloneTarget {
	const [url, setUrlState] = useState('');
	const [branchSelection, setBranchSelection] =
		useState<CloneBranchSelection | null>(null);

	const setUrl = useCallback((next: string) => {
		setUrlState(next);
		setBranchSelection(null);
	}, []);

	const trimmedUrl = url.trim();
	// Only URL-like input is a clonable target; a bare search term keeps the
	// primary action disabled so it can't kick off a doomed clone of the query.
	const hasClonableUrl = isUrlLikeInput(trimmedUrl);

	return {
		branchDisabled: isBusy || !hasClonableUrl,
		branchSelection,
		hasClonableUrl,
		setBranchSelection,
		setUrl,
		trimmedUrl,
		url,
	};
}
