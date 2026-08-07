import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
	isEnsemblrApiAvailable,
	rootDirectoryQuery,
	selectCloneDestination,
} from '@/renderer/api/ensemblr-queries';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import { useCloneFlow } from '@/renderer/hooks/welcome/use-clone-flow';
import { useCloneRepoSearch } from '@/renderer/hooks/welcome/use-clone-repo-search';
import { isUrlLikeInput, joinDestination } from '@/renderer/lib/welcome';
import type { KeymapBinding } from '@/renderer/types/keymap';

/** Id tying the URL combobox to the repo results listbox it drives. */
export const RESULTS_LISTBOX_ID = 'clone-github-repo-results';

/**
 * Everything the clone dialog's form runs on: the URL and destination fields,
 * the repo search behind the URL box, the clone flow's stage and logs, and the
 * keyboard submit binding. Closes the dialog itself once a clone succeeds.
 * @param onOpenChange - Closes the dialog when the clone reaches success
 * @returns The field values, derived affordances, and handlers the form binds to
 */
export function useCloneDialogForm({
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
}) {
	const { data: rootDirectoryData } = useQuery({
		...rootDirectoryQuery,
		enabled: isEnsemblrApiAvailable(),
	});
	const defaultParentPath = rootDirectoryData?.repositoriesPath ?? '';

	const [url, setUrl] = useState('');
	const [locationOverride, setLocationOverride] = useState<string | null>(null);

	const { diagnostics, isBusy, logs, retry, stage, startClone } =
		useCloneFlow();

	useEffect(() => {
		if (stage === 'success') {
			onOpenChange(false);
		}
	}, [onOpenChange, stage]);

	// Derive the shown location: user override if they touched it, else the
	// managed default once the query resolves. Avoids a sync effect.
	const location = locationOverride ?? defaultParentPath;
	const trimmedUrl = url.trim();
	// Only URL-like input is a clonable target; a bare search term keeps the
	// primary action disabled so it can't kick off a doomed clone of the query.
	const canClone =
		!isBusy &&
		trimmedUrl.length > 0 &&
		isUrlLikeInput(trimmedUrl) &&
		isEnsemblrApiAvailable();

	const handleBrowse = useCallback(async () => {
		if (!isEnsemblrApiAvailable()) {
			return;
		}
		const selection = await selectCloneDestination();
		if (selection.canceled || !selection.path) {
			return;
		}
		setLocationOverride(selection.path);
	}, []);

	const handleClone = useCallback(async () => {
		if (!canClone) {
			return;
		}
		const parentOverride = location.trim();
		const destinationPath = parentOverride
			? joinDestination(parentOverride, trimmedUrl)
			: undefined;
		await startClone(
			destinationPath !== undefined
				? { destinationPath, url: trimmedUrl }
				: { url: trimmedUrl },
		);
	}, [canClone, location, startClone, trimmedUrl]);

	const search = useCloneRepoSearch({
		enabled: isEnsemblrApiAvailable(),
		onSubmit: handleClone,
		setUrl,
		url,
	});

	const submitBindings = useMemo<readonly KeymapBinding<HTMLInputElement>[]>(
		() => [
			[
				'dialog.submit',
				() => {
					handleClone();
				},
			],
		],
		[handleClone],
	);
	const handleSubmitKey = useKeymapHandler(submitBindings);

	return {
		activeDescendantId:
			search.isSearching && search.highlightIndex >= 0
				? `${RESULTS_LISTBOX_ID}-${search.highlightIndex}`
				: undefined,
		browseDisabled: isBusy || !isEnsemblrApiAvailable(),
		canClone,
		canResetLocation:
			locationOverride !== null &&
			Boolean(defaultParentPath) &&
			location !== defaultParentPath,
		diagnostics,
		handleBrowse,
		handleClone,
		handleSubmitKey,
		isBusy,
		location,
		locationPlaceholder: defaultParentPath || 'Managed repos directory',
		logs,
		resetLocation: () => setLocationOverride(null),
		retry,
		search,
		setLocation: setLocationOverride,
		stage,
		url,
	};
}
