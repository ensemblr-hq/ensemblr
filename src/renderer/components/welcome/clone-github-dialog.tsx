import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
	githubRepositoryListQuery,
	isEnsembleApiAvailable,
	rootDirectoryQuery,
	selectCloneDestination,
} from '@/renderer/api/ensemble-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import {
	type KeymapBinding,
	useKeymapHandler,
} from '@/renderer/hooks/use-keymap-handler';
import type { GithubRepositoryEntry } from '@/shared/ipc/contracts/clone';

import { joinDestination } from './clone-destination.ts';
import { CloneGithubDiagnostics } from './clone-github-diagnostics.tsx';
import { CloneGithubProgressLog } from './clone-github-progress-log.tsx';
import { CloneGithubRecentRepos } from './clone-github-recent-repos.tsx';
import { type CloneStage, useCloneFlow } from './use-clone-flow.ts';

interface CloneGithubDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

/** Modal for cloning a GitHub repository into the managed root. */
export function CloneGithubDialog({
	onOpenChange,
	open,
}: CloneGithubDialogProps) {
	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
			}}
			open={open}
		>
			<DialogContent className='gap-3 sm:max-w-lg'>
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
		enabled: isEnsembleApiAvailable(),
	});
	const defaultParentPath = rootDirectoryData?.repositoriesPath ?? '';

	const { data: githubRepoListData, isLoading: isGithubRepoListLoading } =
		useQuery({
			...githubRepositoryListQuery,
			enabled: isEnsembleApiAvailable(),
		});
	const displayedEntries: GithubRepositoryEntry[] =
		githubRepoListData?.entries ?? [];
	const liveError =
		githubRepoListData?.status === 'failure'
			? githubRepoListData.error
			: undefined;

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
	const canClone = !isBusy && trimmedUrl.length > 0 && isEnsembleApiAvailable();
	const locationPlaceholder = defaultParentPath || 'Managed repos directory';

	const handleBrowse = useCallback(async () => {
		if (!isEnsembleApiAvailable()) {
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
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Clone GitHub repo
				</DialogTitle>
			</DialogHeader>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='clone-github-url'>
					Repository URL
				</Label>
				<Input
					autoFocus
					className='h-9'
					disabled={isBusy}
					id='clone-github-url'
					onChange={(event) => setUrl(event.target.value)}
					onKeyDown={handleSubmitKey}
					placeholder='https://github.com/user/repo.git'
					value={url}
				/>
			</div>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs'>Recent repos</Label>
				<CloneGithubRecentRepos
					disabled={isBusy}
					isLoading={isGithubRepoListLoading}
					onSelect={(repo) => setUrl(`https://github.com/${repo.fullName}.git`)}
					repos={displayedEntries}
					selectedUrl={url}
				/>
				{liveError ? (
					<p className='text-muted-foreground text-xxs'>{liveError}</p>
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
						disabled={isBusy || !isEnsembleApiAvailable()}
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

			<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
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
		case 'failure':
		case 'idle':
		case 'success':
			return 'Clone repo';
	}
}
