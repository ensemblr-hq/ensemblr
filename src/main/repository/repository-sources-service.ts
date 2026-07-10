import type { DatabaseSync } from 'node:sqlite';

import type { GithubFailure } from '../../shared/ipc/contracts/github';
import type {
	ListRepositoryBranchesRequest,
	ListRepositoryBranchesResult,
	ListRepositoryIssuesRequest,
	ListRepositoryIssuesResult,
	ListRepositoryPullRequestsRequest,
	ListRepositoryPullRequestsResult,
	RepositoryBranchWire,
	RepositoryIssueWire,
	RepositoryPullRequestWire,
} from '../../shared/ipc/contracts/workspace-sources';
import type { LocalCommandService } from '../commands/local-command';
import { classifyCommandFailure } from '../github/gh-failures.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { selectRepositoryWithDefaultsById } from '../storage/repositories/repository-row-repository.ts';
import { listActiveWorkspaceBranchRowsByRepository } from '../storage/repositories/workspace-repository.ts';

const GH_TIMEOUT_MS = 45_000;
const GH_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const LIST_LIMIT = 50;
const BRANCH_LIST_LIMIT = 100;
const PR_JSON_FIELDS =
	'number,title,headRefName,author,isDraft,state,updatedAt,url,isCrossRepository';
const ISSUE_JSON_FIELDS = 'number,title,state,updatedAt,author,labels,url,body';

/**
 * Branches that live on the GitHub remote, plus the default branch name so the
 * caller can pin it to the top. Sourced from GitHub (not local refs) so branches
 * deleted/merged on GitHub are excluded automatically. `RefOrder` cannot sort by
 * a branch's commit date (only ALPHABETICAL / TAG_COMMIT_DATE), so each ref's
 * `committedDate` is fetched and {@link parseBranches} sorts newest-first.
 */
const BRANCHES_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: ${BRANCH_LIST_LIMIT}) {
      nodes {
        name
        target { ... on Commit { committedDate } }
      }
    }
  }
}`;

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
export interface CreateRepositorySourcesServiceOptions {
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
			return readRepositoryPath(database, repositoryId);
		});

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

			const result = await runGh(repositoryPath, [
				'api',
				'graphql',
				'-F',
				'owner={owner}',
				'-F',
				'name={repo}',
				'-f',
				`query=${BRANCHES_QUERY}`,
			]);
			if (!result.ok) {
				return { branches: [], error: result.error, status: 'error' };
			}

			const parsed = parseBranches(result.stdout);
			if (!parsed) {
				return {
					branches: [],
					error: parseFailure('gh api graphql (branches)'),
					status: 'error',
				};
			}

			const activeBranches = readWorkspaceBranchMap(
				request.repositoryId,
				listActiveWorkspaceBranchRowsByRepository,
			);
			const branches: RepositoryBranchWire[] = parsed.names.map((name) => {
				const workspaceId = activeBranches.get(name) ?? null;
				return {
					hasWorkspace: workspaceId !== null,
					isDefault: name === parsed.defaultBranch,
					name,
					workspaceId,
				};
			});
			// Pin the default branch (e.g. master/main) to the top; the rest keep
			// GitHub's newest-commit-first order.
			branches.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
			return { branches, status: 'ok' };
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
			// A workspace forks off `origin/<headRefName>`, which only resolves for
			// same-repo PRs; a fork's head never reaches the origin remote, so drop
			// cross-repo PRs rather than offer a row that fails on create.
			const pullRequests = parsed.filter(
				(pullRequest) => !pullRequest.isCrossRepository,
			);
			return { pullRequests, status: 'ok' };
		},

		async listIssues(request) {
			const repositoryPath = resolvePath(request.repositoryId);
			if (!repositoryPath) {
				return { error: repositoryMissing(), issues: [], status: 'error' };
			}

			const result = await runGh(repositoryPath, [
				'issue',
				'list',
				'--json',
				ISSUE_JSON_FIELDS,
				'--limit',
				String(LIST_LIMIT),
			]);
			if (!result.ok) {
				return { error: result.error, issues: [], status: 'error' };
			}

			const issues = parseIssues(result.stdout);
			if (!issues) {
				return {
					error: parseFailure('gh issue list'),
					issues: [],
					status: 'error',
				};
			}
			return { issues, status: 'ok' };
		},
	};
}

/** Reads the repository path projection from SQLite; null when absent. */
function readRepositoryPath(
	database: DatabaseSync,
	repositoryId: string,
): string | null {
	const row = selectRepositoryWithDefaultsById({ database, id: repositoryId });
	if (!row || typeof row !== 'object') {
		return null;
	}
	const candidate = row as Record<string, unknown>;
	return typeof candidate.path === 'string' && candidate.path
		? candidate.path
		: null;
}

/**
 * Parses the branches GraphQL payload into the default branch name plus the
 * branch names (newest commit first); null when the shape is unusable.
 */
export function parseBranches(
	stdout: string,
): { defaultBranch: string | null; names: string[] } | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return null;
	}
	const repository = readRecord(readRecord(parsed)?.data)?.repository;
	const repositoryRecord = readRecord(repository);
	if (!repositoryRecord) {
		return null;
	}
	const nodes = readRecord(repositoryRecord.refs)?.nodes;
	if (!Array.isArray(nodes)) {
		return null;
	}
	const entries: Array<{ committedDate: string; name: string }> = [];
	for (const node of nodes) {
		const record = readRecord(node);
		const name = record?.name;
		if (typeof name !== 'string' || !name) {
			continue;
		}
		const committedDate = readRecord(record?.target)?.committedDate;
		entries.push({
			committedDate: typeof committedDate === 'string' ? committedDate : '',
			name,
		});
	}
	// Newest commit first; ISO-8601 dates compare lexically. Refs without a date
	// sort last, and the order is stable for equal keys.
	entries.sort((a, b) => b.committedDate.localeCompare(a.committedDate));

	const defaultName = readRecord(repositoryRecord.defaultBranchRef)?.name;
	return {
		defaultBranch: typeof defaultName === 'string' ? defaultName : null,
		names: entries.map((entry) => entry.name),
	};
}

/** Narrows an unknown value to a plain record, else null. */
function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object'
		? (value as Record<string, unknown>)
		: null;
}

/** Parses `gh pr list --json` output; null when the shape is unusable. */
export function parsePullRequests(
	stdout: string,
): RepositoryPullRequestWire[] | null {
	const parsed = safeParseArray(stdout);
	if (!parsed) {
		return null;
	}
	const rows: RepositoryPullRequestWire[] = [];
	for (const raw of parsed) {
		if (!raw || typeof raw !== 'object') {
			continue;
		}
		const record = raw as Record<string, unknown>;
		if (typeof record.number !== 'number') {
			continue;
		}
		rows.push({
			authorLogin: readAuthorLogin(record.author),
			headRefName:
				typeof record.headRefName === 'string' ? record.headRefName : '',
			isCrossRepository: record.isCrossRepository === true,
			isDraft: record.isDraft === true,
			number: record.number,
			state: typeof record.state === 'string' ? record.state : '',
			title: typeof record.title === 'string' ? record.title : '',
			updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
			url: typeof record.url === 'string' ? record.url : '',
		});
	}
	return rows;
}

/** Parses `gh issue list --json` output; null when the shape is unusable. */
export function parseIssues(stdout: string): RepositoryIssueWire[] | null {
	const parsed = safeParseArray(stdout);
	if (!parsed) {
		return null;
	}
	const rows: RepositoryIssueWire[] = [];
	for (const raw of parsed) {
		if (!raw || typeof raw !== 'object') {
			continue;
		}
		const record = raw as Record<string, unknown>;
		if (typeof record.number !== 'number') {
			continue;
		}
		rows.push({
			authorLogin: readAuthorLogin(record.author),
			body: typeof record.body === 'string' ? record.body : '',
			labels: readLabelNames(record.labels),
			number: record.number,
			state: typeof record.state === 'string' ? record.state : '',
			title: typeof record.title === 'string' ? record.title : '',
			updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
			url: typeof record.url === 'string' ? record.url : '',
		});
	}
	return rows;
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

/** Reads `gh` label `{ name }[]` into a flat name list. */
function readLabelNames(labels: unknown): string[] {
	if (!Array.isArray(labels)) {
		return [];
	}
	const names: string[] = [];
	for (const label of labels) {
		if (label && typeof label === 'object') {
			const name = (label as Record<string, unknown>).name;
			if (typeof name === 'string' && name) {
				names.push(name);
			}
		}
	}
	return names;
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
