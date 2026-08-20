import type {
	LinearAccountSnapshot,
	LinearResourceWire,
} from '@/shared/ipc/contracts/linear';

/** Sentinel option value meaning "do not narrow by account". */
export const ALL_ACCOUNTS = 'all';

/** Sentinel option value meaning "do not narrow by team". */
export const ALL_TEAMS = 'all';

/**
 * Which rows the Linear browse list loads: the search text plus the account and
 * team narrowing. Separate from the scope, sort, and grouping preferences, which
 * change how the same rows are read rather than which rows are fetched.
 */
export interface LinearIssueFilters {
	accountId: string;
	query: string;
	teamId: string;
}

/** Every issue the user can reach, unsearched and unnarrowed. */
export const DEFAULT_LINEAR_ISSUE_FILTERS: LinearIssueFilters = {
	accountId: ALL_ACCOUNTS,
	query: '',
	teamId: ALL_TEAMS,
};

/** The narrowing actually applied, alongside the team options it leaves selectable. */
export interface ResolvedLinearIssueFilters {
	accountId: string;
	teamId: string;
	teams: readonly LinearResourceWire[];
}

/**
 * Narrows the remembered account and team down to what the loaded data still
 * offers, and lists the teams that remain selectable under the resolved account.
 * A filter survives a restart, so it can name an account that has since been
 * disconnected or a team that has been archived; left alone that empties the
 * list with nothing on screen to explain it. Falling back rather than rewriting
 * the stored value keeps the filter across a reload that has not delivered the
 * accounts yet, and restores it if the account comes back.
 *
 * `accounts` and `teams` are the query results verbatim: `undefined` while the
 * query is still in flight, an array once it has answered. An empty array is
 * therefore "this user has none" and drops the filter, where `undefined` is
 * "not known yet" and holds it — inferring that from length alone would strand
 * a stored team on a user who has no teams, with the team picker hidden and no
 * control left to clear it.
 * @param options - The remembered filters, the connected accounts, and every known team
 * @returns The account and team to filter by, plus the teams to offer
 */
export function resolveLinearIssueFilters({
	accounts,
	filters,
	teams,
}: {
	accounts: readonly LinearAccountSnapshot[] | undefined;
	filters: LinearIssueFilters;
	teams: readonly LinearResourceWire[] | undefined;
}): ResolvedLinearIssueFilters {
	const accountId =
		accounts && !accounts.some((account) => account.id === filters.accountId)
			? ALL_ACCOUNTS
			: filters.accountId;
	const options = selectableTeams(teams ?? [], accountId);
	const teamId =
		teams && !options.some((team) => team.id === filters.teamId)
			? ALL_TEAMS
			: filters.teamId;

	return { accountId, teamId, teams: options };
}

/**
 * The teams the team picker may offer under one resolved account.
 * @param teams - Every known team across every account
 * @param accountId - The resolved account, or the all-accounts sentinel
 * @returns The teams belonging to that account, or all of them
 */
function selectableTeams(
	teams: readonly LinearResourceWire[],
	accountId: string,
): readonly LinearResourceWire[] {
	return accountId === ALL_ACCOUNTS
		? teams
		: teams.filter((team) => team.accountId === accountId);
}

/**
 * Whether anything is currently narrowing the list, which is what decides
 * whether the reset control is worth showing.
 * @param filters - The narrowing in effect, resolved or as stored
 * @returns Whether any one of search, account, or team is set
 */
export function hasLinearIssueFilters(filters: LinearIssueFilters): boolean {
	return (
		filters.query !== '' ||
		filters.accountId !== ALL_ACCOUNTS ||
		filters.teamId !== ALL_TEAMS
	);
}
