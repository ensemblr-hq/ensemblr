import {
	CheckCircle2Icon,
	CircleDashedIcon,
	CircleIcon,
	CircleSlashIcon,
	type LucideIcon,
} from 'lucide-react';

import {
	BOARD_STATUS_LABELS,
	type WorkspaceBoardStatus,
} from '@/renderer/state/workspace';

/** Icon + tint + label used to render a board status in the menu and board. */
export interface BoardStatusPresentation {
	icon: LucideIcon;
	iconClassName: string;
	label: string;
}

/** Visual presentation for every board status, keyed by status value. */
export const BOARD_STATUS_PRESENTATION: Record<
	WorkspaceBoardStatus,
	BoardStatusPresentation
> = {
	backlog: {
		icon: CircleDashedIcon,
		iconClassName: 'text-muted-foreground',
		label: BOARD_STATUS_LABELS.backlog,
	},
	'in-progress': {
		icon: CircleIcon,
		iconClassName: 'text-status-warning',
		label: BOARD_STATUS_LABELS['in-progress'],
	},
	'in-review': {
		icon: CheckCircle2Icon,
		iconClassName: 'text-status-ok',
		label: BOARD_STATUS_LABELS['in-review'],
	},
	done: {
		icon: CheckCircle2Icon,
		iconClassName: 'text-muted-foreground',
		label: BOARD_STATUS_LABELS.done,
	},
	canceled: {
		icon: CircleSlashIcon,
		iconClassName: 'text-muted-foreground',
		label: BOARD_STATUS_LABELS.canceled,
	},
};
