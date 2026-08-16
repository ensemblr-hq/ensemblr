import { useTranslation } from 'react-i18next';

import { linearInitials } from '@/renderer/lib/linear';
import { cn } from '@/renderer/lib/utils';

/**
 * A Linear person as an initials disc. Linear's API hands the app a display name
 * and no avatar URL, so every surface that shows who is involved — a browse row,
 * a comment, the assignee property — draws the same disc rather than repeating a
 * full name that is usually the same one down the whole screen. An absent person
 * keeps the disc's footprint as a dashed outline, so a list stays aligned.
 */
export function LinearAvatar({
	className,
	name,
}: {
	className?: string;
	name: string | null;
}) {
	const { t } = useTranslation();
	const label = name ?? t('linear:issue-list.unassigned', 'Unassigned');

	return (
		<span
			className={cn(
				'flex size-5 shrink-0 items-center justify-center rounded-full font-medium text-[0.625rem] leading-none tracking-tight',
				name
					? 'bg-accent text-accent-foreground'
					: 'border border-border border-dashed text-muted-foreground',
				className,
			)}
			title={label}
		>
			<span className='sr-only'>{label}</span>
			<span aria-hidden='true'>{name ? linearInitials(name) : ''}</span>
		</span>
	);
}
