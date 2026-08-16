import type { TFunction } from 'i18next';
import { CalendarIcon, FolderIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useLinearIssueQuickUpdate } from '@/renderer/hooks/linear/use-issue-quick-update';
import { resolveLinearStateBucket } from '@/renderer/lib/linear';
import { cn } from '@/renderer/lib/utils';
import { formatRowDate } from '@/renderer/lib/workbench/relative-time';
import type {
	LinearIssueWire,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

import { LinearAvatar } from './issue-avatar';
import { LinearPriorityIcon, LinearStateIcon } from './issue-glyphs';
import {
	type IssuePropertyOption,
	IssuePropertyPicker,
	IssuePropertyRow,
	IssuePropertyValue,
} from './issue-property-picker';

/**
 * Linear's five priority levels as picker rows, fronted by the same bar glyph
 * the browse list uses.
 * @param t - Translation function from the calling component
 * @returns Priority rows in the picker's own shape
 */
function buildPriorityOptions(t: TFunction): IssuePropertyOption[] {
	return [
		{ id: '1', label: t('linear:priority.urgent', 'Urgent') },
		{ id: '2', label: t('linear:priority.high', 'High') },
		{ id: '3', label: t('linear:priority.medium', 'Medium') },
		{ id: '4', label: t('linear:priority.low', 'Low') },
		{ id: '0', label: t('linear:priority.none', 'No priority') },
	].map((option) => ({
		...option,
		icon: <LinearPriorityIcon priority={Number(option.id)} />,
	}));
}

/**
 * Workflow states as picker rows, each drawn in its own Linear color.
 * @param states - Workflow states already scoped to the issue's account and team
 * @returns State rows in the picker's own shape
 */
function buildStateOptions(
	states: readonly LinearResourceWire[],
): IssuePropertyOption[] {
	return states.map((state) => ({
		icon: (
			<LinearStateIcon
				bucket={resolveLinearStateBucket({ stateType: state.type })}
				className='size-4'
				color={state.color}
			/>
		),
		id: state.id,
		label: state.name,
	}));
}

/**
 * Workspace members as picker rows. There is no unassign row: the IPC contract
 * requires a non-empty assignee id, so clearing one is not expressible over this
 * boundary and a row that silently did nothing would be worse than its absence.
 * @param users - Workspace members already scoped to the issue's account
 * @returns Assignee rows in the picker's own shape
 */
function buildAssigneeOptions(
	users: readonly LinearResourceWire[],
): IssuePropertyOption[] {
	return users.map((user) => ({
		icon: <LinearAvatar className='size-4' name={user.name} />,
		id: user.id,
		label: user.name,
	}));
}

/**
 * The issue's properties as an editable rail. Status, priority, and assignee
 * write straight to Linear on selection — the three fields a triage pass changes
 * are one click from the page rather than four through the editor dialog — while
 * the rest of the fields read as values and stay behind Edit, where the
 * multi-field form and its validation belong. An archived issue is read-only:
 * Linear refuses writes to it, so offering the pickers would only produce errors.
 */
export function LinearIssueProperties({ issue }: { issue: LinearIssueWire }) {
	const { t } = useTranslation();
	const quick = useLinearIssueQuickUpdate(issue);
	const locked = issue.archivedAt !== null || quick.isSaving;

	return (
		<aside className='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5'>
			<h2 className='col-span-2 pb-1.5 font-medium text-muted-foreground text-xxs uppercase tracking-wide'>
				{t('linear:issue-detail.properties', 'Properties')}
			</h2>
			<IssuePropertyRow label={t('linear:issue-editor.field.status', 'Status')}>
				<IssuePropertyPicker
					ariaLabel={t('linear:issue-detail.set-status', 'Change status')}
					disabled={locked || quick.states.length === 0}
					emptyText={t('linear:issue-detail.no-options', 'Nothing to choose.')}
					onSelect={(stateId) => quick.apply({ stateId })}
					options={buildStateOptions(quick.states)}
					placeholder={t('linear:issue-editor.status-none', 'No status')}
					searchPlaceholder={t(
						'linear:issue-detail.find-status',
						'Find a status…',
					)}
					selectedId={issue.stateId}
				/>
			</IssuePropertyRow>
			<IssuePropertyRow
				label={t('linear:issue-editor.field.priority', 'Priority')}
			>
				<IssuePropertyPicker
					ariaLabel={t('linear:issue-detail.set-priority', 'Change priority')}
					disabled={locked}
					emptyText={t('linear:issue-detail.no-options', 'Nothing to choose.')}
					onSelect={(priority) => quick.apply({ priority: Number(priority) })}
					options={buildPriorityOptions(t)}
					placeholder={t('linear:priority.none', 'No priority')}
					searchPlaceholder={t(
						'linear:issue-detail.find-priority',
						'Find a priority…',
					)}
					selectedId={String(issue.priority ?? 0)}
				/>
			</IssuePropertyRow>
			<IssuePropertyRow
				label={t('linear:issue-editor.field.assignee', 'Assignee')}
			>
				<IssuePropertyPicker
					ariaLabel={t('linear:issue-detail.set-assignee', 'Change assignee')}
					disabled={locked || quick.users.length === 0}
					emptyText={t('linear:issue-detail.no-people', 'No matching person.')}
					onSelect={(assigneeId) => quick.apply({ assigneeId })}
					options={buildAssigneeOptions(quick.users)}
					placeholder={t('linear:issue-editor.assignee-none', 'Unassigned')}
					placeholderIcon={<LinearAvatar className='size-4' name={null} />}
					searchPlaceholder={t(
						'linear:issue-detail.find-person',
						'Find a person…',
					)}
					selectedId={issue.assigneeId}
				/>
			</IssuePropertyRow>
			{quick.error ? (
				<p
					className='col-span-2 px-1.5 py-1 text-status-danger text-xxs'
					role='alert'
				>
					{quick.error}
				</p>
			) : null}
			<LinearIssueReadOnlyProperties issue={issue} />
		</aside>
	);
}

/**
 * The fields the rail shows but does not edit. Each row disappears when Linear
 * has nothing for it, so a lightly-filled issue does not render a column of
 * dashes.
 */
function LinearIssueReadOnlyProperties({ issue }: { issue: LinearIssueWire }) {
	const { t } = useTranslation();
	const overdue =
		issue.dueDate !== null && Date.parse(issue.dueDate) < Date.now();

	return (
		<>
			{issue.projectName ? (
				<IssuePropertyRow
					label={t('linear:issue-editor.field.project', 'Project')}
				>
					<IssuePropertyValue>
						<FolderIcon
							aria-hidden='true'
							className='size-4 shrink-0 text-muted-foreground'
						/>
						<span className='truncate'>{issue.projectName}</span>
					</IssuePropertyValue>
				</IssuePropertyRow>
			) : null}
			{issue.cycleName ? (
				<IssuePropertyRow label={t('linear:issue-editor.field.cycle', 'Cycle')}>
					<IssuePropertyValue>
						<RefreshCwIcon
							aria-hidden='true'
							className='size-4 shrink-0 text-muted-foreground'
						/>
						<span className='truncate'>{issue.cycleName}</span>
					</IssuePropertyValue>
				</IssuePropertyRow>
			) : null}
			{issue.dueDate ? (
				<IssuePropertyRow
					label={t('linear:issue-editor.field.due-date', 'Due date')}
				>
					<IssuePropertyValue>
						<CalendarIcon
							aria-hidden='true'
							className={cn(
								'size-4 shrink-0',
								overdue ? 'text-status-danger' : 'text-muted-foreground',
							)}
						/>
						<span
							className={cn('tabular-nums', overdue && 'text-status-danger')}
						>
							{formatRowDate(issue.dueDate)}
						</span>
					</IssuePropertyValue>
				</IssuePropertyRow>
			) : null}
			{issue.labels.length > 0 ? (
				<IssuePropertyRow
					label={t('linear:issue-editor.field.labels', 'Labels')}
				>
					<IssuePropertyValue className='flex-wrap gap-1'>
						{issue.labels.map((label) => (
							<span
								className='inline-flex max-w-full items-center gap-1 rounded-full border border-border py-0.5 pr-1.5 pl-1 text-xxs leading-4'
								key={label.id}
							>
								<span
									aria-hidden='true'
									className='size-2 shrink-0 rounded-full'
									style={{
										backgroundColor: label.color ?? 'var(--muted-foreground)',
									}}
								/>
								<span className='truncate'>{label.name}</span>
							</span>
						))}
					</IssuePropertyValue>
				</IssuePropertyRow>
			) : null}
		</>
	);
}
