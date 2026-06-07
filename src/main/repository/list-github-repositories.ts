import type {
	GithubRepositoryEntry,
	GithubRepositoryListResult,
} from '../../shared/ipc';
import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';

/** Public surface of the gh-backed repository listing service. */
export interface GithubRepositoryListService {
	list: () => Promise<GithubRepositoryListResult>;
}

/** Options for {@link createGithubRepositoryListService}. */
export interface CreateGithubRepositoryListServiceOptions {
	localCommandService: LocalCommandService;
	now?: () => Date;
}

const GH_TIMEOUT_MS = 10_000;
const GH_MAX_OUTPUT_BYTES = 1024 * 512;
const GH_REPO_LIST_LIMIT = 8;
const GH_REPO_LIST_QUERY = `user/repos?sort=updated&per_page=${GH_REPO_LIST_LIMIT}&affiliation=owner,collaborator,organization_member`;

/** Shape of the relevant fields from `gh api user/repos` payloads. */
interface RawGithubRepository {
	description?: unknown;
	full_name?: unknown;
	owner?: { login?: unknown } | null;
	private?: unknown;
	updated_at?: unknown;
}

/**
 * Builds the service that asks `gh` for repositories the authenticated user can
 * see, mapping the response into the renderer-friendly contract. Failures
 * surface a single human-readable error and an empty list rather than throwing.
 * @param options - Service dependencies and overrides.
 * @returns A {@link GithubRepositoryListService}.
 */
export function createGithubRepositoryListService({
	localCommandService,
	now = () => new Date(),
}: CreateGithubRepositoryListServiceOptions): GithubRepositoryListService {
	return {
		list: async () => {
			const generatedAt = now().toISOString();

			const result = await localCommandService.run({
				args: ['api', '--paginate=false', GH_REPO_LIST_QUERY],
				command: 'gh',
				maxOutputBytes: GH_MAX_OUTPUT_BYTES,
				timeoutMs: GH_TIMEOUT_MS,
			});

			if (result.status !== 'success') {
				return {
					entries: [],
					error: mapFailure(result),
					generatedAt,
					status: 'failure',
				};
			}

			const entries = parseGithubRepositories(result.stdout);
			if (!entries) {
				return {
					entries: [],
					error: 'gh returned an unexpected response shape.',
					generatedAt,
					status: 'failure',
				};
			}

			return {
				entries,
				generatedAt,
				status: 'success',
			};
		},
	};
}

/**
 * Parses the JSON array returned by `gh api user/repos` into the renderer
 * contract, dropping entries missing a usable `full_name`.
 */
function parseGithubRepositories(
	stdout: string,
): GithubRepositoryEntry[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return null;
	}

	if (!Array.isArray(parsed)) {
		return null;
	}

	const entries: GithubRepositoryEntry[] = [];
	for (const raw of parsed) {
		const entry = toEntry(raw);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

/** Coerces a single `gh api` element into a {@link GithubRepositoryEntry}. */
function toEntry(raw: unknown): GithubRepositoryEntry | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const record = raw as RawGithubRepository;
	if (typeof record.full_name !== 'string' || !record.full_name) {
		return null;
	}

	const ownerLogin =
		record.owner && typeof record.owner.login === 'string'
			? record.owner.login
			: (record.full_name.split('/')[0] ?? '');

	return {
		description:
			typeof record.description === 'string' ? record.description : null,
		fullName: record.full_name,
		isPrivate: record.private === true,
		ownerLogin,
		updatedAt: typeof record.updated_at === 'string' ? record.updated_at : '',
	};
}

/** Maps a failed {@link LocalCommandResult} into a user-facing error string. */
function mapFailure(result: LocalCommandResult): string {
	switch (result.failure?.code) {
		case 'command-not-found':
			return 'GitHub CLI is not installed; install gh or sign in to populate this list.';
		case 'timeout':
			return 'gh api timed out before returning the repository list.';
		case 'output-truncated':
			return 'gh returned more data than Ensemble can buffer; narrow the affiliation filter.';
		case 'nonzero-exit':
			if (
				result.stderr.toLowerCase().includes('authentication') ||
				result.stderr.toLowerCase().includes('not logged') ||
				result.stderr.includes('401')
			) {
				return 'Run gh auth login --hostname github.com to populate this list.';
			}
			return firstLine(result.stderr) || 'gh api failed.';
		default:
			return result.failure?.message ?? 'gh api failed.';
	}
}

/** Returns the first non-blank line of `text`, trimmed; empty string otherwise. */
function firstLine(text: string): string {
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) {
			return trimmed;
		}
	}
	return '';
}
