import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import type { GithubRepositoryEntry } from '@/shared/ipc';

interface CloneGithubRecentReposProps {
	disabled: boolean;
	isLoading: boolean;
	onSelect: (repo: GithubRepositoryEntry) => void;
	repos: GithubRepositoryEntry[];
	selectedUrl: string;
}

/** Pickable list of GitHub repos surfaced as quick-fill suggestions. */
export function CloneGithubRecentRepos({
	disabled,
	isLoading,
	onSelect,
	repos,
	selectedUrl,
}: CloneGithubRecentReposProps) {
	if (isLoading && repos.length === 0) {
		return (
			<div className='flex items-center justify-center rounded-lg border border-border bg-background/40 px-2.5 py-3 text-muted-foreground text-xxs'>
				Loading repos from GitHub…
			</div>
		);
	}

	if (repos.length === 0) {
		return (
			<div className='flex items-center justify-center rounded-lg border border-border bg-background/40 px-2.5 py-3 text-muted-foreground text-xxs'>
				No repos to suggest yet.
			</div>
		);
	}

	return (
		<ScrollArea className='h-44 rounded-lg border border-border bg-background/40'>
			<ul className='flex flex-col'>
				{repos.map((repo) => {
					const expectedUrl = `https://github.com/${repo.fullName}.git`;
					const isSelected = selectedUrl === expectedUrl;
					return (
						<li key={repo.fullName}>
							<Button
								aria-pressed={isSelected}
								className='h-auto w-full justify-start gap-2.5 rounded-none px-2.5 py-2 font-normal'
								disabled={disabled}
								onClick={() => onSelect(repo)}
								size='sm'
								variant='ghost'
							>
								<OwnerAvatar
									avatarUrl={repo.avatarUrl}
									ownerLogin={repo.ownerLogin}
								/>
								<span className='flex min-w-0 flex-col leading-tight'>
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
						</li>
					);
				})}
			</ul>
		</ScrollArea>
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
