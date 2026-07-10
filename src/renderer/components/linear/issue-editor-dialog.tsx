import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
	createLinearIssue,
	ensemblrQueryKeys,
	linearMetadataQuery,
	updateLinearIssue,
} from '@/renderer/api/ensemblr';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	buildCreateIssueRequest,
	buildUpdateIssueRequest,
	createIssueEditorFields,
	describeLinearFailure,
	type LinearIssueEditorFields,
	UNSET_FIELD,
	validateIssueEditorFields,
} from '@/renderer/lib/linear';
import type {
	LinearIssueWire,
	LinearResourceWire,
	MutateLinearIssueResult,
} from '@/shared/ipc/contracts/linear';

const PRIORITY_OPTIONS = [
	{ label: 'No priority', value: '0' },
	{ label: 'Urgent', value: '1' },
	{ label: 'High', value: '2' },
	{ label: 'Medium', value: '3' },
	{ label: 'Low', value: '4' },
];

/** Create/edit dialog for Linear issues, fed by cached metadata pickers. */
export function LinearIssueEditorDialog({
	issue,
	onOpenChange,
	open,
}: {
	issue?: LinearIssueWire;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const mode = issue ? 'edit' : 'create';
	const queryClient = useQueryClient();
	const { data: metadataData } = useQuery({
		...linearMetadataQuery,
		enabled: open,
	});
	const [fields, setFields] = useState<LinearIssueEditorFields>(() =>
		createIssueEditorFields(issue),
	);
	const [error, setError] = useState<string | null>(null);

	// Re-seed the form whenever the dialog opens for a different issue.
	const [seedKey, setSeedKey] = useState(`${open}:${issue?.id ?? 'new'}`);
	const nextSeedKey = `${open}:${issue?.id ?? 'new'}`;
	if (seedKey !== nextSeedKey) {
		setSeedKey(nextSeedKey);
		setFields(createIssueEditorFields(issue));
		setError(null);
	}

	const mutation = useMutation({
		mutationFn: async (): Promise<MutateLinearIssueResult | null> => {
			if (issue) {
				const request = buildUpdateIssueRequest(issue, fields);
				return request ? updateLinearIssue(request) : null;
			}
			return createLinearIssue(buildCreateIssueRequest(fields));
		},
		onError: () => {
			setError('Saving the issue failed. Check your connection and try again.');
		},
		onSuccess: async (result) => {
			if (result && result.status === 'error') {
				setError(describeLinearFailure(result.failure));
				return;
			}
			// Null result means a no-op edit: nothing changed, nothing to refetch.
			if (result) {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.linearIssuesAll(),
					}),
					queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.linearIssue(result.issue.id),
					}),
				]);
			}
			onOpenChange(false);
		},
	});

	const metadataWire =
		metadataData?.status === 'ok' || metadataData?.status === 'error'
			? metadataData.metadata
			: null;
	const teamStates = filterByTeam(metadataWire?.states ?? [], fields.teamId);
	const teamCycles = filterByTeam(metadataWire?.cycles ?? [], fields.teamId);
	const teamLabels = filterByTeam(metadataWire?.labels ?? [], fields.teamId);
	const selectedLabelIds = new Set(fields.labelIds);

	const update = (patch: Partial<LinearIssueEditorFields>) => {
		setFields((current) => ({ ...current, ...patch }));
	};

	const submit = () => {
		const validation = validateIssueEditorFields(fields, mode);

		if (!validation.ok) {
			setError(validation.error);
			return;
		}

		setError(null);
		mutation.mutate();
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='max-w-lg'>
				<DialogHeader>
					<DialogTitle>
						{mode === 'create'
							? 'New Linear issue'
							: `Edit ${issue?.identifier}`}
					</DialogTitle>
					<DialogDescription>
						{mode === 'create'
							? 'Create an issue in the connected Linear workspace.'
							: 'Update fields where your Linear permissions allow.'}
					</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-3'>
					<Input
						aria-label='Issue title'
						onChange={(event) => update({ title: event.target.value })}
						placeholder='Issue title'
						value={fields.title}
					/>
					<Textarea
						aria-label='Issue description'
						className='min-h-24'
						onChange={(event) => update({ description: event.target.value })}
						placeholder='Description (markdown)'
						value={fields.description}
					/>

					<div className='grid grid-cols-2 gap-2'>
						{mode === 'create' ? (
							<EditorSelect
								aria-label='Team'
								onChange={(teamId) =>
									update({
										cycleId: UNSET_FIELD,
										labelIds: [],
										stateId: UNSET_FIELD,
										teamId,
									})
								}
								options={(metadataWire?.teams ?? []).map((team) => ({
									label: team.name,
									value: team.id,
								}))}
								placeholder='Team'
								value={fields.teamId || undefined}
							/>
						) : null}
						<EditorSelect
							aria-label='Status'
							allowUnset
							onChange={(stateId) => update({ stateId })}
							options={teamStates.map((state) => ({
								label: state.name,
								value: state.id,
							}))}
							placeholder='Status'
							value={fields.stateId}
						/>
						<EditorSelect
							aria-label='Priority'
							allowUnset
							onChange={(priority) => update({ priority })}
							options={PRIORITY_OPTIONS}
							placeholder='Priority'
							value={fields.priority}
						/>
						<EditorSelect
							aria-label='Assignee'
							allowUnset
							onChange={(assigneeId) => update({ assigneeId })}
							options={(metadataWire?.users ?? []).map((user) => ({
								label: user.name,
								value: user.id,
							}))}
							placeholder='Assignee'
							value={fields.assigneeId}
						/>
						<EditorSelect
							aria-label='Project'
							allowUnset
							onChange={(projectId) => update({ projectId })}
							options={(metadataWire?.projects ?? []).map((project) => ({
								label: project.name,
								value: project.id,
							}))}
							placeholder='Project'
							value={fields.projectId}
						/>
						<EditorSelect
							aria-label='Cycle'
							allowUnset
							onChange={(cycleId) => update({ cycleId })}
							options={teamCycles.map((cycle) => ({
								label: cycle.name,
								value: cycle.id,
							}))}
							placeholder='Cycle'
							value={fields.cycleId}
						/>
						<Input
							aria-label='Due date'
							onChange={(event) => update({ dueDate: event.target.value })}
							type='date'
							value={fields.dueDate}
						/>
					</div>

					{teamLabels.length > 0 ? (
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
					) : null}

					{error ? (
						<p className='text-status-danger text-xs' role='alert'>
							{error}
						</p>
					) : null}
				</div>

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} size='sm' variant='ghost'>
						Cancel
					</Button>
					<Button disabled={mutation.isPending} onClick={submit} size='sm'>
						{mutation.isPending
							? 'Saving…'
							: mode === 'create'
								? 'Create issue'
								: 'Save changes'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
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
	return (
		<Select onValueChange={onChange} value={value}>
			<SelectTrigger aria-label={ariaLabel} size='sm'>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{allowUnset ? (
					<SelectItem value={UNSET_FIELD}>{placeholder}: none</SelectItem>
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
