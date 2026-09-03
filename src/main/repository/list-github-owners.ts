import type {
	GithubOwnerEntry,
	GithubOwnerListResult,
} from '../../shared/ipc/contracts/quick-start';
import type { LocalCommandService } from '../commands/local-command';
import { classifyCommandFailure } from '../github/gh-failures.ts';

/** Public surface of the gh-backed GitHub owner listing service. */
export interface GithubOwnerListService {
	list: () => Promise<GithubOwnerListResult>;
}

/** Options for {@link createGithubOwnerListService}. */
export interface CreateGithubOwnerListServiceOptions {
	localCommandService: LocalCommandService;
	now?: () => Date;
}

const GH_TIMEOUT_MS = 10_000;
const GH_MAX_OUTPUT_BYTES = 1024 * 128;
const GH_ORG_PAGE_SIZE = 100;
const GH_MEMBERSHIP_QUERY = `user/orgs?per_page=${GH_ORG_PAGE_SIZE}`;
const GH_MEMBERSHIP_JQ = 'map({avatar_url, login})';
const GH_PERMISSION_QUERY = `query {
	viewer {
		login
		avatarUrl
		organizations(first: ${GH_ORG_PAGE_SIZE}) {
			nodes { login name avatarUrl viewerCanCreateRepositories }
		}
	}
}`;

/** Shape of the trimmed `gh api user/orgs` payload. */
interface RawMembership {
	avatar_url?: unknown;
	login?: unknown;
}

/** Shape of the `gh api graphql` viewer payload. */
interface RawViewerPayload {
	data?: {
		viewer?: {
			avatarUrl?: unknown;
			login?: unknown;
			organizations?: { nodes?: unknown } | null;
		} | null;
	} | null;
}

/** An organization GraphQL could resolve for the signed-in user. */
interface ResolvedOrganization {
	avatarUrl: string | null;
	canCreate: boolean;
	displayName: string | null;
	login: string;
}

/**
 * Builds the service that lists every GitHub account a quick-start project can
 * be published under: the signed-in user plus each organization they belong to.
 *
 * Two `gh` calls, because neither answers alone. REST `user/orgs` enumerates
 * memberships including concealed ones, but carries no permission data. GraphQL
 * `viewer.organizations` carries `viewerCanCreateRepositories`, but silently
 * omits any organization the token cannot reach — a SAML-protected org, or one
 * behind an enterprise 2FA policy. The difference between the two lists is
 * therefore the set of organizations the user belongs to but cannot publish
 * into, which the picker shows disabled rather than hiding.
 *
 * Neither call feeds the other, so both are issued at once: serially they cost
 * the sum of two network round trips (~3.5s measured), concurrently only the
 * slower one. `LocalCommandService` memoizes its shell-environment promise
 * before awaiting it, so the two share one environment resolution rather than
 * racing two shell spawns.
 *
 * Any failure yields an empty list; the renderer hides the picker entirely and
 * quick-start falls back to publishing under the signed-in user, exactly as it
 * did before the picker existed. The `error` string is diagnostic only and is
 * never rendered, so it stays locale-neutral English.
 * @param options - Service dependencies and overrides.
 * @returns A {@link GithubOwnerListService}.
 */
export function createGithubOwnerListService({
	localCommandService,
	now = () => new Date(),
}: CreateGithubOwnerListServiceOptions): GithubOwnerListService {
	return {
		list: async () => {
			const generatedAt = now().toISOString();

			const [memberships, permissions] = await Promise.all([
				fetchMemberships(localCommandService),
				fetchViewerPermissions(localCommandService),
			]);

			if (!memberships.ok) {
				return {
					error: memberships.error,
					generatedAt,
					owners: [],
					status: 'failure',
				};
			}

			if (!permissions.ok) {
				return {
					error: permissions.error,
					generatedAt,
					owners: [],
					status: 'failure',
				};
			}

			return {
				generatedAt,
				owners: mergeOwners(memberships.entries, permissions),
				status: 'success',
			};
		},
	};
}

/** Outcome of the REST membership call. */
type MembershipOutcome =
	| { entries: RawMembership[]; ok: true }
	| { error: string; ok: false };

/** Lists every organization the signed-in user belongs to, concealed ones included. */
async function fetchMemberships(
	localCommandService: LocalCommandService,
): Promise<MembershipOutcome> {
	const result = await localCommandService.run({
		args: [
			'api',
			'--paginate=false',
			GH_MEMBERSHIP_QUERY,
			'--jq',
			GH_MEMBERSHIP_JQ,
		],
		command: 'gh',
		maxOutputBytes: GH_MAX_OUTPUT_BYTES,
		timeoutMs: GH_TIMEOUT_MS,
	});

	if (result.status !== 'success') {
		return {
			error: classifyCommandFailure(result, 'gh api user/orgs failed.').message,
			ok: false,
		};
	}

	const parsed = parseJson(result.stdout);
	if (!Array.isArray(parsed)) {
		return {
			error: 'gh returned an unexpected user/orgs response shape.',
			ok: false,
		};
	}
	return { entries: parsed as RawMembership[], ok: true };
}

/** Outcome of the GraphQL viewer call. */
type PermissionOutcome =
	| {
			avatarUrl: string | null;
			login: string;
			ok: true;
			organizations: Map<string, ResolvedOrganization>;
	  }
	| { error: string; ok: false };

/** Resolves the signed-in login plus the organizations GraphQL can see for them. */
async function fetchViewerPermissions(
	localCommandService: LocalCommandService,
): Promise<PermissionOutcome> {
	const result = await localCommandService.run({
		args: ['api', 'graphql', '-f', `query=${GH_PERMISSION_QUERY}`],
		command: 'gh',
		maxOutputBytes: GH_MAX_OUTPUT_BYTES,
		timeoutMs: GH_TIMEOUT_MS,
	});

	if (result.status !== 'success') {
		return {
			error: classifyCommandFailure(result, 'gh api graphql failed.').message,
			ok: false,
		};
	}

	const parsed = parseJson(result.stdout) as RawViewerPayload | null;
	const viewer = parsed?.data?.viewer;
	if (!viewer || typeof viewer.login !== 'string' || !viewer.login) {
		return {
			error: 'gh returned an unexpected graphql response shape.',
			ok: false,
		};
	}

	return {
		avatarUrl: typeof viewer.avatarUrl === 'string' ? viewer.avatarUrl : null,
		login: viewer.login,
		ok: true,
		organizations: toOrganizationMap(viewer.organizations?.nodes),
	};
}

/** Indexes the GraphQL organization nodes by login, dropping malformed entries. */
function toOrganizationMap(nodes: unknown): Map<string, ResolvedOrganization> {
	const byLogin = new Map<string, ResolvedOrganization>();
	if (!Array.isArray(nodes)) {
		return byLogin;
	}

	for (const node of nodes) {
		if (!node || typeof node !== 'object') {
			continue;
		}
		const record = node as Record<string, unknown>;
		if (typeof record.login !== 'string' || !record.login) {
			continue;
		}
		byLogin.set(record.login, {
			avatarUrl: typeof record.avatarUrl === 'string' ? record.avatarUrl : null,
			canCreate: record.viewerCanCreateRepositories === true,
			displayName:
				typeof record.name === 'string' && record.name ? record.name : null,
			login: record.login,
		});
	}
	return byLogin;
}

/**
 * Folds the two `gh` answers into one ordered picker list: the signed-in user
 * first, then the organizations they can publish into, then the ones they
 * cannot — each of the latter carrying the code that says why.
 */
function mergeOwners(
	memberships: RawMembership[],
	viewer: Extract<PermissionOutcome, { ok: true }>,
): GithubOwnerEntry[] {
	const creatable: GithubOwnerEntry[] = [];
	const blocked: GithubOwnerEntry[] = [];

	for (const membership of memberships) {
		if (typeof membership?.login !== 'string' || !membership.login) {
			continue;
		}
		const resolved = viewer.organizations.get(membership.login);
		const avatarUrl =
			resolved?.avatarUrl ??
			(typeof membership.avatar_url === 'string'
				? membership.avatar_url
				: null);

		if (resolved?.canCreate) {
			creatable.push({
				avatarUrl,
				canCreate: true,
				displayName: resolved.displayName,
				kind: 'organization',
				login: membership.login,
				restriction: null,
			});
			continue;
		}

		blocked.push({
			avatarUrl,
			canCreate: false,
			displayName: resolved?.displayName ?? null,
			kind: 'organization',
			login: membership.login,
			restriction: resolved
				? {
						code: 'owner-create-restricted',
						message: `${membership.login} reserves repository creation for its owners.`,
					}
				: {
						code: 'owner-access-restricted',
						message: `${membership.login} is not reachable with the current gh token; it may require SAML single sign-on or a stricter two-factor policy.`,
					},
		});
	}

	const viewerEntry: GithubOwnerEntry = {
		avatarUrl: viewer.avatarUrl,
		canCreate: true,
		displayName: null,
		kind: 'user',
		login: viewer.login,
		restriction: null,
	};

	return [viewerEntry, ...sortByLogin(creatable), ...sortByLogin(blocked)];
}

/** Orders owners case-insensitively by login so the dropdown reads predictably. */
function sortByLogin(entries: GithubOwnerEntry[]): GithubOwnerEntry[] {
	return [...entries].sort((left, right) =>
		left.login.localeCompare(right.login, 'en', { sensitivity: 'base' }),
	);
}

/** Parses `gh` stdout, returning `null` rather than throwing on malformed JSON. */
function parseJson(stdout: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		return null;
	}
}
