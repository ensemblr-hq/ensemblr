/**
 * Remote branch listing shared by the two surfaces that need it: the
 * create-from-source picker, which has a cloned repository to run `gh` inside,
 * and the clone dialog, which has only a URL. Both go through
 * {@link fetchRemoteBranches} and {@link toBranchWires}, so neither the query,
 * its parser, nor the order the picker renders can drift between them.
 */

import type { GithubFailure } from '../../shared/ipc/contracts/github';
import type { RepositoryBranchWire } from '../../shared/ipc/contracts/workspace-sources';
import type { LocalCommandService } from '../commands/local-command';
import { classifyCommandFailure } from '../github/gh-failures.ts';

const GH_TIMEOUT_MS = 45_000;
const GH_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const BRANCH_LIST_LIMIT = 100;

/**
 * Branches that live on the GitHub remote, plus the default branch name so the
 * caller can pin it to the top. Sourced from GitHub (not local refs) so branches
 * deleted/merged on GitHub are excluded automatically. `RefOrder` cannot sort by
 * a branch's commit date (only ALPHABETICAL / TAG_COMMIT_DATE), so each ref's
 * `committedDate` is fetched and {@link parseBranches} sorts newest-first.
 */
export const BRANCHES_QUERY = `query($owner: String!, $name: String!) {
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

/**
 * Which repository to read, and therefore how `gh` is told about it. A checkout
 * lets `gh` fill `{owner}`/`{repo}` from its own remote; literal coordinates are
 * for callers holding nothing but a URL.
 */
export type RemoteBranchTarget =
	| { checkoutPath: string; kind: 'checkout' }
	| { kind: 'coordinates'; name: string; owner: string };

/** The branch names a repository publishes, newest commit first, plus its default. */
export interface RemoteBranchNames {
	defaultBranch: string | null;
	names: string[];
}

/** Outcome of {@link fetchRemoteBranches}: the parsed names or a typed failure. */
export type FetchRemoteBranchesResult =
	| { branches: RemoteBranchNames; ok: true }
	| { error: GithubFailure; ok: false };

/**
 * Builds the `gh api graphql` invocation for one target. The field flag differs
 * per target and both choices are load-bearing: `{owner}`/`{repo}` are only
 * expanded under `-F`, while `-F` also coerces an integer-looking value to a
 * JSON number, which GraphQL then rejects against `String!` — so a repository
 * named `2048` has to go through `-f`.
 * @param target - The repository to read, by checkout or by coordinates.
 * @returns The `gh` arguments, plus the cwd when the target is a checkout.
 */
function buildBranchesCommand(target: RemoteBranchTarget): {
	args: string[];
	cwd?: string;
} {
	const [fieldFlag, owner, name] =
		target.kind === 'checkout'
			? (['-F', '{owner}', '{repo}'] as const)
			: (['-f', target.owner, target.name] as const);

	return {
		args: [
			'api',
			'graphql',
			fieldFlag,
			`owner=${owner}`,
			fieldFlag,
			`name=${name}`,
			'-f',
			`query=${BRANCHES_QUERY}`,
		],
		...(target.kind === 'checkout' ? { cwd: target.checkoutPath } : {}),
	};
}

/**
 * Asks GitHub for a repository's branch refs over `gh api graphql`.
 * @param options - The `gh` runner and the repository to read.
 * @returns The parsed branch names, or the failure that stopped them.
 */
export async function fetchRemoteBranches({
	localCommandService,
	target,
}: {
	localCommandService: LocalCommandService;
	target: RemoteBranchTarget;
}): Promise<FetchRemoteBranchesResult> {
	const result = await localCommandService.run({
		...buildBranchesCommand(target),
		command: 'gh',
		maxOutputBytes: GH_MAX_OUTPUT_BYTES,
		timeoutMs: GH_TIMEOUT_MS,
	});

	if (result.status !== 'success') {
		return {
			error: classifyCommandFailure(result, 'gh list command failed.'),
			ok: false,
		};
	}

	const parsed = parseBranches(result.stdout);
	if (!parsed) {
		return {
			error: {
				code: 'parse-failed',
				message: 'Could not parse gh api graphql (branches) output.',
			},
			ok: false,
		};
	}

	return { branches: parsed, ok: true };
}

/**
 * Shapes parsed branch names into the rows a picker renders: the default branch
 * pinned to the top, the rest keeping GitHub's newest-commit-first order.
 * @param branches - The parsed branch names and the repository's default.
 * @param workspaceIdFor - Resolves the workspace holding a branch; a caller with
 * no checkout yet omits it, leaving every row unowned.
 * @returns The branch rows in the order the picker shows them.
 */
export function toBranchWires(
	branches: RemoteBranchNames,
	workspaceIdFor: (name: string) => string | null = () => null,
): RepositoryBranchWire[] {
	return branches.names
		.map((name) => {
			const workspaceId = workspaceIdFor(name);
			return {
				hasWorkspace: workspaceId !== null,
				isDefault: name === branches.defaultBranch,
				name,
				workspaceId,
			};
		})
		.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/**
 * Parses the branches GraphQL payload into the default branch name plus the
 * branch names (newest commit first); null when the shape is unusable.
 * @param stdout - Raw `gh api graphql` stdout.
 * @returns The default branch and branch names, or null on an unusable shape.
 */
export function parseBranches(stdout: string): RemoteBranchNames | null {
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
