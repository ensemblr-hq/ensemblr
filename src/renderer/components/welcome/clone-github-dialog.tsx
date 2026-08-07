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
	RESULTS_LISTBOX_ID,
	useCloneDialogForm,
} from '@/renderer/hooks/welcome/use-clone-dialog-form';
import type { CloneStage } from '@/renderer/types/welcome';

import { CloneGithubDiagnostics } from './clone-github-diagnostics.tsx';
import { CloneGithubLocationField } from './clone-github-location-field.tsx';
import { CloneGithubProgressLog } from './clone-github-progress-log.tsx';
import { CloneGithubRecentRepos } from './clone-github-recent-repos.tsx';

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
	const {
		activeDescendantId,
		browseDisabled,
		canClone,
		canResetLocation,
		diagnostics,
		handleBrowse,
		handleClone,
		handleSubmitKey,
		isBusy,
		location,
		locationPlaceholder,
		logs,
		resetLocation,
		retry,
		search,
		setLocation,
		stage,
		url,
	} = useCloneDialogForm({ onOpenChange });

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

				<CloneGithubLocationField
					browseDisabled={browseDisabled}
					canReset={canResetLocation}
					disabled={isBusy}
					onBrowse={handleBrowse}
					onChange={setLocation}
					onReset={resetLocation}
					onSubmitKey={handleSubmitKey}
					placeholder={locationPlaceholder}
					value={location}
				/>

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
