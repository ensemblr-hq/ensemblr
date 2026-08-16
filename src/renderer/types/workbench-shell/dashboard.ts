import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';

import type {
	ProjectShellModel,
	WorkspaceLinkedIssueProvider,
	WorkspaceShellModel,
	WorkspaceSourceItem,
} from '@/renderer/types/workbench';
import type { WorkspaceBoardStatusValue } from '@/shared/agent-control';

/** Which of the two board card shapes a card (or a drag) refers to. */
export type BoardCardKind = 'issue' | 'workspace';

/**
 * A Linear or GitHub issue with no workspace yet, normalized so the Backlog
 * column renders both providers from one shape. The originating
 * {@link WorkspaceSourceItem} rides along so creating a workspace goes through
 * the same `workspaceSeedFromSourceItem` path the create-from picker uses.
 */
export interface BoardIssueCard {
	/** Dedup key against `workspace.landingSummary.linkedIssue.remoteId`: the Linear issue id, or the GitHub issue URL. */
	key: string;
	item: WorkspaceSourceItem;
	labels: string[];
	/** Linear priority (0 none … 4 low); null for GitHub, which has no equivalent. */
	priority: number | null;
	/** Repository the issue belongs to; null for Linear, which is not repo-scoped. */
	projectId: string | null;
	provider: WorkspaceLinkedIssueProvider;
	/** Human reference: a Linear identifier (`ENS-42`) or a GitHub number (`#42`). */
	reference: string;
	stateColor: string | null;
	stateName: string | null;
	stateType: string | null;
	/** Repository or Linear team name, shown as the card's secondary line. */
	subtitle: string | null;
	title: string;
	updatedAt: string | null;
	url: string;
}

/** One dashboard board card: a workspace, or a backlog issue without one. */
export type BoardCard =
	| { kind: 'issue'; issue: BoardIssueCard }
	| {
			kind: 'workspace';
			project: ProjectShellModel;
			workspace: WorkspaceShellModel;
	  };

/** A resolved board drop: the moved card, its kind, and where it landed. */
export interface BoardDrop {
	edge: Edge | null;
	sourceId: string;
	sourceKind: BoardCardKind;
	targetCardId: string | null;
	/** Kind of the card landed on, needed because issue cards only live in Backlog. */
	targetCardKind: BoardCardKind | null;
	targetColumnStatus: WorkspaceBoardStatusValue | null;
}
