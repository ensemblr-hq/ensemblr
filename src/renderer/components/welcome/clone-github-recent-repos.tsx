import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { OwnerAvatar } from '@/renderer/components/welcome/owner-avatar';
import { cn } from '@/renderer/lib/utils';
import type { GithubRepositoryEntry } from '@/shared/ipc/contracts/clone';

/** Props for the recent/searched GitHub repositories picker list. */
interface CloneGithubRecentReposProps {
	disabled: boolean;
	emptyMessage: string;
	footerHint?: string;
	highlightedIndex: number;
	isLoading: boolean;
	listboxId: string;
	onSelect: (repo: GithubRepositoryEntry) => void;
	repos: GithubRepositoryEntry[];
}

/** Pickable list of GitHub repos surfaced as recent suggestions or search results. */
export function CloneGithubRecentRepos({
	disabled,
	emptyMessage,
	footerHint,
	highlightedIndex,
	isLoading,
	listboxId,
	onSelect,
	repos,
}: CloneGithubRecentReposProps) {
	const { t } = useTranslation();
	if (isLoading && repos.length === 0) {
		return (
			<div className='flex items-center justify-center rounded-lg border border-border bg-background/40 px-2.5 py-3 text-muted-foreground text-xxs'>
				{t('common:clone-dialog.loading-repos', 'Loading repos from GitHub…')}
			</div>
		);
	}

	return (
		<div className='flex flex-col gap-1'>
			{repos.length === 0 ? (
				<div className='flex items-center justify-center rounded-lg border border-border bg-background/40 px-2.5 py-3 text-muted-foreground text-xxs'>
					{emptyMessage}
				</div>
			) : (
				<ScrollArea className='h-44 rounded-lg border border-border bg-background/40'>
					<div className='flex flex-col' id={listboxId} role='listbox'>
						{repos.map((repo, index) => {
							const isHighlighted = index === highlightedIndex;
							return (
								// biome-ignore lint/a11y/useFocusableInteractive: aria-activedescendant combobox pattern — focus stays on the text input, options are referenced by id rather than individually focused.
								<div
									aria-selected={isHighlighted}
									id={`${listboxId}-${index}`}
									key={repo.fullName}
									role='option'
								>
									<Button
										className={cn(
											'h-auto w-full justify-start gap-2.5 rounded-none px-2.5 py-2 font-normal',
											isHighlighted && 'bg-muted text-foreground',
										)}
										disabled={disabled}
										onClick={() => onSelect(repo)}
										size='sm'
										variant='ghost'
									>
										<OwnerAvatar
											avatarUrl={repo.avatarUrl}
											ownerLogin={repo.ownerLogin}
										/>
										<span className='flex min-w-0 flex-col text-left leading-tight'>
											<span className='flex min-w-0 items-center gap-1.5 truncate text-foreground text-xs'>
												<span className='truncate'>{repo.fullName}</span>
												{repo.isPrivate ? (
													<span className='shrink-0 rounded-sm bg-muted px-1 py-px text-[0.625rem] text-muted-foreground uppercase tracking-wide'>
														{t('common:clone-dialog.private', 'Private')}
													</span>
												) : null}
											</span>
											{repo.description ? (
												<span className='truncate text-muted-foreground text-xxs'>
													{repo.description}
												</span>
											) : null}
										</span>
									</Button>
								</div>
							);
						})}
					</div>
				</ScrollArea>
			)}
			{footerHint ? (
				<p className='text-muted-foreground text-xxs'>{footerHint}</p>
			) : null}
		</div>
	);
}
