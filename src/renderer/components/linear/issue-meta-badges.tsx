import { CalendarIcon, UserIcon } from 'lucide-react';

import { Badge } from '@/renderer/components/ui/badge';
import { getLinearPriorityLabel } from '@/renderer/lib/linear';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

/** Colored dot + name badge for a Linear workflow state. */
export function LinearStateBadge({
	color,
	name,
}: {
	color: string | null;
	name: string | null;
}) {
	if (!name) {
		return null;
	}

	return (
		<Badge variant='outline'>
			<span
				aria-hidden='true'
				className='size-2 rounded-full'
				style={{ backgroundColor: color ?? 'var(--muted-foreground)' }}
			/>
			{name}
		</Badge>
	);
}

/** Inline metadata badges for an issue row or detail header. */
export function LinearIssueMetaBadges({
	issue,
	showLabels = false,
}: {
	issue: LinearIssueWire;
	showLabels?: boolean;
}) {
	return (
		<span className='flex flex-wrap items-center gap-1.5'>
			<LinearStateBadge color={issue.stateColor} name={issue.stateName} />
			{issue.priority !== null && issue.priority !== 0 ? (
				<Badge variant='outline'>
					{getLinearPriorityLabel(issue.priority)}
				</Badge>
			) : null}
			{issue.assigneeName ? (
				<Badge variant='outline'>
					<UserIcon aria-hidden='true' />
					{issue.assigneeName}
				</Badge>
			) : null}
			{issue.dueDate ? (
				<Badge variant='outline'>
					<CalendarIcon aria-hidden='true' />
					{issue.dueDate}
				</Badge>
			) : null}
			{issue.archivedAt ? <Badge variant='secondary'>Archived</Badge> : null}
			{showLabels
				? issue.labels.map((label) => (
						<Badge key={label.id} variant='outline'>
							<span
								aria-hidden='true'
								className='size-2 rounded-full'
								style={{
									backgroundColor: label.color ?? 'var(--muted-foreground)',
								}}
							/>
							{label.name}
						</Badge>
					))
				: null}
		</span>
	);
}
