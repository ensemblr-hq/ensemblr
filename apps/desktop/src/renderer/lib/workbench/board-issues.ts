/**
 * Backlog-column contents for the dashboard board.
 *
 * Deliberately **not** re-exported from `lib/workbench/index.ts`, and neither are
 * its siblings `group-board-cards` and `filter-board-cards`. They reach the
 * `state/workspace` barrel, which pulls in `review-comments-sync` →
 * `query-client`; routing that through the `lib/workbench` barrel drags the
 * whole chain into every module that imports anything from it and breaks
 * unrelated test suites that mock `api/ensemblr-queries` partially. Import these
 * three by path, the way `plan-board-drop` and `board-status-presentation`
 * already are.
 */

import {
	isLinearIssueInTeamScope,
	isLinearIssueNotStarted,
} from '@/renderer/lib/linear';
import type { BoardIssueCard } from '@/renderer/types/workbench-shell';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type { RepositoryIssueWire } from '@/shared/ipc/contracts/workspace-sources';

/** One repository's GitHub issues, paired with the project they came from. */
export interface ProjectGithubIssues {
	issues: readonly RepositoryIssueWire[];
	projectId: string;
	projectName: string;
}

/** The Linear teams one repository's `[linear]` block names; empty when it names none. */
export interface ProjectLinearTeams {
	projectId: string;
	teams: readonly string[];
}

/** Everything {@link collectBacklogIssues} needs to decide the Backlog column. */
export interface BacklogIssuesInput {
	/** Keys of issues the user dropped on Canceled; they stay off the board until restored. */
	dismissedKeys: readonly string[];
	githubIssuesByProject: readonly ProjectGithubIssues[];
	linearIssues: readonly LinearIssueWire[];
	/** Every repository on the board with its Linear team scope. */
	linearTeamsByProject: readonly ProjectLinearTeams[];
	/** `linkedIssue.remoteId` of every existing workspace, so an issue that already produced one is not offered twice. */
	linkedIssueKeys: readonly string[];
}

/**
 * Whether a GitHub issue counts as backlog: open, and nobody is on it. `gh issue
 * list` cannot filter on "no assignee", so the test runs here.
 * @param issue - The GitHub issue to test.
 * @returns True when the issue belongs in the Backlog column.
 */
function isGithubBacklogIssue(issue: RepositoryIssueWire): boolean {
	return (
		issue.state.toUpperCase() === 'OPEN' && issue.assigneeLogins.length === 0
	);
}

/**
 * The repositories whose team scope takes a Linear issue: those naming its team
 * and those naming none. Null when no repository names a team, which leaves the
 * issue unscoped exactly as it was before any repository could name one.
 * @param issue - The Linear issue to place.
 * @param linearTeamsByProject - Every repository on the board with its team scope.
 * @returns The ids of the repositories that take it, or null when none scopes.
 */
function linearScopeRepoIds(
	issue: LinearIssueWire,
	linearTeamsByProject: readonly ProjectLinearTeams[],
): string[] | null {
	if (linearTeamsByProject.every((project) => project.teams.length === 0)) {
		return null;
	}
	return linearTeamsByProject
		.filter((project) => isLinearIssueInTeamScope(issue, project.teams))
		.map((project) => project.projectId);
}

/**
 * Normalizes a Linear issue onto the board card shape.
 * @param issue - The Linear issue to map.
 * @param scopeRepoIds - The repositories whose team scope takes it, or null when unscoped.
 * @returns The board card for it.
 */
function toLinearBoardIssue(
	issue: LinearIssueWire,
	scopeRepoIds: string[] | null,
): BoardIssueCard {
	return {
		item: { issue, kind: 'linear-issue' },
		key: issue.id,
		labels: issue.labels.map((label) => label.name),
		priority: issue.priority,
		projectId: null,
		provider: 'linear',
		reference: issue.identifier,
		scopeRepoIds,
		stateColor: issue.stateColor,
		stateName: issue.stateName,
		stateType: issue.stateType,
		subtitle: issue.teamName ?? issue.teamKey,
		title: issue.title,
		trackerProject: issue.projectName,
		updatedAt: issue.updatedAt,
		url: issue.url,
	};
}

/**
 * Normalizes a GitHub issue onto the board card shape.
 * @param issue - The GitHub issue to map.
 * @param project - The repository the issue was listed from.
 * @returns The board card for it.
 */
function toGithubBoardIssue(
	issue: RepositoryIssueWire,
	project: ProjectGithubIssues,
): BoardIssueCard {
	return {
		item: { issue, kind: 'github-issue' },
		// The URL is the stable external id `buildWorkspaceSeedFromGithubIssue`
		// writes as the linked issue's id, so the dedup below can match on it.
		key: issue.url,
		labels: issue.labels,
		priority: null,
		projectId: project.projectId,
		provider: 'github',
		reference: `#${issue.number}`,
		scopeRepoIds: null,
		stateColor: null,
		stateName: null,
		stateType: null,
		subtitle: project.projectName,
		title: issue.title,
		trackerProject: null,
		updatedAt: issue.updatedAt,
		url: issue.url,
	};
}

/** The issue cards the board renders, split by which column they belong in. */
export interface BacklogIssues {
	backlog: BoardIssueCard[];
	/** Issues the user dropped on Canceled; shown there so the dismissal can be undone. */
	dismissed: BoardIssueCard[];
	/**
	 * Key of every issue still waiting for a workspace, including the ones left
	 * off the board because no repository's team scope takes them. Dismissal
	 * pruning keeps these, so narrowing a scope never forgets a dismissal.
	 */
	liveKeys: string[];
}

/**
 * Whether a card has a repository on the board to belong to. Only a Linear
 * issue that every repository's team scope turns away has none.
 * @param card - The card to test.
 * @returns True when the card belongs on the board.
 */
function hasBoardRepository(card: BoardIssueCard): boolean {
	return card.scopeRepoIds === null || card.scopeRepoIds.length > 0;
}

/**
 * Collects the issues with no workspace yet: unstarted Linear issues plus
 * unassigned open GitHub issues, minus anything that already produced a
 * workspace and any Linear issue whose team no repository on the board takes.
 * Dismissed issues are subtracted from Backlog and returned separately rather
 * than dropped, so the Canceled column can offer to restore them. Linear issues
 * come first, then each repository's in the order given — the toolbar's sort is
 * what reorders them for display.
 * @param input - Issue sources, the repositories' team scopes, and the two subtraction sets.
 * @returns The backlog and dismissed cards, deduplicated by key, plus every live key.
 */
export function collectBacklogIssues({
	dismissedKeys,
	githubIssuesByProject,
	linearIssues,
	linearTeamsByProject,
	linkedIssueKeys,
}: BacklogIssuesInput): BacklogIssues {
	const linked = new Set(linkedIssueKeys);
	const dismissed = new Set(dismissedKeys);
	const seen = new Set<string>();
	const collected: BoardIssueCard[] = [];

	for (const issue of linearIssues) {
		if (isLinearIssueNotStarted(issue)) {
			collected.push(
				toLinearBoardIssue(
					issue,
					linearScopeRepoIds(issue, linearTeamsByProject),
				),
			);
		}
	}
	for (const project of githubIssuesByProject) {
		for (const issue of project.issues) {
			if (isGithubBacklogIssue(issue)) {
				collected.push(toGithubBoardIssue(issue, project));
			}
		}
	}

	const unlinked = collected.filter((card) => {
		if (linked.has(card.key) || seen.has(card.key)) {
			return false;
		}
		seen.add(card.key);
		return true;
	});

	const onBoard = unlinked.filter(hasBoardRepository);

	return {
		backlog: onBoard.filter((card) => !dismissed.has(card.key)),
		dismissed: onBoard.filter((card) => dismissed.has(card.key)),
		liveKeys: unlinked.map((card) => card.key),
	};
}
