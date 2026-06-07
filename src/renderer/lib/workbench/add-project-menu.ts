import type {
	AddProjectActionId,
	AddProjectActionModel,
	AddProjectMenuModel,
	RecentProject,
} from '@/renderer/types/workbench';
import type { SetupCheckId, SetupDiagnosticsSnapshot } from '@/shared/ipc';

interface AddProjectActionDefinition {
	id: AddProjectActionId;
	label: string;
	/**
	 * Setup checks that must not be in a failed state before the action can run.
	 * The add-project menu only gates on a definitively failed prerequisite so
	 * unknown or still-running diagnostics stay optimistically enabled.
	 */
	requiredCheckIds: SetupCheckId[];
	unavailableReason: string;
}

/**
 * Project-level add actions. Workspace-level actions (new workspace, create from
 * issue/PR) are modeled separately in the project context menu, so the ticket's
 * "treat project and workspace actions as distinct in menu state" requirement is
 * preserved by keeping this catalog project-only.
 */
const ADD_PROJECT_ACTION_DEFINITIONS: readonly AddProjectActionDefinition[] = [
	{
		id: 'open-local',
		label: 'Open local project',
		requiredCheckIds: ['root-directory'],
		unavailableReason:
			'Set a writable Ensemble root directory before opening local projects.',
	},
	{
		id: 'open-github',
		label: 'Open GitHub project',
		requiredCheckIds: ['gh-cli', 'gh-auth'],
		unavailableReason:
			'Sign in with the GitHub CLI (gh auth login) to open GitHub projects.',
	},
	{
		id: 'quick-start',
		label: 'Quick start',
		requiredCheckIds: ['root-directory'],
		unavailableReason:
			'Set a writable Ensemble root directory before starting a new project.',
	},
];

export function buildAddProjectMenuModel({
	recents,
	setupSnapshot,
}: {
	recents: RecentProject[];
	setupSnapshot: SetupDiagnosticsSnapshot | null;
}): AddProjectMenuModel {
	return {
		actions: ADD_PROJECT_ACTION_DEFINITIONS.map((definition) =>
			resolveAddProjectAction(definition, setupSnapshot),
		),
		recents,
	};
}

function resolveAddProjectAction(
	definition: AddProjectActionDefinition,
	setupSnapshot: SetupDiagnosticsSnapshot | null,
): AddProjectActionModel {
	const blockingReason = setupSnapshot
		? resolveBlockingReason(definition, setupSnapshot)
		: null;

	return {
		enabled: blockingReason === null,
		id: definition.id,
		label: definition.label,
		unavailableReason: blockingReason,
	};
}

function resolveBlockingReason(
	definition: AddProjectActionDefinition,
	setupSnapshot: SetupDiagnosticsSnapshot,
): string | null {
	for (const checkId of definition.requiredCheckIds) {
		const check = setupSnapshot.checks.find(
			(candidate) => candidate.id === checkId,
		);

		// Only a check we can see AND that has definitively failed blocks the
		// action. Missing, pending, running, warning, or successful checks leave
		// the action enabled so we never disable on an unknown prerequisite.
		if (check && check.status === 'failure') {
			return (
				describeFailedCheck(check.detail, check.title) ??
				definition.unavailableReason
			);
		}
	}

	return null;
}

function describeFailedCheck(
	detail: string | undefined,
	title: string | undefined,
): string | null {
	const trimmedDetail = detail?.trim();
	if (trimmedDetail) {
		return trimmedDetail;
	}

	const trimmedTitle = title?.trim();
	return trimmedTitle ? `${trimmedTitle} is not ready yet.` : null;
}
