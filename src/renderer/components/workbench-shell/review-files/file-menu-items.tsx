import { EyeIcon, type LucideIcon, PinIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ContextMenuItem } from '@/renderer/components/ui/context-menu';
import type { ReviewFilePreviewOpener } from '@/renderer/types/workbench';

/**
 * One row of a file context menu: a muted leading icon beside its label. Owns
 * the row metrics the all-files tree and the changes list both draw, so the two
 * menus cannot drift apart a padding step at a time.
 */
export function FileMenuItem({
	icon: Icon,
	label,
	onSelect,
}: {
	icon: LucideIcon;
	label: string;
	onSelect: () => void;
}) {
	return (
		<ContextMenuItem
			className='h-8 gap-2 px-2 text-[0.8125rem]'
			onSelect={onSelect}
		>
			<Icon aria-hidden='true' className='text-muted-foreground' />
			<span className='min-w-0 flex-1'>{label}</span>
		</ContextMenuItem>
	);
}

/**
 * The View and Keep open pair every file-row context menu opens with. Keep open
 * is the keyboard-reachable equivalent of double-clicking the row: it opens the
 * same target, promoted out of the ephemeral preview slot.
 */
export function OpenFileMenuItems({
	openFile,
	path,
}: {
	openFile: ReviewFilePreviewOpener;
	path: string;
}) {
	const { t } = useTranslation();

	return (
		<>
			<FileMenuItem
				icon={EyeIcon}
				label={t('common:actions.view', 'View')}
				onSelect={() => openFile(path)}
			/>
			<FileMenuItem
				icon={PinIcon}
				label={t('common:actions.keep-open', 'Keep open')}
				onSelect={() => openFile(path, { preview: false })}
			/>
		</>
	);
}
