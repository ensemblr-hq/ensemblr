import type {
	InfisicalAccountSnapshot,
	InfisicalEnvironmentSnapshot,
	InfisicalLinkSnapshot,
	InfisicalProjectSnapshot,
} from '@/shared/ipc/contracts/infisical';

/** Secret path a link falls back to when none is set. */
const ROOT_PATH = '/';

/** Edits made on top of the saved link, before they are written back. */
export interface InfisicalLinkDraft {
	environmentSlug: string | null;
	projectKey: string | null;
	recursive: boolean | null;
	secretPath: string | null;
}

/** A draft with nothing overridden, so every field reads from the saved link. */
export const EMPTY_INFISICAL_DRAFT: InfisicalLinkDraft = {
	environmentSlug: null,
	projectKey: null,
	recursive: null,
	secretPath: null,
};

/**
 * Identifies a project by its account as well as its id. The picker aggregates
 * every account, and two instances can hand out the same project id, so the id
 * alone is not a safe select value.
 * @param project - Project to key.
 * @returns The composite `accountId:projectId` key.
 */
export function infisicalProjectKey(project: {
	accountId: string;
	id: string;
}): string {
	return `${project.accountId}:${project.id}`;
}

/** Everything the panel's controls, dirty bar, and summary render from. */
export interface InfisicalLinkFormState {
	canSave: boolean;
	environments: InfisicalEnvironmentSnapshot[];
	environmentSlug: string | null;
	isDirty: boolean;
	project: InfisicalProjectSnapshot | null;
	projectKey: string | null;
	recursive: boolean;
	secretPath: string;
	/** Project the link names that no configured account can reach, if any. */
	unreachableProjectId: string | null;
}

/**
 * Normalises a typed secret path into the form Infisical expects: rooted,
 * without a trailing slash, and never empty.
 * @param value - Raw field value.
 * @returns The normalised path.
 */
export function normalizeSecretPath(value: string): string {
	const trimmed = value.trim();

	if (!trimmed || trimmed === ROOT_PATH) {
		return ROOT_PATH;
	}

	const rooted = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

	return rooted.replace(/\/+$/, '') || ROOT_PATH;
}

/**
 * Adopts a committed link that names no local account by finding the one
 * reachable project it points at. Candidates are narrowed to accounts on the
 * link's own instance first, and an id two accounts both answer for is left
 * unresolved rather than guessed — spending one organization's credentials
 * against another's project is the mistake the service also refuses to make.
 * @param link - The saved link, whose account half may be missing.
 * @param projects - Every project reachable across every configured account.
 * @param accounts - The configured accounts, used to place each project's instance.
 * @returns The single matching project, or null when there is none or several.
 */
function adoptCommittedProject(
	link: InfisicalLinkSnapshot,
	projects: InfisicalProjectSnapshot[],
	accounts: InfisicalAccountSnapshot[],
): InfisicalProjectSnapshot | null {
	const byProjectId = projects.filter(
		(project) => project.id === link.projectId,
	);
	const onLinkedInstance = link.siteUrl
		? byProjectId.filter((project) =>
				accounts.some(
					(account) =>
						account.id === project.accountId &&
						account.siteUrl === link.siteUrl,
				),
			)
		: byProjectId;
	const candidates = onLinkedInstance.length ? onLinkedInstance : byProjectId;

	return candidates.length === 1 ? (candidates.at(0) ?? null) : null;
}

/**
 * Merges the saved link, the aggregated project list, and the unsaved draft
 * into one state. A link whose account half is missing — the case a committed
 * `.ensemblr/settings.toml` produces on a teammate's machine — resolves itself
 * against the aggregated list, so saving is the only step left rather than
 * picking an account first. The environment only ever carries over while the
 * form still shows the linked project: two projects can both name an
 * environment `dev` without it meaning the same thing.
 * @param options - The saved link, the projects every account can reach, the configured accounts, whether that list has loaded, and the draft.
 * @returns The resolved form state.
 */
export function resolveInfisicalLinkForm({
	accounts,
	draft,
	link,
	projects,
	projectsLoaded,
}: {
	accounts: InfisicalAccountSnapshot[];
	draft: InfisicalLinkDraft;
	link: InfisicalLinkSnapshot | null;
	projects: InfisicalProjectSnapshot[];
	projectsLoaded: boolean;
}): InfisicalLinkFormState {
	const savedKey = link?.accountId
		? infisicalProjectKey({ accountId: link.accountId, id: link.projectId })
		: null;
	const adopted = link ? adoptCommittedProject(link, projects, accounts) : null;
	const projectKey =
		draft.projectKey ??
		savedKey ??
		(adopted ? infisicalProjectKey(adopted) : null);
	const project =
		projects.find(
			(candidate) => infisicalProjectKey(candidate) === projectKey,
		) ?? null;

	const showsLinkedProject = link
		? project
			? project.id === link.projectId
			: projectKey === savedKey
		: false;
	const requestedEnvironment =
		draft.environmentSlug ??
		(showsLinkedProject ? (link?.environmentSlug ?? null) : null);
	const environmentSlug =
		project &&
		!project.environments.some(
			(environment) => environment.slug === requestedEnvironment,
		)
			? null
			: requestedEnvironment;
	const environments =
		project?.environments ??
		(requestedEnvironment
			? [{ name: requestedEnvironment, slug: requestedEnvironment }]
			: []);

	const secretPath = draft.secretPath ?? link?.secretPath ?? ROOT_PATH;
	const recursive = draft.recursive ?? link?.recursive ?? false;

	const isDirty =
		projectKey !== savedKey ||
		environmentSlug !== (link?.environmentSlug ?? null) ||
		normalizeSecretPath(secretPath) !== (link?.secretPath ?? ROOT_PATH) ||
		recursive !== (link?.recursive ?? false);

	return {
		canSave: isDirty && Boolean(project) && Boolean(environmentSlug),
		environments,
		environmentSlug,
		isDirty,
		project,
		projectKey,
		recursive,
		secretPath,
		unreachableProjectId:
			link && projectsLoaded && !project ? link.projectId : null,
	};
}
