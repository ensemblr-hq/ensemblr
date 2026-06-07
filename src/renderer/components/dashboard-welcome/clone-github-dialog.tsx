import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import type { RecentGithubRepo } from '@/renderer/types/workbench';

const DEFAULT_LOCATION = '~/Projects/Conductor/repos';

interface CloneGithubDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	recentRepos: RecentGithubRepo[];
}

/** Modal for cloning a GitHub repository (UI-only mock). */
export function CloneGithubDialog({
	onOpenChange,
	open,
	recentRepos,
}: CloneGithubDialogProps) {
	const [url, setUrl] = useState('');
	const [location, setLocation] = useState(DEFAULT_LOCATION);

	useEffect(() => {
		if (!open) {
			setUrl('');
			setLocation(DEFAULT_LOCATION);
		}
	}, [open]);

	const canClone = url.trim().length > 0;

	const handleClone = useCallback(() => {
		if (!canClone) {
			return;
		}
		// TODO: invoke clone IPC with { url, location } before closing
		onOpenChange(false);
	}, [canClone, onOpenChange]);

	const handleSubmitKey = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				handleClone();
			}
		},
		[handleClone],
	);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-3 sm:max-w-md'>
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
						id='clone-github-url'
						onChange={(event) => setUrl(event.target.value)}
						onKeyDown={handleSubmitKey}
						placeholder='https://github.com/user/repo.git'
						value={url}
					/>
				</div>

				<div className='flex flex-col gap-1.5'>
					<Label className='text-xs'>Recent repos</Label>
					<RecentReposList
						onSelect={(repo) =>
							setUrl(`https://github.com/${repo.fullName}.git`)
						}
						repos={recentRepos}
						selectedUrl={url}
					/>
				</div>

				<div className='flex flex-col gap-1.5'>
					<Label className='text-xs' htmlFor='clone-github-location'>
						Location
					</Label>
					<div className='flex gap-2'>
						<Input
							className='h-9 flex-1 font-mono text-xs'
							id='clone-github-location'
							onChange={(event) => setLocation(event.target.value)}
							onKeyDown={handleSubmitKey}
							value={location}
						/>
						<Button
							className='h-9'
							onClick={() => {
								/* TODO: wire to native folder picker */
							}}
							type='button'
							variant='outline'
						>
							Browse
						</Button>
					</div>
				</div>

				<div className='-mx-4 -mb-4 flex justify-end rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
					<Button
						className='h-8 gap-2'
						disabled={!canClone}
						onClick={handleClone}
						type='button'
						variant='default'
					>
						Clone repo
						<span
							aria-hidden='true'
							className='ml-1 inline-flex items-center gap-0.5 text-[0.6875rem] opacity-70'
						>
							⌘↵
						</span>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

interface RecentReposListProps {
	onSelect: (repo: RecentGithubRepo) => void;
	repos: RecentGithubRepo[];
	selectedUrl: string;
}

function RecentReposList({
	onSelect,
	repos,
	selectedUrl,
}: RecentReposListProps) {
	return (
		<ul
			className='flex max-h-44 flex-col overflow-y-auto rounded-lg border border-border bg-background/40'
			role='listbox'
		>
			{repos.map((repo) => {
				const expectedUrl = `https://github.com/${repo.fullName}.git`;
				const isSelected = selectedUrl === expectedUrl;
				return (
					<li key={repo.fullName} role='presentation'>
						<button
							aria-selected={isSelected}
							className='flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-muted/60 aria-selected:bg-muted'
							onClick={() => onSelect(repo)}
							role='option'
							type='button'
						>
							<span
								aria-hidden='true'
								className='size-5 shrink-0 rounded-full ring-1 ring-foreground/10'
								style={{
									backgroundColor:
										repo.ownerAvatarColor ?? 'oklch(0.5 0.04 260)',
								}}
							/>
							<span className='flex min-w-0 flex-col leading-tight'>
								<span className='truncate text-foreground text-xs'>
									{repo.fullName}
								</span>
								{repo.description ? (
									<span className='truncate text-[0.6875rem] text-muted-foreground'>
										{repo.description}
									</span>
								) : null}
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}
