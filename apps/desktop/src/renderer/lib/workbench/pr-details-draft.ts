import type {
	PrDetailsDraft,
	PrDetailsLiveDraft,
} from '@/renderer/state/preferences';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Seeds PR title/description from the open PR. Used as the baseline until the
 * user saves a draft, and as the final fallback for surfaces that read the
 * draft without owning it (e.g. the sidebar "Create PR" menu).
 */
export function seedPrDetails(workspace: WorkspaceShellModel): PrDetailsDraft {
	return {
		description: workspace.pullRequest.description.join('\n\n'),
		title: workspace.pullRequest.title,
	};
}

/**
 * Identity of the current PR draft: workspace id + PR number. The live draft is
 * re-seeded whenever this changes (a PR is opened/closed), so a stale
 * cross-surface read is detectable by comparing identities rather than trusting
 * whatever happens to be in the in-memory atom.
 */
export function prDraftIdentity(workspace: WorkspaceShellModel): string {
	return `${workspace.id}:${workspace.pullRequest.number ?? 'none'}`;
}

/**
 * Resolves the title/description another surface should hand to the agent: the
 * live (possibly unsaved) edit when it matches the current PR identity, else the
 * saved draft, else the seed from the open PR. Keeps the Checks panel and the
 * sidebar "Create PR" menu in agreement about what the user is editing.
 */
export function resolvePrDetails({
	live,
	saved,
	workspace,
}: {
	live: PrDetailsLiveDraft | null;
	saved: PrDetailsDraft | null;
	workspace: WorkspaceShellModel;
}): PrDetailsDraft {
	if (live && live.identity === prDraftIdentity(workspace)) {
		return { description: live.description, title: live.title };
	}
	return saved ?? seedPrDetails(workspace);
}
