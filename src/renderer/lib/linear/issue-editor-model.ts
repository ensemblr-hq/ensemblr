import type { TFunction } from 'i18next';

import type {
	IssueEditorValidation,
	IssueEditorValidationCode,
	LinearIssueEditorFields,
} from '@/renderer/types/linear';
import type {
	CreateLinearIssueRequest,
	LinearIssueWire,
	UpdateLinearIssueRequest,
} from '@/shared/ipc/contracts/linear';

/** Sentinel option value meaning "leave unset / clear". */
export const UNSET_FIELD = '__unset__';

/**
 * Reads Linear's `YYYY-MM-DD` due date as a local calendar day. `new Date(iso)`
 * would parse it as UTC midnight and render as the previous day west of
 * Greenwich, so the parts are handed to the local-time constructor instead.
 * @param value - Stored due date, or an empty string when unset
 * @returns The local date, or undefined when the value is empty or malformed
 */
export function parseIssueDueDate(value: string): Date | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

	if (!match) {
		return undefined;
	}

	const [, year, month, day] = match;
	const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12);
	const rolledOver =
		parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day);

	return rolledOver ? undefined : parsed;
}

/**
 * Writes a picked calendar day back as the `YYYY-MM-DD` string Linear stores,
 * using local parts so the day the user clicked is the day that is sent.
 * @param date - Day chosen in the calendar
 * @returns The ISO calendar date
 */
export function formatIssueDueDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');

	return `${date.getFullYear()}-${month}-${day}`;
}

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

/**
 * Patch that moves the editor to another team, clearing every field the new
 * team's own account scopes. Teams, states, cycles, and labels belong to a team;
 * assignees and projects belong to the organization behind it — so a value
 * carried over from the previous team names a row the target account does not
 * have, and Linear rejects the write.
 * @param teamId - Team the editor is switching to
 * @returns The patch to apply to the editor's fields
 */
export function buildTeamChangeFields(
	teamId: string,
): Partial<LinearIssueEditorFields> {
	return {
		assigneeId: UNSET_FIELD,
		cycleId: UNSET_FIELD,
		labelIds: [],
		projectId: UNSET_FIELD,
		stateId: UNSET_FIELD,
		teamId,
	};
}

/** Validates the form fields for the given editor mode. */
export function validateIssueEditorFields(
	fields: LinearIssueEditorFields,
	mode: 'create' | 'edit',
): IssueEditorValidation {
	if (fields.title.trim().length === 0) {
		return { code: 'title-required', ok: false };
	}

	if (mode === 'create' && fields.teamId.length === 0) {
		return { code: 'team-required', ok: false };
	}

	return { ok: true };
}

/**
 * Maps editor fields to the `issueCreate` request payload.
 * @param fields - Current editor field values
 * @param accountId - Account the chosen team belongs to, when it is known
 * @returns The create request for the main-process service
 */
export function buildCreateIssueRequest(
	fields: LinearIssueEditorFields,
	accountId?: string,
): CreateLinearIssueRequest {
	return {
		...(accountId ? { accountId } : {}),
		teamId: fields.teamId,
		title: fields.title.trim(),
		...buildOptionalFields(fields),
	};
}

/**
 * Maps editor fields to an `issueUpdate` request containing only fields that
 * differ from the original issue. A cleared due date is sent as `null`, which is
 * how Linear distinguishes "unset this" from "leave it alone". Returns `null`
 * when nothing changed.
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

	if (fields.dueDate !== originalFields.dueDate) {
		input.dueDate = fields.dueDate === '' ? null : fields.dueDate;
	}

	if (!areLabelIdsEqual(fields.labelIds, originalFields.labelIds)) {
		input.labelIds = fields.labelIds;
	}

	return Object.keys(input).length > 0
		? { accountId: original.accountId, id: original.id, input }
		: null;
}

/**
 * Builds a patch object containing only the optional issue fields the user has set.
 * @param fields - Current editor field values
 * @returns An object holding just the non-unset optional fields
 */
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

/**
 * Reports whether two label-id lists hold the same ids, ignoring order.
 * @param a - First label-id list
 * @param b - Second label-id list
 * @returns True when both lists contain the same ids
 */
function areLabelIdsEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}

	const sortedA = [...a].sort();
	const sortedB = [...b].sort();

	return sortedA.every((id, index) => id === sortedB[index]);
}

/**
 * Localized copy for a validation code, so the pure validator above stays free
 * of display concerns.
 * @param t - Translator bound to the active language
 * @param code - Validation code the editor form failed on
 * @returns The message the editor shows above the form
 */
export function issueEditorValidationText(
	t: TFunction,
	code: IssueEditorValidationCode,
): string {
	switch (code) {
		case 'title-required':
			return t('linear:issue-editor.title-required', 'A title is required.');
		case 'team-required':
			return t(
				'linear:issue-editor.team-required',
				'Choose a team for the new issue.',
			);
	}
}
