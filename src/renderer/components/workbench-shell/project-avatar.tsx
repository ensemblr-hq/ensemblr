import { FolderGit2Icon } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/renderer/lib/utils';
import type { ProjectShellModel } from '@/renderer/types/workbench';

/** Square project avatar with image fallback to a folder-git icon. */
export function ProjectAvatar({
	className,
	project,
	size,
}: {
	className?: string;
	project: ProjectShellModel;
	size: 'md' | 'sm';
}) {
	const [hasImageError, setHasImageError] = useState(false);
	const avatarUrl = project.owner.avatarUrl;
	const showImage = Boolean(avatarUrl) && !hasImageError;
	const sizeClassName = size === 'md' ? 'size-6' : 'size-4';
	const iconClassName = size === 'md' ? 'size-3.5' : 'size-2.5';

	return (
		<span
			className={cn(
				'grid shrink-0 place-items-center overflow-hidden rounded-sm bg-muted text-muted-foreground',
				sizeClassName,
				className,
			)}
		>
			{showImage ? (
				<img
					alt={`${project.owner.name} avatar`}
					className='size-full object-cover'
					draggable={false}
					onError={() => setHasImageError(true)}
					src={avatarUrl}
				/>
			) : (
				<FolderGit2Icon aria-hidden='true' className={iconClassName} />
			)}
		</span>
	);
}
