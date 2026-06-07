import type { ProjectShellModel } from '@/renderer/types/workbench';
import { createDockTabs } from './dock-tabs';
import { defaultWorkspaceOpenTargets } from './open-targets';
import {
	missingScripts,
	runningDevScripts,
	setupPendingScripts,
	stoppedRunScripts,
} from './scripts';
import {
	agentLabWorkspaceFiles,
	ensembleWorkspaceFiles,
} from './workspace-files';

export const shellFixtureProjects: ProjectShellModel[] = [
	{
		id: 'ensemble',
		name: 'ensemble',
		owner: {
			avatarUrl: 'https://github.com/psoldunov.png',
			name: 'psoldunov',
		},
		pathLabel: '~/Ensemble/repos/ensemble',
		workspaces: [
			{
				branchName: 'san-antonio',
				changeSummary: {
					additions: 628,
					deletions: 31,
					files: 21,
				},
				checks: {
					detail:
						'No pull request yet. Local shell checks are the only active blockers.',
					label: 'No PR',
					status: 'pending',
				},
				dockTabs: createDockTabs({
					runStatus: 'idle',
					setupStatus: 'warning',
				}),
				id: 'san-antonio',
				name: 'Conductor shell rework',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Ensemble/workspaces/ensemble/san-antonio',
				projectId: 'ensemble',
				pullRequest: {
					checks: [
						{
							durationLabel: '33s',
							id: 'scan',
							label: 'scan',
							provider: 'github',
							status: 'ready',
							url: 'https://github.com/psoldunov/ensemble/actions/runs/102',
						},
					],
					comments: [
						{
							detail: '<!-- linear-linkback --> <details> <summary><a hre...',
							id: 'linear-linkback',
							provider: 'linear',
						},
						{
							detail: '<!-- react-doctor:summary --> **React Doctor** fo...',
							id: 'react-doctor-summary',
							provider: 'github-actions',
						},
						{
							detail: 'src/renderer/routing/router.tsx:69',
							id: 'router-comment',
							provider: 'github-actions',
						},
					],
					description: [
						'Reworks the scaffolded renderer into a fixture-backed Conductor-style workbench shell with project/workspace sidebar, chat tabs, center timeline/composer, right review/checks panel, PR-state header, and setup/run/terminal dock.',
						'Adds TanStack Router/Query for renderer navigation and preload-backed snapshots, replacing Jotai route state and removing the old scaffold/demo surfaces.',
						'Updates product docs so future repository, terminal, file, diff, checks, and settings tickets wire live data into existing shell regions instead of creating them.',
						'Validation: `bun run check`, `bun run typecheck`, `bun run test:renderer`.',
					],
					detail: 'The agent is updating this workspace.',
					gitStatus: {
						actionLabel: 'Merge',
						label: 'Ready to merge',
						status: 'ready',
					},
					label: 'Working...',
					number: 13,
					status: 'agent-working',
					title: 'THE-102 Rework workbench shell',
					todos: [],
				},
				reviewFiles: [
					{
						additions: 220,
						deletions: 34,
						id: 'renderer-app',
						path: 'src/renderer/components/app.tsx',
						status: 'modified',
					},
					{
						additions: 280,
						deletions: 0,
						id: 'workbench-shell',
						path: 'src/renderer/components/workbench-shell.tsx',
						status: 'added',
					},
					{
						additions: 96,
						deletions: 0,
						id: 'workbench-fixtures',
						path: 'src/renderer/fixtures/workbench/projects.ts',
						status: 'added',
					},
					{
						additions: 34,
						deletions: 8,
						id: 'main',
						path: 'src/renderer/main.tsx',
						status: 'modified',
					},
				],
				scripts: runningDevScripts,
				sessions: [
					{
						id: 'review-shell',
						label: 'Review shell',
						status: 'idle',
						summary:
							'Fixture session showing the Conductor-style pane hierarchy before Pi RPC is wired.',
						updatedLabel: '2m ago',
					},
					{
						id: 'setup-thread',
						label: 'Setup notes',
						status: 'working',
						summary:
							'Setup script output remains visible in the dock instead of taking over the route.',
						updatedLabel: '12m ago',
					},
				],
				sourceSummary: 'branched from master with copied local context',
				status: 'needs-setup',
				workspaceFiles: ensembleWorkspaceFiles,
			},
			{
				branchName: 'linear-issue-flow',
				changeSummary: {
					additions: 144,
					deletions: 12,
					files: 5,
				},
				checks: {
					detail: 'Fixture workspace reserved for future Linear issue wiring.',
					label: 'Draft',
					status: 'pending',
				},
				dockTabs: createDockTabs({
					runStatus: 'idle',
					setupStatus: 'ready',
				}),
				id: 'linear-issue-flow',
				name: 'Linear issue flow',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Ensemble/workspaces/ensemble/linear-issue-flow',
				projectId: 'ensemble',
				pullRequest: {
					checks: [
						{
							durationLabel: 'running',
							id: 'build',
							label: 'build',
							provider: 'github',
							status: 'pending',
							url: 'https://github.com/psoldunov/ensemble/actions/runs/118',
						},
					],
					comments: [],
					description: [
						'Fixture workspace reserved for the PR creation and check-polling flow.',
					],
					detail: '1 check pending...',
					gitStatus: {
						label: '1 check pending...',
						status: 'pending',
					},
					label: '1 check pending...',
					number: 18,
					status: 'checking',
					title: 'THE-118 Wire Linear issue flow',
					todos: [],
				},
				reviewFiles: [],
				scripts: setupPendingScripts,
				sessions: [
					{
						id: 'issue-kickoff',
						label: 'Issue kickoff',
						status: 'idle',
						summary: 'Future Pi session seeded from Linear metadata.',
						updatedLabel: '1h ago',
					},
				],
				sourceSummary: 'fixture workspace from future issue picker',
				status: 'idle',
				workspaceFiles: ensembleWorkspaceFiles,
			},
			{
				branchName: 'normal-right-header',
				changeSummary: {
					additions: 0,
					deletions: 0,
					files: 0,
				},
				checks: {
					detail:
						'Fixture workspace for the plain working header without a pull request number.',
					label: 'Working',
					status: 'pending',
				},
				dockTabs: createDockTabs({
					runStatus: 'idle',
					setupStatus: 'ready',
				}),
				id: 'normal-right-header',
				name: 'Normal right header',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Ensemble/workspaces/ensemble/normal-right-header',
				projectId: 'ensemble',
				pullRequest: {
					checks: [],
					comments: [],
					description: [],
					detail: 'The agent is working before a PR exists.',
					gitStatus: {
						label: 'No PR open',
						status: 'open',
					},
					label: 'Working...',
					status: 'agent-working',
					title: '',
					todos: [],
				},
				reviewFiles: [],
				scripts: missingScripts,
				sessions: [
					{
						id: 'plain-header',
						label: 'Plain header',
						status: 'working',
						summary:
							'Fixture showing the normal right sidebar top heading without PR metadata.',
						updatedLabel: 'now',
					},
				],
				sourceSummary: 'fixture branch for the normal right sidebar header',
				status: 'working',
				workspaceFiles: ensembleWorkspaceFiles,
			},
			{
				branchName: 'changed-right-header',
				changeSummary: {
					additions: 18,
					deletions: 3,
					files: 1,
				},
				checks: {
					detail:
						'Fixture workspace for the changed header before a pull request exists.',
					label: 'Changed',
					status: 'pending',
				},
				dockTabs: createDockTabs({
					runStatus: 'idle',
					setupStatus: 'ready',
				}),
				id: 'changed-right-header',
				name: 'Changed right header',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Ensemble/workspaces/ensemble/changed-right-header',
				projectId: 'ensemble',
				pullRequest: {
					checks: [],
					comments: [],
					description: [],
					detail: 'Local changes are ready for pull request creation.',
					gitStatus: {
						label: 'No PR open',
						status: 'open',
					},
					label: 'No PR',
					status: 'agent-working',
					title: '',
					todos: [],
				},
				reviewFiles: [
					{
						additions: 18,
						deletions: 3,
						id: 'right-sidebar-header',
						path: 'src/renderer/components/workbench-shell.tsx',
						status: 'modified',
					},
				],
				scripts: stoppedRunScripts,
				sessions: [
					{
						id: 'changed-header',
						label: 'Changed header',
						status: 'working',
						summary:
							'Fixture showing Create PR in the top header when local changes exist.',
						updatedLabel: 'now',
					},
				],
				sourceSummary: 'fixture branch for the changed right sidebar header',
				status: 'working',
				workspaceFiles: ensembleWorkspaceFiles,
			},
		],
	},
	{
		id: 'agent-lab',
		name: 'agent-lab',
		owner: {
			name: 'agent-lab',
		},
		pathLabel: '~/Ensemble/repos/agent-lab',
		workspaces: [
			{
				branchName: 'review-checks',
				changeSummary: {
					additions: 58,
					deletions: 7,
					files: 47,
				},
				checks: {
					detail: 'Ready-state fixture for future GitHub checks panel work.',
					label: 'Ready',
					status: 'ready',
				},
				dockTabs: createDockTabs({
					runStatus: 'running',
					setupStatus: 'ready',
				}),
				id: 'review-checks',
				name: 'Review checks',
				openTargets: defaultWorkspaceOpenTargets,
				pathLabel: '~/Ensemble/workspaces/agent-lab/review-checks',
				projectId: 'agent-lab',
				pullRequest: {
					checks: [
						{
							durationLabel: '41s',
							id: 'scan',
							label: 'scan',
							provider: 'github',
							status: 'ready',
							url: 'https://github.com/psoldunov/ensemble/actions/runs/129',
						},
					],
					comments: [],
					description: [
						'Adds the ready-to-merge checks fixture used by the right review panel.',
					],
					detail: 'All required checks passed.',
					gitStatus: {
						actionLabel: 'Merge',
						label: 'Ready to merge',
						status: 'ready',
					},
					label: 'Ready to merge',
					number: 29,
					previewDeployment: {
						label: 'Preview',
						provider: 'vercel',
						source: 'github-deployment',
						status: 'ready',
						url: 'https://ensemble-review-checks.vercel.app',
					},
					status: 'ready-to-merge',
					title: 'feat(payouts): monthly agency payout ledger',
					todos: [],
					url: 'https://github.com/psoldunov/ensemble/pull/29',
				},
				reviewFiles: [],
				scripts: runningDevScripts,
				sessions: [
					{
						id: 'checks-pass',
						label: 'Checks pass',
						status: 'working',
						summary: 'Fixture showing a running agent tab.',
						updatedLabel: 'now',
					},
				],
				sourceSummary: 'fixture branch for review panel shape',
				status: 'working',
				workspaceFiles: agentLabWorkspaceFiles,
			},
		],
	},
];
