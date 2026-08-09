import type { WorkspaceLinkedIssueInput } from '@/shared/ipc/contracts/workspace';

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

/** Why the editor form failed validation, translated at the call site. */
export type IssueEditorValidationCode = 'team-required' | 'title-required';

/** Validation outcome for the editor form. */
export type IssueEditorValidation =
	| { code: IssueEditorValidationCode; ok: false }
	| { ok: true };

/** Connection-level gate state for every Linear surface. */
export type LinearGateState =
	| { kind: 'loading' }
	| { kind: 'not-configured' }
	| { kind: 'disconnected' }
	| { kind: 'reconnect-required' }
	| { kind: 'ready' };

/** Workspace creation seed derived from a Linear issue. */
export interface LinearWorkspaceSeed {
	linkedIssue: WorkspaceLinkedIssueInput;
}
