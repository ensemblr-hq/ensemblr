import type { DatabaseSync } from 'node:sqlite';

import type { GithubFailure } from '../../shared/ipc/contracts/github';
import type {
	ListRepositoryBranchesRequest,
	ListRepositoryBranchesResult,
	ListRepositoryIssuesRequest,
	ListRepositoryIssuesResult,
	ListRepositoryPullRequestsRequest,
	ListRepositoryPullRequestsResult,
	RepositoryIssueWire,
	RepositoryPullRequestWire,
} from '../../shared/ipc/contracts/workspace-sources';
import type { LocalCommandService } from '../commands/local-command';
import { classifyCommandFailure } from '../github/gh-failures.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { selectRepositoryPathById } from '../storage/repositories/repository-row-repository.ts';
import { listActiveWorkspaceBranchRowsByRepository } from '../storage/repositories/workspace-repository.ts';
import { fetchRemoteBranches, toBranchWires } from './github-branches.ts';
import {
	type CachedRepositoryIssues,
	readCachedRepositoryIssues,
	writeCachedRepositoryIssues,
} from './issue-cache.ts';

const GH_TIMEOUT_MS = 45_000;
const GH_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const LIST_LIMIT = 50;
const PR_JSON_FIELDS =
	'number,title,headRefName,baseRefName,author,isDraft,state,updatedAt,url,isCrossRepository';
const ISSUE_JSON_FIELDS =
	'number,title,state,updatedAt,author,assignees,labels,url,body';
// The dashboard board's backlog is the unassigned issues only, and `--limit`
// counts rows GitHub returns rather than rows that survive a later filter — so
// filtering renderer-side shows an empty backlog for any repository whose newest
// 50 open issues all happen to be assigned. `no:assignee` is a search qualifier,
// not a flag. The create-from and composer pickers want every issue, so this is
// per-request and the two lists cache separately.
const UNASSIGNED_SEARCH = 'no:assignee';
// `gh issue list` costs about a second per repository, and the dashboard board
// fans it out across every repository at once. Serving the SQLite cache for this
// long keeps the board's first paint off that path; a triage backlog does not
// need second-level freshness, and `refresh` bypasses it when a caller does.
const ISSUE_CACHE_TTL_MS = 5 * 60_000;

/**
 * Whether a cached issue list is old enough to be worth re-running `gh` for. An
 * unparseable timestamp counts as expired, so a corrupt row refreshes itself.
 * @param cached - The cached list to date.
 * @returns True when the cache should be refreshed rather than served.
 */
function isCacheExpired(cached: CachedRepositoryIssues): boolean {
	const syncedAt = Date.parse(cached.syncedAt);
	return Number.isNaN(syncedAt) || Date.now() - syncedAt >= ISSUE_CACHE_TTL_MS;
}

/**
 * Shapes a cached issue list as a successful list result. `staleError` is set
 * only when the cache is standing in for a refresh that failed — without it the
 * renderer cannot tell rows it could not refresh from rows it did.
 * @param cached - The cached list to serve.
 * @param staleError - The failure that stopped the refresh, when there was one.
 * @returns The result the renderer receives, marked as cache-sourced.
 */
function servedFromCache(
	cached: CachedRepositoryIssues,
	staleError?: GithubFailure,
): ListRepositoryIssuesResult {
	return {
		issues: cached.issues,
		source: 'cache',
		...(staleError ? { staleError } : {}),
		status: 'ok',
		syncedAt: cached.syncedAt,
	};
}

/** Lists branches / PRs / GitHub issues for the create-from-source picker. */
export interface RepositorySourcesService {
	listBranches: (
		request: ListRepositoryBranchesRequest,
	) => Promise<ListRepositoryBranchesResult>;
	listIssues: (
		request: ListRepositoryIssuesRequest,
	) => Promise<ListRepositoryIssuesResult>;
	listPullRequests: (
		request: ListRepositoryPullRequestsRequest,
	) => Promise<ListRepositoryPullRequestsResult>;
}

/** Options for {@link createRepositorySourcesService}. */
interface CreateRepositorySourcesServiceOptions {
	databaseService: EnsemblrDatabaseService;
	localCommandService: LocalCommandService;
	/** Test seam: resolves a repository id to its on-disk path. */
	resolveRepositoryPath?: (repositoryId: string) => string | null;
}

/**
 * Builds the service backing the "Create workspace from source" picker. All three
 * lists come from the authenticated `gh` CLI run inside the repository path (ADR
 * 0013): branches via `gh api graphql` (remote refs), PRs and issues via
 * `gh pr/issue list`. Pull requests are filtered to same-repo heads. Every method
 * degrades to an empty list plus a typed {@link GithubFailure} rather than
 * throwing, so the picker stays usable.
 */
export function createRepositorySourcesService({
	databaseService,
	localCommandService,
	resolveRepositoryPath,
}: CreateRepositorySourcesServiceOptions): RepositorySourcesService {
	const resolvePath =
		resolveRepositoryPath ??
		((repositoryId: string) => {
			const database = databaseService.getConnection()?.database ?? null;
			if (!database) {
				return null;
			}
			return selectRepositoryPathById({ database, id: repositoryId });
		});

	/**
	 * Reads a repository's persisted issue list, if the database is open.
	 * @param repositoryId - ID of the repository whose cached issues to read
	 * @returns The cached issues, or null when there are none to serve
	 */
	function readIssueCache(
		repositoryId: string,
		unassignedOnly: boolean,
	): CachedRepositoryIssues | null {
		const database = databaseService.getConnection()?.database ?? null;
		return database
			? readCachedRepositoryIssues({ database, repositoryId, unassignedOnly })
			: null;
	}

	/**
	 * Persists a repository's freshly listed issues for the next app start.
	 * @param repositoryId - ID of the repository the issues belong to
	 * @param issues - The issues `gh` just returned
	 * @param syncedAt - ISO timestamp the issues were read at
	 */
	function writeIssueCache(
		repositoryId: string,
		issues: RepositoryIssueWire[],
		syncedAt: string,
		unassignedOnly: boolean,
	): void {
		const database = databaseService.getConnection()?.database ?? null;
		if (database) {
			writeCachedRepositoryIssues({
				database,
				issues,
				repositoryId,
				syncedAt,
				unassignedOnly,
			});
		}
	}

	/**
	 * Caches an issue list `gh` just produced and shapes it as the remote-sourced
	 * result both the listed and the issues-disabled paths return.
	 * @param repositoryId - ID of the repository the issues belong to
	 * @param issues - The issues to cache and return
	 * @param unassignedOnly - Which of the two cached lists this one is
	 * @returns The successful issue-list result to hand the caller
	 */
	function recordListedIssues(
		repositoryId: string,
		issues: RepositoryIssueWire[],
		unassignedOnly: boolean,
	): ListRepositoryIssuesResult {
		const syncedAt = new Date().toISOString();
		writeIssueCache(repositoryId, issues, syncedAt, unassignedOnly);
		return { issues, source: 'remote', status: 'ok', syncedAt };
	}

	/**
	 * Build a branch-name to workspace-id map for a repository's active workspaces.
	 * @param repositoryId - ID of the repository whose workspace rows are read
	 * @param select - Query that returns the workspace rows for the repository
	 * @returns Map from branch name to the owning workspace id
	 */
	function readWorkspaceBranchMap(
		repositoryId: string,
		select: (input: {
			database: DatabaseSync;
			repositoryId: string;
		}) => unknown[],
	): Map<string, string> {
		const database = databaseService.getConnection()?.database ?? null;
		if (!database) {
			return new Map();
		}
		const byBranch = new Map<string, string>();
		for (const raw of select({ database, repositoryId })) {
			if (!raw || typeof raw !== 'object') {
				continue;
			}
			const record = raw as Record<string, unknown>;
			if (
				typeof record.branchName === 'string' &&
				record.branchName &&
				typeof record.id === 'string'
			) {
				byBranch.set(record.branchName, record.id);
			}
		}
		return byBranch;
	}

	/**
	 * Run the `gh` CLI inside a repository path, returning stdout or a typed failure.
	 * @param cwd - Repository directory to run `gh` in
	 * @param args - Arguments passed to `gh`
	 * @returns The command stdout on success, or a GitHub failure on error
	 */
	async function runGh(
		cwd: string,
		args: readonly string[],
	): Promise<
		{ ok: true; stdout: string } | { error: GithubFailure; ok: false }
	> {
		const result = await localCommandService.run({
			args: [...args],
			command: 'gh',
			cwd,
			maxOutputBytes: GH_MAX_OUTPUT_BYTES,
			timeoutMs: GH_TIMEOUT_MS,
		});
		if (result.status !== 'success') {
			return {
				error: classifyCommandFailure(result, 'gh list command failed.'),
				ok: false,
			};
		}
		return { ok: true, stdout: result.stdout };
	}

	return {
		async listBranches(request) {
			const repositoryPath = resolvePath(request.repositoryId);
			if (!repositoryPath) {
				return { branches: [], error: repositoryMissing(), status: 'error' };
			}

			const result = await fetchRemoteBranches({
				localCommandService,
				target: { checkoutPath: repositoryPath, kind: 'checkout' },
			});
			if (!result.ok) {
				return { branches: [], error: result.error, status: 'error' };
			}

			const activeBranches = readWorkspaceBranchMap(
				request.repositoryId,
				listActiveWorkspaceBranchRowsByRepository,
			);
			return {
				branches: toBranchWires(
					result.branches,
					(name) => activeBranches.get(name) ?? null,
				),
				status: 'ok',
			};
		},

		async listPullRequests(request) {
			const repositoryPath = resolvePath(request.repositoryId);
			if (!repositoryPath) {
				return {
					error: repositoryMissing(),
					pullRequests: [],
					status: 'error',
				};
			}

			const result = await runGh(repositoryPath, [
				'pr',
				'list',
				'--json',
				PR_JSON_FIELDS,
				'--limit',
				String(LIST_LIMIT),
			]);
			if (!result.ok) {
				return { error: result.error, pullRequests: [], status: 'error' };
			}

			const parsed = parsePullRequests(result.stdout);
			if (!parsed) {
				return {
					error: parseFailure('gh pr list'),
					pullRequests: [],
					status: 'error',
				};
			}
			// A workspace checks `headRefName` out and pushes back to it, which only
			// works for same-repo PRs; a fork's head never reaches the origin remote,
			// so drop cross-repo PRs rather than offer a row that fails on create.
			const activeBranches = readWorkspaceBranchMap(
				request.repositoryId,
				listActiveWorkspaceBranchRowsByRepository,
			);
			const pullRequests: RepositoryPullRequestWire[] = parsed.flatMap(
				(pullRequest) => {
					if (pullRequest.isCrossRepository) {
						return [];
					}
					const workspaceId =
						activeBranches.get(pullRequest.headRefName) ?? null;
					return [
						{ ...pullRequest, hasWorkspace: workspaceId !== null, workspaceId },
					];
				},
			);
			return { pullRequests, status: 'ok' };
		},

		async listIssues(request) {
			const repositoryPath = resolvePath(request.repositoryId);
			if (!repositoryPath) {
				return { error: repositoryMissing(), issues: [], status: 'error' };
			}

			const unassignedOnly = request.unassignedOnly === true;
			const cached = readIssueCache(request.repositoryId, unassignedOnly);
			if (!request.refresh && cached && !isCacheExpired(cached)) {
				return servedFromCache(cached);
			}

			const result = await runGh(repositoryPath, [
				'issue',
				'list',
				'--json',
				ISSUE_JSON_FIELDS,
				'--limit',
				String(LIST_LIMIT),
				...(unassignedOnly ? ['--search', UNASSIGNED_SEARCH] : []),
			]);
			if (!result.ok) {
				// A repository with issues turned off on GitHub has no issues rather
				// than a broken list, so it answers empty; an error would redden every
				// surface that fans this call out across all repositories at once.
				if (result.error.code === 'issues-disabled') {
					return recordListedIssues(request.repositoryId, [], unassignedOnly);
				}
				return cached
					? servedFromCache(cached, result.error)
					: { error: result.error, issues: [], status: 'error' };
			}

			const issues = parseIssues(result.stdout);
			if (!issues) {
				const failure = parseFailure('gh issue list');
				return cached
					? servedFromCache(cached, failure)
					: { error: failure, issues: [], status: 'error' };
			}
			return recordListedIssues(request.repositoryId, issues, unassignedOnly);
		},
	};
}

/**
 * A pull request as `gh` reports it, before local workspace ownership is known.
 * The parser has no database access, so those two fields are filled in by
 * {@link RepositorySourcesService.listPullRequests}.
 */
type ParsedPullRequest = Omit<
	RepositoryPullRequestWire,
	'hasWorkspace' | 'workspaceId'
>;

/** Parses `gh pr list --json` output; null when the shape is unusable. */
export function parsePullRequests(stdout: string): ParsedPullRequest[] | null {
	return parseNumberedRows(stdout, (record, shared) => ({
		...shared,
		baseRefName: readStringField(record.baseRefName),
		headRefName: readStringField(record.headRefName),
		isCrossRepository: record.isCrossRepository === true,
		isDraft: record.isDraft === true,
	}));
}

/** Parses `gh issue list --json` output; null when the shape is unusable. */
export function parseIssues(stdout: string): RepositoryIssueWire[] | null {
	return parseNumberedRows(stdout, (record, shared) => ({
		...shared,
		assigneeLogins: readObjectListField(record.assignees, 'login'),
		body: readStringField(record.body),
		labels: readObjectListField(record.labels, 'name'),
	}));
}

/** Fields every numbered `gh` row — pull request or issue — publishes. */
interface NumberedGhFields {
	authorLogin: string | null;
	number: number;
	state: string;
	title: string;
	updatedAt: string;
	url: string;
}

/**
 * Parse a numbered `gh ... --json` listing, dropping entries that are not
 * objects or that carry no issue/PR number.
 * @param stdout - Raw `gh` stdout
 * @param toRow - Maps one raw record plus its shared fields onto a wire row
 * @returns The mapped rows, or null when stdout is not a JSON array
 */
function parseNumberedRows<Row>(
	stdout: string,
	toRow: (record: Record<string, unknown>, shared: NumberedGhFields) => Row,
): Row[] | null {
	const parsed = safeParseArray(stdout);
	if (!parsed) {
		return null;
	}
	const rows: Row[] = [];
	for (const raw of parsed) {
		if (!raw || typeof raw !== 'object') {
			continue;
		}
		const record = raw as Record<string, unknown>;
		if (typeof record.number !== 'number') {
			continue;
		}
		rows.push(
			toRow(record, {
				authorLogin: readAuthorLogin(record.author),
				number: record.number,
				state: readStringField(record.state),
				title: readStringField(record.title),
				updatedAt: readStringField(record.updatedAt),
				url: readStringField(record.url),
			}),
		);
	}
	return rows;
}

/** Reads a `gh` field as a string, substituting an empty string for any other type. */
function readStringField(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Parses stdout as a JSON array; null on parse error or non-array. */
function safeParseArray(stdout: string): unknown[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return null;
	}
	return Array.isArray(parsed) ? parsed : null;
}

/** Reads a `gh` `author.login` field, tolerating nulls/missing. */
function readAuthorLogin(author: unknown): string | null {
	if (author && typeof author === 'object') {
		const login = (author as Record<string, unknown>).login;
		if (typeof login === 'string' && login) {
			return login;
		}
	}
	return null;
}

/**
 * Flattens a `gh` list of objects onto one of their string properties, which is
 * how labels (`{ name }[]`) and assignees (`{ login }[]`) both arrive.
 * @param values - The raw `gh` field, expected to be an array of objects
 * @param key - Property to read off each entry
 * @returns The non-empty string values, in order
 */
function readObjectListField(values: unknown, key: string): string[] {
	if (!Array.isArray(values)) {
		return [];
	}
	const read: string[] = [];
	for (const entry of values) {
		if (entry && typeof entry === 'object') {
			const value = (entry as Record<string, unknown>)[key];
			if (typeof value === 'string' && value) {
				read.push(value);
			}
		}
	}
	return read;
}

/** Failure returned when the repository id resolves to no path. */
function repositoryMissing(): GithubFailure {
	return {
		code: 'command-failed',
		message: 'The repository could not be found.',
	};
}

/** Failure returned when a `gh` payload cannot be parsed. */
function parseFailure(command: string): GithubFailure {
	return {
		code: 'parse-failed',
		message: `Could not parse ${command} output.`,
	};
}
