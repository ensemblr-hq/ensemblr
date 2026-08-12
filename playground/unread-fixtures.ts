import { shellFixtureProjects } from '@/renderer/fixtures/workbench';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

const baseWorkspace = shellFixtureProjects[0].workspaces[0];

/**
 * Builds a sidebar-row workspace for one case. The pull request, checks, and
 * working status are all cleared so every row settles on the calm branch icon:
 * the fixture's own open PR and pending checks each put a spinner in the icon
 * slot, and that is the corner of the row the unread dot is judged against.
 */
function workspaceCase({
	additions,
	branchName,
	deletions,
	id,
	name,
}: {
	additions: number;
	branchName: string;
	deletions: number;
	id: string;
	name: string;
}): WorkspaceShellModel {
	return {
		...baseWorkspace,
		branchName,
		changeSummary: { additions, deletions, files: additions > 0 ? 4 : 0 },
		checks: { ...baseWorkspace.checks, status: 'ready' },
		id,
		name,
		pullRequest: { ...baseWorkspace.pullRequest, number: undefined },
		status: 'idle',
	};
}

/** The four sidebar rows the scene stacks, one per unread permutation. */
export const UNREAD_ROW_CASES = [
	{
		note: 'nothing waiting',
		unreadCount: 0,
		workspace: workspaceCase({
			additions: 0,
			branchName: 'psoldunov/composer-polish',
			deletions: 0,
			id: 'row-read',
			name: 'Composer polish',
		}),
	},
	{
		note: 'one unread chat',
		unreadCount: 1,
		workspace: workspaceCase({
			additions: 0,
			branchName: 'psoldunov/timeline-descriptors',
			deletions: 0,
			id: 'row-unread-one',
			name: 'Timeline descriptors',
		}),
	},
	{
		note: 'nine unread chats',
		unreadCount: 9,
		workspace: workspaceCase({
			additions: 0,
			branchName: 'psoldunov/keymap-regressions',
			deletions: 0,
			id: 'row-unread-many',
			name: 'Keymap regressions',
		}),
	},
	{
		note: 'unread alongside diff stats and a running dock',
		unreadCount: 3,
		workspace: workspaceCase({
			additions: 628,
			branchName: 'psoldunov/workbench-shell-rework',
			deletions: 31,
			id: 'row-unread-busy',
			name: 'Workbench shell rework with a very long name',
		}),
	},
] as const;

/** Builds one chat strip tab, defaulting every flag the scene does not vary. */
function sessionCase({
	id,
	isSubAgent = false,
	label,
	status = 'idle',
}: {
	id: string;
	isSubAgent?: boolean;
	label: string;
	status?: SessionTabModel['status'];
}): SessionTabModel {
	return {
		agentSessionId: `session-${id}`,
		chatTabId: id,
		id,
		isPreview: false,
		isSubAgent,
		kind: 'chat',
		label,
		status,
		summary: '',
		updatedLabel: '2m ago',
	};
}

/** Strip tabs covering active, plain, working, sub-agent, and unread states. */
export const UNREAD_SESSION_TABS: SessionTabModel[] = [
	sessionCase({ id: 'tab-active', label: 'Unread mechanism' }),
	sessionCase({ id: 'tab-plain', label: 'Composer polish' }),
	sessionCase({ id: 'tab-unread', label: 'Sidebar dot' }),
	sessionCase({
		id: 'tab-working',
		label: 'Playground scene',
		status: 'working',
	}),
	sessionCase({ id: 'tab-subagent', isSubAgent: true, label: 'Locale sweep' }),
	sessionCase({
		id: 'tab-unread-subagent',
		isSubAgent: true,
		label: 'Glossary row',
	}),
];

/** Which strip tabs the scene marks unread when the toggle is on. */
export const UNREAD_SESSION_TAB_IDS: readonly string[] = [
	'tab-unread',
	'tab-unread-subagent',
	'tab-active',
];
