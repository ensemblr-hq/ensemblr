import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';

import {
	settingsResolutionQuery,
	workspaceFilesQuery,
	workspaceGitStatusQuery,
} from '@/renderer/api/ensemblr-queries';
import {
	buildWorkspaceScriptSummaries,
	scriptSummaryToDockStatus,
} from '@/renderer/lib/terminal/script-summaries';
import { mapTerminalSessionsToDockTabs } from '@/renderer/lib/terminal/terminal-tabs';
import { mapGitStatusToReviewFiles } from '@/renderer/lib/workbench/review-files';
import type { useWorkspaceTerminalSessions } from '@/renderer/state/workspace/terminal-sessions';
import type {
	WorkspaceFileSummary,
	WorkspaceNavigationSelection,
} from '@/renderer/types/workbench';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';
import { parseWorkspaceScriptSettings } from '@/shared/scripts/script-settings';

import { useEnsureWorkspaceSetup } from './use-ensure-workspace-setup';
import { useLivePullRequestModel } from './use-live-pull-request-model';
import { usePullRequestAutoRefresh } from './use-pull-request-auto-refresh';
import { useWorkspaceFilesWatch } from './use-workspace-files-watch';

/** The project of the current workspace navigation selection. */
type ActiveProject = WorkspaceNavigationSelection['project'];
/** The workspace of the current workspace navigation selection. */
type ActiveWorkspace = WorkspaceNavigationSelection['workspace'];
/** The terminal-sessions state returned by {@link useWorkspaceTerminalSessions}. */
type TerminalSessions = ReturnType<typeof useWorkspaceTerminalSessions>;

/**
 * Parses workspace script settings out of a resolved settings snapshot. Hoisted
 * to module scope so its reference stays stable across renders: an inline
 * `select` re-runs the parse on every render, whereas a stable function only
 * re-runs when the underlying snapshot changes.
 */
function selectScriptSettings(snapshot: SettingsResolutionSnapshot) {
	return parseWorkspaceScriptSettings(snapshot.repository?.settings ?? []);
}

/**
 * Assembles the live workspace shell model: merges git status, workspace
 * files, PR snapshot, and local review state into the placeholder workspace
 * so the route component stays pure composition.
 */
export function useLiveWorkspaceModel({
	activeProject,
	activeWorkspace,
	terminalSessions,
}: {
	activeProject: ActiveProject;
	activeWorkspace: ActiveWorkspace;
	terminalSessions: TerminalSessions;
}): {
	liveWorkspaceFiles: ActiveWorkspace['workspaceFiles'];
	workspaceWithLiveDockTabs: ActiveWorkspace;
} {
	// Run the setup script on open only when the dependency fingerprint is
	// missing or stale, so restarting into a workspace never needlessly reinstalls.
	useEnsureWorkspaceSetup(activeWorkspace.id);
	// Refresh the files tree the instant an agent or the user changes files on
	// disk, rather than waiting for the query's polling fallback.
	useWorkspaceFilesWatch({
		repositoryId: activeProject.id,
		workspaceCwd: activeWorkspace.pathLabel ?? null,
	});
	// Refresh the PR snapshot the instant the agent finishes a turn, so a PR it
	// just created/pushed/merged surfaces without waiting for the 30s poll.
	usePullRequestAutoRefresh({
		workspaceCwd: activeWorkspace.pathLabel ?? null,
		workspaceId: activeWorkspace.id,
	});

	// Derive script settings from the shared settings-resolution cache rather
	// than a second private query: the Scripts settings screen invalidates that
	// key on save, so a newly configured setup/run script reaches the dock at
	// once instead of waiting out a stale-time on a cache nothing invalidates.
	const { data: scriptSettingsData } = useQuery({
		...settingsResolutionQuery({
			repositoryId: activeProject.id,
			repositoryPath: activeWorkspace.pathLabel,
		}),
		select: selectScriptSettings,
	});
	const { data: gitStatusData } = useQuery(
		workspaceGitStatusQuery(activeWorkspace.pathLabel ?? null),
	);
	const { data: allFilesData } = useQuery(
		workspaceFilesQuery(activeWorkspace.pathLabel ?? null),
	);

	// Refetches (the 30s poll + the fs watcher) hand back a fresh `files` array
	// even when the file set is unchanged. Key the remap on a content signature
	// and return the *same* array reference when it matches, so the files tree
	// doesn't rebuild + re-render on every poll or unrelated file write.
	const filesCacheRef = useRef<{
		signature: string;
		value: WorkspaceFileSummary[];
	} | null>(null);
	const liveWorkspaceFiles = useMemo(() => {
		const remote = allFilesData?.files ?? [];
		if (remote.length === 0) {
			return activeWorkspace.workspaceFiles;
		}
		const signature = remote
			.map((entry) => JSON.stringify([entry.path, entry.kind, entry.isIgnored]))
			.join('\n');
		const cached = filesCacheRef.current;
		if (cached && cached.signature === signature) {
			return cached.value;
		}
		const value = remote.map((entry) => ({
			id: `wsfile:${entry.path}`,
			isIgnored: entry.isIgnored,
			kind: entry.kind,
			name: entry.name,
			path: entry.path,
		}));
		filesCacheRef.current = { signature, value };
		return value;
	}, [allFilesData?.files, activeWorkspace.workspaceFiles]);

	const liveReview = useMemo(() => {
		if (!gitStatusData) {
			return {};
		}
		if (gitStatusData.error) {
			return { reviewFilesError: gitStatusData.error.message };
		}
		return {
			changeSummary: {
				additions: gitStatusData.summary.additions,
				deletions: gitStatusData.summary.deletions,
				files: gitStatusData.summary.files,
			},
			reviewFiles: mapGitStatusToReviewFiles(gitStatusData.files),
		};
	}, [gitStatusData]);
	const changeSummary =
		'changeSummary' in liveReview && liveReview.changeSummary
			? liveReview.changeSummary
			: activeWorkspace.changeSummary;

	// The active sidebar row derives its icon from this same hook (keyed by the
	// same workspace id), so header state and workspace icon move together the
	// instant a PR flips to ready-to-merge — no lag behind the navigation poll.
	const pullRequest = useLivePullRequestModel({
		changeSummary,
		fallback: activeWorkspace.pullRequest,
		workspaceCwd: activeWorkspace.pathLabel ?? null,
		workspaceId: activeWorkspace.id,
	});

	const workspaceWithLiveDockTabs = useMemo<ActiveWorkspace>(() => {
		const scripts = buildWorkspaceScriptSummaries({
			sessions: terminalSessions.sessions,
			settings: scriptSettingsData ?? null,
		});

		return {
			...activeWorkspace,
			dockTabs: [
				...activeWorkspace.dockTabs.flatMap(
					(tab): typeof activeWorkspace.dockTabs => {
						if (tab.kind === 'terminal') {
							return [];
						}
						if (tab.kind === 'setup-script') {
							return [
								{ ...tab, status: scriptSummaryToDockStatus(scripts.setup) },
							];
						}
						if (tab.kind === 'run-script') {
							return [
								{ ...tab, status: scriptSummaryToDockStatus(scripts.run) },
							];
						}
						return [tab];
					},
				),
				...mapTerminalSessionsToDockTabs({
					activeTerminalIds: terminalSessions.activeTerminalIds,
					sessions: terminalSessions.sessions,
				}),
			],
			...liveReview,
			pullRequest,
			scripts,
			workspaceFiles: liveWorkspaceFiles,
		};
	}, [
		activeWorkspace,
		liveReview,
		liveWorkspaceFiles,
		pullRequest,
		scriptSettingsData,
		terminalSessions.activeTerminalIds,
		terminalSessions.sessions,
	]);

	return { liveWorkspaceFiles, workspaceWithLiveDockTabs };
}
