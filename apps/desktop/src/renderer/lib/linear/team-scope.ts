import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

/**
 * Whether a Linear issue falls inside a repository's team scope — the teams its
 * committed `[linear]` block names. An empty scope takes every issue, so a
 * repository that names no teams keeps showing them all; a named team matches
 * the issue's team key case-insensitively, or its team id.
 * @param issue - The issue whose team to test
 * @param teams - The team keys and ids the repository names
 * @returns True when the issue belongs to the repository
 */
export function isLinearIssueInTeamScope(
	issue: Pick<LinearIssueWire, 'teamId' | 'teamKey'>,
	teams: readonly string[],
): boolean {
	if (teams.length === 0) {
		return true;
	}
	const teamKey = issue.teamKey?.toLowerCase() ?? null;
	return teams.some(
		(team) => team === issue.teamId || team.toLowerCase() === teamKey,
	);
}
