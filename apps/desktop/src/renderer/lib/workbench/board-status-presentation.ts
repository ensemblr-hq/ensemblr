import type { TFunction } from 'i18next';
import {
	CheckCircle2Icon,
	CircleDashedIcon,
	CircleIcon,
	CircleSlashIcon,
	type LucideIcon,
} from 'lucide-react';

import type { WorkspaceBoardStatus } from '@/renderer/state/workspace';

/** Icon + tint used to render a board status in the menu and board. */
export interface BoardStatusPresentation {
	icon: LucideIcon;
	iconClassName: string;
}

/** Visual presentation for every board status, keyed by status value. */
export const BOARD_STATUS_PRESENTATION: Record<
	WorkspaceBoardStatus,
	BoardStatusPresentation
> = {
	backlog: {
		icon: CircleDashedIcon,
		iconClassName: 'text-muted-foreground',
	},
	'in-progress': {
		icon: CircleIcon,
		iconClassName: 'text-status-warning',
	},
	'in-review': {
		icon: CheckCircle2Icon,
		iconClassName: 'text-status-ok',
	},
	done: {
		icon: CheckCircle2Icon,
		iconClassName: 'text-muted-foreground',
	},
	canceled: {
		icon: CircleSlashIcon,
		iconClassName: 'text-muted-foreground',
	},
};

/**
 * Localized column label for a board status. Kept apart from
 * {@link BOARD_STATUS_PRESENTATION} so the icon table stays a plain constant
 * while the label follows the active language.
 * @param t - Translator bound to the active language
 * @param status - Board status to label
 * @returns The label the board column and status menu render
 */
export function boardStatusLabel(
	t: TFunction,
	status: WorkspaceBoardStatus,
): string {
	switch (status) {
		case 'backlog':
			return t('workbench:board-status.backlog', 'Backlog');
		case 'in-progress':
			return t('workbench:board-status.in-progress', 'In progress');
		case 'in-review':
			return t('workbench:board-status.in-review', 'In review');
		case 'done':
			return t('workbench:board-status.done', 'Done');
		case 'canceled':
			return t('workbench:board-status.canceled', 'Canceled');
	}
}
