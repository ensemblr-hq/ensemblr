import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
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
	if (isLoading && repos.length === 0) {
		return (
			<div className='flex items-center justify-center rounded-lg border border-border bg-background/40 px-2.5 py-3 text-muted-foreground text-xxs'>
				Loading repos from GitHub…
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
														Private
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

/** Avatar bubble for a repo owner, with an image fallback to a tinted swatch. */
function OwnerAvatar({
	avatarUrl,
	ownerLogin,
}: {
	avatarUrl: string | null;
	ownerLogin: string;
}) {
	const [failed, setFailed] = useState(false);

	if (avatarUrl && !failed) {
		return (
			<img
				alt=''
				className='size-5 shrink-0 rounded-full bg-background object-cover ring-1 ring-foreground/10'
				draggable={false}
				loading='lazy'
				onError={() => setFailed(true)}
				referrerPolicy='no-referrer'
				src={withAvatarSize(avatarUrl, 40)}
			/>
		);
	}

	return (
		<span
			aria-hidden='true'
			className='size-5 shrink-0 rounded-full ring-1 ring-foreground/10'
			style={{ backgroundColor: ownerAvatarColor(ownerLogin) }}
		/>
	);
}

/** Appends `?s=<size>` to a GitHub avatar URL so we fetch a small thumbnail. */
function withAvatarSize(url: string, size: number): string {
	if (url.includes('?')) {
		return `${url}&s=${size}`;
	}
	return `${url}?s=${size}`;
}

/** Stable color swatch per owner login, derived without external assets. */
function ownerAvatarColor(login: string): string {
	if (!login) {
		return 'oklch(0.5 0.04 260)';
	}
	let hash = 0;
	for (let index = 0; index < login.length; index += 1) {
		hash = (hash * 31 + login.charCodeAt(index)) >>> 0;
	}
	const hue = hash % 360;
	return `oklch(0.62 0.13 ${hue})`;
}
