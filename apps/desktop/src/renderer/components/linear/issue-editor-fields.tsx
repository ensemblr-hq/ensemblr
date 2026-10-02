import type { TFunction } from 'i18next';
import { FolderIcon, RefreshCwIcon, UserIcon, UsersIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import {
	describeLinearAccountFailures,
	resolveLinearStateBucket,
	UNSET_FIELD,
} from '@/renderer/lib/linear';
import { cn } from '@/renderer/lib/utils';
import type { LinearIssueEditorFields } from '@/renderer/types/linear';
import type {
	LinearAccountFailure,
	LinearMetadataWire,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

import { IssueEditorDueDate } from './issue-editor-due-date';
import { IssueEditorLabelPicker } from './issue-editor-labels';
import { LinearPriorityIcon, LinearStateIcon } from './issue-glyphs';

/** One row of a picker: the value, its label, and the glyph that fronts it. */
interface EditorOption {
	icon?: ReactNode;
	label: string;
	value: string;
}

/**
 * Linear's five priority levels as picker options, each fronted by the same
 * bar glyph the issue list uses so the two surfaces read alike. `0` is one of
 * the five rather than an unset sentinel: it is how Linear stores a priority
 * that was deliberately cleared.
 * @param t - Translation function from the calling component
 * @returns Priority options in the picker's own shape
 */
function buildPriorityOptions(t: TFunction): EditorOption[] {
	return [
		{
			label: t('linear:issue-editor.priority.none', 'No priority'),
			value: '0',
		},
		{ label: t('linear:issue-editor.priority.urgent', 'Urgent'), value: '1' },
		{ label: t('linear:issue-editor.priority.high', 'High'), value: '2' },
		{ label: t('linear:issue-editor.priority.medium', 'Medium'), value: '3' },
		{ label: t('linear:issue-editor.priority.low', 'Low'), value: '4' },
	].map((option) => ({
		...option,
		icon: <LinearPriorityIcon priority={Number(option.value)} />,
	}));
}

/** Shared shape of the editor's picker sections: current fields plus the patch sink. */
interface IssueEditorSectionProps {
	/** Account the edited issue belongs to; narrows every picker to its rows. */
	accountId: string | null;
	fields: LinearIssueEditorFields;
	metadata: LinearMetadataWire | null;
	update: (patch: Partial<LinearIssueEditorFields>) => void;
}

/**
 * Narrow Linear resources to one account's rows. Metadata arrives merged across
 * every connected account, and an id from one organization is never valid in
 * another — a state picker offering both would build a request Linear rejects.
 * @param resources - Merged Linear resources
 * @param accountId - Account to keep, or null before a team is chosen
 * @returns The account's resources, or all of them while no account is resolved
 */
function filterByAccount(
	resources: LinearResourceWire[],
	accountId: string | null,
): LinearResourceWire[] {
	return accountId === null
		? resources
		: resources.filter((resource) => resource.accountId === accountId);
}

/**
 * Narrow Linear resources to those that are global or belong to the selected team.
 * @param resources - Team-scoped Linear resources such as states, cycles, or labels
 * @param teamId - Selected team id, or an unset sentinel
 * @returns The resources visible for the team, or all resources when no team is selected
 */
function filterByTeam(
	resources: LinearResourceWire[],
	teamId: string,
): LinearResourceWire[] {
	if (!teamId || teamId === UNSET_FIELD) {
		return resources;
	}

	return resources.filter(
		(resource) => resource.teamId === null || resource.teamId === teamId,
	);
}

/**
 * Turn Linear resources into the options {@link EditorSelect} renders, so every
 * picker reads the same way.
 * @param resources - Named Linear resources such as users, projects, or cycles
 * @param icon - Glyph drawn ahead of each name
 * @returns Options in the picker's own shape
 */
function toOptions(
	resources: LinearResourceWire[],
	icon?: ReactNode,
): EditorOption[] {
	return resources.map((resource) => ({
		icon,
		label: resource.name,
		value: resource.id,
	}));
}

/**
 * Workflow states as options, each drawn with the ring glyph in the state's own
 * Linear color so status reads before its name does.
 * @param states - The team's workflow states
 * @returns Options in the picker's own shape
 */
function toStateOptions(states: LinearResourceWire[]): EditorOption[] {
	return states.map((state) => ({
		icon: (
			<LinearStateIcon
				bucket={resolveLinearStateBucket({ stateType: state.type })}
				color={state.color}
			/>
		),
		label: state.name,
		value: state.id,
	}));
}

/**
 * Cycles as options, named by their number when the team never named the
 * iteration itself — Linear returns `name: null` there, and the id it is
 * replaced with printed a raw UUID in the picker.
 * @param cycles - The team's cycles
 * @param t - Translation function from the calling component
 * @returns Options in the picker's own shape
 */
function toCycleOptions(
	cycles: LinearResourceWire[],
	t: TFunction,
): EditorOption[] {
	return cycles.map((cycle) => ({
		icon: <RefreshCwIcon className='text-muted-foreground' />,
		label: describeCycle(cycle, t),
		value: cycle.id,
	}));
}

/**
 * Name one cycle: its own name when a team gave it one, otherwise the number
 * Linear counts it by.
 * @param cycle - Cycle resource from the metadata cache
 * @param t - Translation function from the calling component
 * @returns The name to show in the picker
 */
function describeCycle(cycle: LinearResourceWire, t: TFunction): string {
	const named = cycle.name.length > 0 && cycle.name !== cycle.id;

	if (named || cycle.key === null) {
		return cycle.name;
	}

	return t('linear:issue-editor.cycle-number', 'Cycle {{number}}', {
		number: cycle.key,
	});
}

/**
 * Compact pill select used across the editor's meta row. An unset field shows
 * the field's own name rather than a `Status: none` sentence, so the row scans
 * as a set of chips instead of a paragraph. The sentinel is passed to Radix as
 * the value rather than `undefined`, which it reads as "uncontrolled" and would
 * leave the pill showing a stale selection after a reset.
 */
function EditorSelect({
	ariaLabel,
	className,
	disabled,
	emptyIcon,
	onChange,
	options,
	placeholder,
	unsetLabel,
	value,
}: {
	ariaLabel: string;
	className?: string;
	disabled?: boolean;
	emptyIcon: ReactNode;
	onChange: (value: string) => void;
	options: EditorOption[];
	placeholder: string;
	unsetLabel?: string;
	value: string;
}) {
	const isUnset = value === UNSET_FIELD || value === '';
	const selectedOption = options.find((option) => option.value === value);

	return (
		<Select
			disabled={disabled}
			onValueChange={onChange}
			value={isUnset ? UNSET_FIELD : value}
		>
			<SelectTrigger
				aria-label={ariaLabel}
				className={cn(className, isUnset ? 'text-muted-foreground' : null)}
				size='sm'
			>
				{isUnset ? emptyIcon : selectedOption?.icon}
				<SelectValue>
					{isUnset ? placeholder : selectedOption?.label}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{unsetLabel ? (
					<SelectItem value={UNSET_FIELD}>{unsetLabel}</SelectItem>
				) : null}
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.icon}
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * Team picker for a new issue. It sits above the rest because the chosen team
 * decides the account, and every other picker narrows to it. An account the
 * merged read could not reach is named in the list, so a short roster of teams
 * is not mistaken for the whole one.
 */
export function IssueEditorTeamPicker({
	accountFailures,
	metadata,
	onChange,
	value,
}: {
	accountFailures: readonly LinearAccountFailure[];
	metadata: LinearMetadataWire | null;
	onChange: (teamId: string) => void;
	value: string;
}) {
	const { t } = useTranslation();
	const label = t('linear:issue-editor.field.team', 'Team');
	const teams = metadata?.teams ?? [];
	const spansAccounts = new Set(teams.map((team) => team.accountId)).size > 1;
	const selected = teams.find((team) => team.id === value);

	return (
		<Select onValueChange={onChange} value={value || undefined}>
			<SelectTrigger aria-label={label} className='max-w-52' size='sm'>
				{selected ? null : <UsersIcon className='text-muted-foreground' />}
				<SelectValue placeholder={label}>{selected?.name}</SelectValue>
			</SelectTrigger>
			{/* Radix aligns the menu to an item, and bails without positioning when
			    there is none — so a teamless menu anchors to the trigger instead. */}
			<SelectContent position={teams.length === 0 ? 'popper' : 'item-aligned'}>
				{accountFailures.length > 0 ? (
					<p className='max-w-72 text-pretty px-2 py-1.5 text-status-warning text-xs'>
						{describeLinearAccountFailures(accountFailures)}
					</p>
				) : null}
				{teams.length === 0 && accountFailures.length === 0 ? (
					<p className='max-w-72 text-pretty px-2 py-1.5 text-muted-foreground text-xs'>
						{t(
							'linear:issue-editor.teams-empty',
							'No teams have loaded from your connected Linear accounts yet.',
						)}
					</p>
				) : null}
				{teams.map((team) => (
					<SelectItem key={team.id} value={team.id}>
						<span className='flex flex-col items-start'>
							{team.name}
							{spansAccounts && team.organizationName ? (
								<span className='text-muted-foreground text-xs'>
									{team.organizationName}
								</span>
							) : null}
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * Narrow every merged resource list the meta row offers down to what the issue
 * being edited can actually reference: the selected team's account first, then
 * the team itself. Empty until a team is chosen — a merged list spanning
 * accounts offers ids the target team would reject.
 * @param metadata - Linear metadata merged across every connected account
 * @param accountId - Account the selected team belongs to, or null before one is chosen
 * @param teamId - Selected team, or an unset sentinel
 * @returns The scoped resource lists, plus whether a team is selected at all
 */
function scopeEditorResources(
	metadata: LinearMetadataWire | null,
	accountId: string | null,
	teamId: string,
): {
	cycles: LinearResourceWire[];
	hasTeam: boolean;
	labels: LinearResourceWire[];
	projects: LinearResourceWire[];
	states: LinearResourceWire[];
	users: LinearResourceWire[];
} {
	const hasTeam = teamId !== '' && teamId !== UNSET_FIELD;

	if (!hasTeam) {
		return {
			cycles: [],
			hasTeam,
			labels: [],
			projects: [],
			states: [],
			users: [],
		};
	}

	const forAccount = (resources: LinearResourceWire[] | undefined) =>
		filterByAccount(resources ?? [], accountId);
	const forTeam = (resources: LinearResourceWire[] | undefined) =>
		filterByTeam(forAccount(resources), teamId);

	return {
		cycles: forTeam(metadata?.cycles),
		hasTeam,
		labels: forTeam(metadata?.labels),
		projects: forAccount(metadata?.projects),
		states: forTeam(metadata?.states),
		users: forAccount(metadata?.users),
	};
}

/**
 * The editor's meta row: status, priority, assignee, project, cycle, due date,
 * and labels as one wrapping band of pills. Everything the team scopes stays
 * disabled until a team is chosen, because a merged list spanning accounts
 * offers ids the target team would reject.
 */
export function IssueEditorMetaRow({
	accountId,
	fields,
	metadata,
	update,
}: IssueEditorSectionProps) {
	const { t } = useTranslation();
	const { cycles, hasTeam, labels, projects, states, users } =
		scopeEditorResources(metadata, accountId, fields.teamId);
	const statusLabel = t('linear:issue-editor.field.status', 'Status');
	const priorityLabel = t('linear:issue-editor.field.priority', 'Priority');
	const assigneeLabel = t('linear:issue-editor.field.assignee', 'Assignee');
	const projectLabel = t('linear:issue-editor.field.project', 'Project');
	const cycleLabel = t('linear:issue-editor.field.cycle', 'Cycle');

	return (
		<div className='flex flex-wrap items-center gap-1.5'>
			<EditorSelect
				ariaLabel={statusLabel}
				className='max-w-48'
				disabled={!hasTeam}
				emptyIcon={<LinearStateIcon bucket='unstarted' />}
				onChange={(stateId) => update({ stateId })}
				options={toStateOptions(states)}
				placeholder={statusLabel}
				unsetLabel={t('linear:issue-editor.status-none', 'No status')}
				value={fields.stateId}
			/>
			<EditorSelect
				ariaLabel={priorityLabel}
				className='max-w-40'
				emptyIcon={<LinearPriorityIcon priority={null} />}
				onChange={(priority) => update({ priority })}
				options={buildPriorityOptions(t)}
				placeholder={priorityLabel}
				value={fields.priority}
			/>
			<EditorSelect
				ariaLabel={assigneeLabel}
				className='max-w-48'
				disabled={!hasTeam}
				emptyIcon={<UserIcon className='text-muted-foreground' />}
				onChange={(assigneeId) => update({ assigneeId })}
				options={toOptions(
					users,
					<UserIcon className='text-muted-foreground' />,
				)}
				placeholder={assigneeLabel}
				unsetLabel={t('linear:issue-editor.assignee-none', 'Unassigned')}
				value={fields.assigneeId}
			/>
			{hasTeam && projects.length === 0 ? null : (
				<EditorSelect
					ariaLabel={projectLabel}
					className='max-w-56'
					disabled={!hasTeam}
					emptyIcon={<FolderIcon className='text-muted-foreground' />}
					onChange={(projectId) => update({ projectId })}
					options={toOptions(
						projects,
						<FolderIcon className='text-muted-foreground' />,
					)}
					placeholder={projectLabel}
					unsetLabel={t('linear:issue-editor.project-none', 'No project')}
					value={fields.projectId}
				/>
			)}
			{hasTeam && cycles.length === 0 ? null : (
				<EditorSelect
					ariaLabel={cycleLabel}
					className='max-w-40'
					disabled={!hasTeam}
					emptyIcon={<RefreshCwIcon className='text-muted-foreground' />}
					onChange={(cycleId) => update({ cycleId })}
					options={toCycleOptions(cycles, t)}
					placeholder={cycleLabel}
					unsetLabel={t('linear:issue-editor.cycle-none', 'No cycle')}
					value={fields.cycleId}
				/>
			)}
			<IssueEditorDueDate
				onChange={(dueDate) => update({ dueDate })}
				value={fields.dueDate}
			/>
			<IssueEditorLabelPicker
				labels={labels}
				onChange={(labelIds) => update({ labelIds })}
				selectedIds={fields.labelIds}
			/>
		</div>
	);
}
