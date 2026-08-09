import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/renderer/components/ui/badge';
import { Input } from '@/renderer/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { UNSET_FIELD } from '@/renderer/lib/linear';
import type { LinearIssueEditorFields } from '@/renderer/types/linear';
import type {
	LinearMetadataWire,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

/**
 * Linear's five priority levels as picker options, built per render so the
 * labels follow the active language.
 * @param t - Translation function from the calling component
 * @returns Priority options in the select's own shape
 */
function buildPriorityOptions(
	t: TFunction,
): Array<{ label: string; value: string }> {
	return [
		{
			label: t('linear:issue-editor.priority.none', 'No priority'),
			value: '0',
		},
		{ label: t('linear:issue-editor.priority.urgent', 'Urgent'), value: '1' },
		{ label: t('linear:issue-editor.priority.high', 'High'), value: '2' },
		{ label: t('linear:issue-editor.priority.medium', 'Medium'), value: '3' },
		{ label: t('linear:issue-editor.priority.low', 'Low'), value: '4' },
	];
}

/** Shared shape of the editor's picker sections: current fields plus the patch sink. */
interface IssueEditorSectionProps {
	fields: LinearIssueEditorFields;
	metadata: LinearMetadataWire | null;
	update: (patch: Partial<LinearIssueEditorFields>) => void;
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
 * Turn Linear resources into the `{ label, value }` pairs {@link EditorSelect}
 * renders, so every picker reads the same way.
 * @param resources - Named Linear resources such as teams, users, or projects
 * @returns Options in the select's own shape
 */
function toOptions(
	resources: Array<{ id: string; name: string }> | undefined,
): Array<{ label: string; value: string }> {
	return (resources ?? []).map((resource) => ({
		label: resource.name,
		value: resource.id,
	}));
}

/** Labeled select used for the issue editor's picker fields, with an optional "none" option. */
function EditorSelect({
	allowUnset = false,
	'aria-label': ariaLabel,
	onChange,
	options,
	placeholder,
	value,
}: {
	allowUnset?: boolean;
	'aria-label': string;
	onChange: (value: string) => void;
	options: Array<{ label: string; value: string }>;
	placeholder: string;
	value: string | undefined;
}) {
	const { t } = useTranslation();

	return (
		<Select onValueChange={onChange} value={value}>
			<SelectTrigger aria-label={ariaLabel} size='sm'>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{allowUnset ? (
					<SelectItem value={UNSET_FIELD}>
						{t('linear:issue-editor.unset-option', '{{field}}: none', {
							field: placeholder,
						})}
					</SelectItem>
				) : null}
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * The issue editor's picker grid: team (creation only), status, priority,
 * assignee, project, cycle, and due date. Status and cycle narrow to the
 * selected team, and switching team clears the fields that team scoped.
 */
export function IssueEditorFieldGrid({
	fields,
	metadata,
	mode,
	update,
}: IssueEditorSectionProps & { mode: 'create' | 'edit' }) {
	const { t } = useTranslation();
	const teamLabel = t('linear:issue-editor.field.team', 'Team');
	const statusLabel = t('linear:issue-editor.field.status', 'Status');
	const priorityLabel = t('linear:issue-editor.field.priority', 'Priority');
	const assigneeLabel = t('linear:issue-editor.field.assignee', 'Assignee');
	const projectLabel = t('linear:issue-editor.field.project', 'Project');
	const cycleLabel = t('linear:issue-editor.field.cycle', 'Cycle');

	return (
		<div className='grid grid-cols-2 gap-2'>
			{mode === 'create' ? (
				<EditorSelect
					aria-label={teamLabel}
					onChange={(teamId) =>
						update({
							cycleId: UNSET_FIELD,
							labelIds: [],
							stateId: UNSET_FIELD,
							teamId,
						})
					}
					options={toOptions(metadata?.teams)}
					placeholder={teamLabel}
					value={fields.teamId || undefined}
				/>
			) : null}
			<EditorSelect
				aria-label={statusLabel}
				allowUnset
				onChange={(stateId) => update({ stateId })}
				options={toOptions(filterByTeam(metadata?.states ?? [], fields.teamId))}
				placeholder={statusLabel}
				value={fields.stateId}
			/>
			<EditorSelect
				aria-label={priorityLabel}
				allowUnset
				onChange={(priority) => update({ priority })}
				options={buildPriorityOptions(t)}
				placeholder={priorityLabel}
				value={fields.priority}
			/>
			<EditorSelect
				aria-label={assigneeLabel}
				allowUnset
				onChange={(assigneeId) => update({ assigneeId })}
				options={toOptions(metadata?.users)}
				placeholder={assigneeLabel}
				value={fields.assigneeId}
			/>
			<EditorSelect
				aria-label={projectLabel}
				allowUnset
				onChange={(projectId) => update({ projectId })}
				options={toOptions(metadata?.projects)}
				placeholder={projectLabel}
				value={fields.projectId}
			/>
			<EditorSelect
				aria-label={cycleLabel}
				allowUnset
				onChange={(cycleId) => update({ cycleId })}
				options={toOptions(filterByTeam(metadata?.cycles ?? [], fields.teamId))}
				placeholder={cycleLabel}
				value={fields.cycleId}
			/>
			<Input
				aria-label={t('linear:issue-editor.field.due-date', 'Due date')}
				onChange={(event) => update({ dueDate: event.target.value })}
				type='date'
				value={fields.dueDate}
			/>
		</div>
	);
}

/**
 * Toggleable label chips for the selected team, hidden entirely when the team
 * exposes none.
 */
export function IssueEditorLabelPicker({
	fields,
	metadata,
	update,
}: IssueEditorSectionProps) {
	const teamLabels = filterByTeam(metadata?.labels ?? [], fields.teamId);
	const selectedLabelIds = new Set(fields.labelIds);

	if (teamLabels.length === 0) {
		return null;
	}

	return (
		<div className='flex flex-wrap items-center gap-1.5'>
			{teamLabels.map((label) => {
				const selected = selectedLabelIds.has(label.id);

				return (
					<button
						key={label.id}
						onClick={() =>
							update({
								labelIds: selected
									? fields.labelIds.filter((id) => id !== label.id)
									: [...fields.labelIds, label.id],
							})
						}
						type='button'
					>
						<Badge variant={selected ? 'default' : 'outline'}>
							{label.name}
						</Badge>
					</button>
				);
			})}
		</div>
	);
}
