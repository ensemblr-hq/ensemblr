import type { TFunction } from 'i18next';
import { FolderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/renderer/components/ui/badge';

/**
 * The Linear project an issue is filed under, drawn as an outline badge for
 * pickers and cards. Its tooltip and screen-reader text say "Linear project",
 * because everywhere else in the app a bare "project" means a repository.
 */
export function LinearProjectBadge({ name }: { name: string }) {
	const { t } = useTranslation();
	const label = linearProjectLabel(t, name);

	return (
		<Badge
			className='max-w-36 text-muted-foreground'
			title={label}
			variant='outline'
		>
			<FolderIcon aria-hidden='true' />
			<span aria-hidden='true' className='truncate'>
				{name}
			</span>
			<span className='sr-only'>{label}</span>
		</Badge>
	);
}

/**
 * The Linear project as a borderless icon-and-name pair, for the browse list's
 * project column, which sits beside a status column drawn the same way.
 */
export function LinearProjectLabel({ name }: { name: string }) {
	const { t } = useTranslation();
	const label = linearProjectLabel(t, name);

	return (
		<span
			className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs'
			title={label}
		>
			<FolderIcon aria-hidden='true' className='size-3.5 shrink-0' />
			<span aria-hidden='true' className='truncate'>
				{name}
			</span>
			<span className='sr-only'>{label}</span>
		</span>
	);
}

/**
 * The qualified name a project marker announces and shows on hover.
 * @param t - Translator from the calling component
 * @param name - The Linear project's name
 * @returns "Linear project: <name>" in the active language
 */
function linearProjectLabel(t: TFunction, name: string): string {
	return t('linear:project-marker.label', 'Linear project: {{project}}', {
		project: name,
	});
}
