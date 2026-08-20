import type { TFunction } from 'i18next';
import {
	CircleCheckIcon,
	CircleDashedIcon,
	CircleDotDashedIcon,
	CircleIcon,
	type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/renderer/lib/utils';
import type {
	ToolChecklistItem,
	ToolChecklistStatus,
} from '@/renderer/types/tool-presentation';
import { ToolPanel } from './tool-panel';

const STATUS_ICON: Record<ToolChecklistStatus, LucideIcon> = {
	completed: CircleCheckIcon,
	'in-progress': CircleDotDashedIcon,
	pending: CircleIcon,
	unknown: CircleDashedIcon,
};

const STATUS_COLOR: Record<ToolChecklistStatus, string> = {
	completed: 'opacity-60',
	'in-progress': 'text-status-warning',
	pending: 'opacity-50',
	unknown: 'opacity-40',
};

/**
 * Body for the agent's own task list: one line per task, marked with where it
 * stands.
 *
 * Built for these rows rather than routed through the generic text body because
 * a plan is the most scannable thing a turn produces and the harness reports it
 * as numbered prose — the same shape a folded run of task creations renders, so
 * a plan reads identically whether the agent just wrote it or just read it back.
 */
export function ToolChecklist({
	items,
}: {
	items: readonly ToolChecklistItem[];
}) {
	return (
		<ToolPanel>
			<ul className='flex flex-col gap-2'>
				{items.map((item) => (
					<ToolChecklistRow item={item} key={item.id} />
				))}
			</ul>
		</ToolPanel>
	);
}

/** One task: its state, its number, its subject, and the detail beneath it. */
function ToolChecklistRow({ item }: { item: ToolChecklistItem }) {
	const { t } = useTranslation();
	const Icon = STATUS_ICON[item.status];
	return (
		<li className='flex min-w-0 items-baseline gap-2'>
			<Icon
				className={cn(
					'size-3.5 shrink-0 self-start',
					STATUS_COLOR[item.status],
				)}
			/>
			<span className='sr-only'>{checklistStatusLabel(item.status, t)}</span>
			{item.number === null ? null : (
				<span className='shrink-0 font-mono text-xxs tabular-nums opacity-40'>
					{`#${item.number}`}
				</span>
			)}
			<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
				<span
					className={cn(
						'wrap-break-word whitespace-pre-wrap',
						item.status === 'completed' ? 'line-through opacity-60' : null,
					)}
				>
					{item.subject}
				</span>
				{item.detail === null ? null : (
					<span className='wrap-break-word whitespace-pre-wrap text-xxs opacity-50'>
						{item.detail}
					</span>
				)}
			</span>
		</li>
	);
}

/**
 * Names a checklist state for screen readers, which cannot read the mark that
 * carries it visually.
 * @param status - The state to name
 * @param t - The active translator
 * @returns The state's label in the active language
 */
function checklistStatusLabel(
	status: ToolChecklistStatus,
	t: TFunction,
): string {
	switch (status) {
		case 'completed':
			return t('workbench:tool-call.task.status.completed', 'Completed');
		case 'in-progress':
			return t('workbench:tool-call.task.status.in-progress', 'In progress');
		case 'pending':
			return t('workbench:tool-call.task.status.pending', 'Pending');
		default:
			return t('workbench:tool-call.task.status.unknown', 'Unknown');
	}
}
