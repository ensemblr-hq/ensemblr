import type { CreateLinearIssueRequest, LinearIssueWire, UpdateLinearIssueRequest } from '@/shared/ipc/contracts/linear';

/** Local form state for the Linear issue editor dialog. */
export interface LinearIssueEditorFields {
	assigneeId: string;
	cycleId: string;
	description: string;
	dueDate: string;
	labelIds: string[];
	priority: string;
	projectId: string;
	stateId: string;
	teamId: string;
	title: string;
}

/** Sentinel option value meaning "leave unset / clear". */
export const UNSET_FIELD = '__unset__';

/**
 * Builds the editor's initial fields, seeded from an existing issue when
 * editing or empty for creation.
 */
export function createIssueEditorFields(
	issue?: LinearIssueWire,
): LinearIssueEditorFields {
	return {
		assigneeId: issue?.assigneeId ?? UNSET_FIELD,
		cycleId: issue?.cycleId ?? UNSET_FIELD,
		description: issue?.description ?? '',
		dueDate: issue?.dueDate ?? '',
		labelIds: issue?.labels.map((label) => label.id) ?? [],
		priority:
			issue?.priority === null
				? UNSET_FIELD
				: String(issue?.priority ?? UNSET_FIELD),
		projectId: issue?.projectId ?? UNSET_FIELD,
		stateId: issue?.stateId ?? UNSET_FIELD,
		teamId: issue?.teamId ?? '',
		title: issue?.title ?? '',
	};
}

/** Validation outcome for the editor form. */
export type IssueEditorValidation = { error: string; ok: false } | { ok: true };

/** Validates the form fields for the given editor mode. */
export function validateIssueEditorFields(
	fields: LinearIssueEditorFields,
	mode: 'create' | 'edit',
): IssueEditorValidation {
	if (fields.title.trim().length === 0) {
		return { error: 'A title is required.', ok: false };
	}

	if (mode === 'create' && fields.teamId.length === 0) {
		return { error: 'Choose a team for the new issue.', ok: false };
	}

	return { ok: true };
}

/** Maps editor fields to the `issueCreate` request payload. */
export function buildCreateIssueRequest(
	fields: LinearIssueEditorFields,
): CreateLinearIssueRequest {
	return {
		teamId: fields.teamId,
		title: fields.title.trim(),
		...buildOptionalFields(fields),
	};
}

/**
 * Maps editor fields to an `issueUpdate` request containing only fields that
 * differ from the original issue. Returns `null` when nothing changed.
 */
export function buildUpdateIssueRequest(
	original: LinearIssueWire,
	fields: LinearIssueEditorFields,
): UpdateLinearIssueRequest | null {
	const originalFields = createIssueEditorFields(original);
	const input: UpdateLinearIssueRequest['input'] = {};

	if (fields.title.trim() !== original.title) {
		input.title = fields.title.trim();
	}

	if (fields.description !== originalFields.description) {
		input.description = fields.description;
	}

	if (
		fields.stateId !== originalFields.stateId &&
		fields.stateId !== UNSET_FIELD
	) {
		input.stateId = fields.stateId;
	}

	if (
		fields.assigneeId !== originalFields.assigneeId &&
		fields.assigneeId !== UNSET_FIELD
	) {
		input.assigneeId = fields.assigneeId;
	}

	if (
		fields.projectId !== originalFields.projectId &&
		fields.projectId !== UNSET_FIELD
	) {
		input.projectId = fields.projectId;
	}

	if (
		fields.cycleId !== originalFields.cycleId &&
		fields.cycleId !== UNSET_FIELD
	) {
		input.cycleId = fields.cycleId;
	}

	if (
		fields.priority !== originalFields.priority &&
		fields.priority !== UNSET_FIELD
	) {
		input.priority = Number.parseInt(fields.priority, 10);
	}

	if (fields.dueDate !== originalFields.dueDate && fields.dueDate !== '') {
		input.dueDate = fields.dueDate;
	}

	if (!areLabelIdsEqual(fields.labelIds, originalFields.labelIds)) {
		input.labelIds = fields.labelIds;
	}

	return Object.keys(input).length > 0 ? { id: original.id, input } : null;
}

function buildOptionalFields(fields: LinearIssueEditorFields) {
	return {
		...(fields.assigneeId !== UNSET_FIELD
			? { assigneeId: fields.assigneeId }
			: {}),
		...(fields.cycleId !== UNSET_FIELD ? { cycleId: fields.cycleId } : {}),
		...(fields.description.trim() ? { description: fields.description } : {}),
		...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
		...(fields.labelIds.length > 0 ? { labelIds: fields.labelIds } : {}),
		...(fields.priority !== UNSET_FIELD
			? { priority: Number.parseInt(fields.priority, 10) }
			: {}),
		...(fields.projectId !== UNSET_FIELD
			? { projectId: fields.projectId }
			: {}),
		...(fields.stateId !== UNSET_FIELD ? { stateId: fields.stateId } : {}),
	};
}

function areLabelIdsEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}

	const sortedA = [...a].sort();
	const sortedB = [...b].sort();

	return sortedA.every((id, index) => id === sortedB[index]);
}
