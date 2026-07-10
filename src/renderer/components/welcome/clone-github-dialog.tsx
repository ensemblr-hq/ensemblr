import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
	isEnsemblrApiAvailable,
	rootDirectoryQuery,
	selectCloneDestination,
} from '@/renderer/api/ensemblr-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import { useCloneFlow } from '@/renderer/hooks/welcome/use-clone-flow';
import { useCloneRepoSearch } from '@/renderer/hooks/welcome/use-clone-repo-search';
import { joinDestination } from '@/renderer/lib/welcome/clone-destination';
import { isUrlLikeInput } from '@/renderer/lib/welcome/github-repo-search';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type { CloneStage } from '@/renderer/types/welcome';

import { CloneGithubDiagnostics } from './clone-github-diagnostics.tsx';
import { CloneGithubProgressLog } from './clone-github-progress-log.tsx';
import { CloneGithubRecentRepos } from './clone-github-recent-repos.tsx';

const RESULTS_LISTBOX_ID = 'clone-github-repo-results';

/** Modal for cloning a GitHub repository into the managed root. */
export function CloneGithubDialog({
	onOpenChange,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
			}}
			open={open}
		>
			<DialogContent className='flex max-h-[min(85vh,42rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg'>
				<CloneGithubDialogForm
					key={open ? 'open' : 'closed'}
					onOpenChange={onOpenChange}
				/>
			</DialogContent>
		</Dialog>
	);
}

/** State-owned clone form content that resets when the dialog open state changes. */
function CloneGithubDialogForm({
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
	const locationPlaceholder = defaultParentPath || 'Managed repos directory';

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
	const activeDescendantId =
		search.isSearching && search.highlightIndex >= 0
			? `${RESULTS_LISTBOX_ID}-${search.highlightIndex}`
			: undefined;

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

	return (
		<>
			<DialogHeader className='px-4 pt-4'>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Clone GitHub repo
				</DialogTitle>
			</DialogHeader>

			<div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-3'>
				<div className='flex flex-col gap-1.5'>
					<Label className='text-xs' htmlFor='clone-github-url'>
						Repository URL
					</Label>
					<Input
						aria-activedescendant={activeDescendantId}
						aria-controls={RESULTS_LISTBOX_ID}
						aria-expanded={search.isSearching}
						autoFocus
						className='h-9'
						disabled={isBusy}
						id='clone-github-url'
						onChange={(event) => search.handleUrlChange(event.target.value)}
						onKeyDown={search.handleUrlKeyDown}
						placeholder='Search repos or paste URL'
						role='combobox'
						value={url}
					/>
				</div>

				<div className='flex flex-col gap-1.5'>
					<Label className='text-xs'>
						{search.isSearching ? 'Matching repos' : 'Recent repos'}
					</Label>
					<CloneGithubRecentRepos
						disabled={isBusy}
						emptyMessage={search.emptyMessage}
						footerHint={search.footerHint}
						highlightedIndex={search.isSearching ? search.highlightIndex : -1}
						isLoading={search.isDisplayLoading}
						listboxId={RESULTS_LISTBOX_ID}
						onSelect={search.selectRepo}
						repos={search.displayedEntries}
					/>
					{search.liveError ? (
						<p className='text-muted-foreground text-xxs'>{search.liveError}</p>
					) : null}
				</div>

				<div className='flex flex-col gap-1.5'>
					<Label className='text-xs' htmlFor='clone-github-location'>
						Location
					</Label>
					<div className='flex gap-2'>
						<Input
							className='h-9 flex-1 font-mono text-xs'
							disabled={isBusy}
							id='clone-github-location'
							onChange={(event) => {
								setLocationOverride(event.target.value);
							}}
							onKeyDown={handleSubmitKey}
							placeholder={locationPlaceholder}
							value={location}
						/>
						<Button
							className='h-9'
							disabled={isBusy || !isEnsemblrApiAvailable()}
							onClick={handleBrowse}
							type='button'
							variant='outline'
						>
							Browse
						</Button>
					</div>
					{locationOverride !== null &&
					defaultParentPath &&
					location !== defaultParentPath ? (
						<button
							className='self-start text-muted-foreground text-xxs underline-offset-2 hover:underline'
							onClick={() => {
								setLocationOverride(null);
							}}
							type='button'
						>
							Reset to managed repos directory
						</button>
					) : null}
				</div>

				{logs.length > 0 ? <CloneGithubProgressLog logs={logs} /> : null}

				{stage === 'failure' && diagnostics.length > 0 ? (
					<CloneGithubDiagnostics diagnostics={diagnostics} />
				) : null}
			</div>

			<div className='flex shrink-0 justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
				{stage === 'failure' ? (
					<Button
						className='h-8'
						onClick={retry}
						type='button'
						variant='outline'
					>
						Try again
					</Button>
				) : null}
				<Button
					className='h-8 gap-2'
					disabled={!canClone}
					onClick={handleClone}
					type='button'
					variant='default'
				>
					{getCloneButtonLabel(stage)}
					<span
						aria-hidden='true'
						className='ml-1 inline-flex items-center gap-0.5 text-xxs opacity-70'
					>
						⌘↵
					</span>
				</Button>
			</div>
		</>
	);
}

/** Picks the clone button label that matches the current stage. */
function getCloneButtonLabel(stage: CloneStage): string {
	switch (stage) {
		case 'preparing':
			return 'Preparing…';
		case 'cloning':
			return 'Cloning…';
		case 'opening':
			return 'Opening…';
		case 'failure':
		case 'idle':
		case 'success':
			return 'Clone repo';
	}
}
