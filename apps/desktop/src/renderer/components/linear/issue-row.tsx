import { CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { resolveLinearStateBucket } from '@/renderer/lib/linear';
import { cn } from '@/renderer/lib/utils';
import { formatRowDate } from '@/renderer/lib/workbench/relative-time';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

import { LinearAvatar } from './issue-avatar';
import { LinearPriorityIcon, LinearStateIcon } from './issue-glyphs';

/**
 * One row of the Linear browse list. Every field sits in a fixed-width column so
 * status and assignee line up down the list — the flowing badge cluster this
 * replaced left a ragged right edge that read as noise rather than as data.
 */
export function LinearIssueRow({
	issue,
	onOpen,
	showOrganization,
}: {
	issue: LinearIssueWire;
	onOpen: () => void;
	showOrganization: boolean;
}) {
	const { t } = useTranslation();
	const bucket = resolveLinearStateBucket(issue);
	const isClosed = bucket === 'canceled' || bucket === 'completed';

	return (
		<li>
			<button
				className='flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none'
				onClick={onOpen}
				type='button'
			>
				<LinearPriorityIcon priority={issue.priority} />
				<span className='w-18 shrink-0 truncate font-mono text-muted-foreground text-xxs tabular-nums'>
					{issue.identifier}
				</span>
				{showOrganization && issue.organizationName ? (
					<span className='max-w-28 shrink-0 truncate rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground text-xxs'>
						{issue.organizationName}
					</span>
				) : null}
				<span
					className={cn(
						'min-w-0 flex-1 truncate text-sm',
						isClosed && 'text-muted-foreground',
					)}
				>
					{issue.title}
				</span>
				{issue.dueDate && !isClosed ? (
					<LinearDueDate dueDate={issue.dueDate} />
				) : null}
				{issue.archivedAt ? (
					<span className='shrink-0 text-muted-foreground text-xxs'>
						{t('linear:issue-badges.archived', 'Archived')}
					</span>
				) : null}
				<span className='flex w-28 shrink-0 items-center gap-1.5'>
					<LinearStateIcon bucket={bucket} color={issue.stateColor} />
					<span className='truncate text-muted-foreground text-xs'>
						{issue.stateName}
					</span>
				</span>
				<LinearAvatar name={issue.assigneeName} />
			</button>
		</li>
	);
}

/**
 * Due date on a row, switched to the danger tone once it is in the past so an
 * overdue issue is visible while scrolling rather than only on open.
 */
function LinearDueDate({ dueDate }: { dueDate: string }) {
	const { t } = useTranslation();
	const parsed = Date.parse(dueDate);
	const isOverdue = !Number.isNaN(parsed) && parsed < Date.now();

	return (
		<span
			className={cn(
				'flex shrink-0 items-center gap-1 text-xxs tabular-nums',
				isOverdue ? 'text-status-danger' : 'text-muted-foreground',
			)}
			title={t('linear:issue-row.due', 'Due {{date}}', {
				date: formatRowDate(dueDate),
			})}
		>
			<CalendarIcon aria-hidden='true' className='size-3' />
			{formatRowDate(dueDate)}
		</span>
	);
}
