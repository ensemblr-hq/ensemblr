import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { Toaster } from '@/renderer/components/ui/sonner';
import { ChecksPanel } from '@/renderer/components/workbench-shell/checks-panel/checks-panel';
import { ReviewActionsContextProvider } from '@/renderer/components/workbench-shell/review-actions/review-actions-context';
import { ReviewFileList } from '@/renderer/components/workbench-shell/review-files/review-file-list';
import { RightSidebarHeader } from '@/renderer/components/workbench-shell/right-sidebar-header/right-sidebar-header';
import { resolvePullRequestAction } from '@/renderer/lib/workbench/action-prompts';
import type { ReviewActionsValue } from '@/renderer/types/workbench';

import {
	CONFLICTED_REVIEW_FILES,
	conflictedWorkspace,
	PROBED_CONFLICT_PATHS,
	WORKTREE_CONFLICT_PATHS,
} from './conflicts-fixtures.ts';
import { createPlaygroundQueryClient } from './playground-query-client.ts';
import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/**
 * How the conflicting files were found. `worktree` is a merge or rebase already
 * underway, where git marks the unmerged rows itself; `probe` is the branch
 * nobody has started merging, where only a trial merge can name the files.
 */
type ConflictSource = 'probe' | 'worktree';

/**
 * The three surfaces that report a merge conflict, driven by one workspace so
 * they can be read against each other: the header label and its resolve action,
 * the Checks panel's Conflicts section, and the Changes list split into
 * Conflicts and Clean.
 *
 * Both discovery paths are switchable because they populate different rows —
 * an in-progress merge marks the change set itself, while the trial merge names
 * paths that may not be in the change set at all.
 */
export function ConflictsScene() {
	const [client] = useState(createPlaygroundQueryClient);
	const [source, setSource] = useState<ConflictSource>('worktree');
	const [isAgentWorking, setAgentWorking] = useState(false);

	const workspace = useMemo(
		() => conflictedWorkspace(source === 'worktree'),
		[source],
	);
	const conflictPaths = useMemo(
		() =>
			new Set(
				source === 'worktree' ? WORKTREE_CONFLICT_PATHS : PROBED_CONFLICT_PATHS,
			),
		[source],
	);

	const reviewActions = useMemo<ReviewActionsValue>(
		() => ({
			archiveMergedWorkspace: () => undefined,
			commitAndPush: () => undefined,
			continueMergedWorkspace: () => undefined,
			isAgentWorking,
			isArchivingMergedWorkspace: false,
			isContinuingMergedWorkspace: false,
			isPushingBranch: false,
			isRefreshingPullRequest: false,
			openMergeConfirmation: () => undefined,
			pullRequestAction: resolvePullRequestAction(workspace),
			pushBranch: () => undefined,
			refreshPullRequest: () => undefined,
			runAgentAction: () => undefined,
		}),
		[isAgentWorking, workspace],
	);

	return (
		<QueryClientProvider client={client}>
			<ReviewActionsContextProvider value={reviewActions}>
				<div className='flex flex-col gap-8'>
					<ConflictControls
						isAgentWorking={isAgentWorking}
						onAgentWorkingChange={setAgentWorking}
						onSourceChange={setSource}
						source={source}
					/>

					<SceneSection
						label='Review sidebar header'
						note='A conflicting PR keeps the blocked tone and names the cause; the resolve action lives in the overflow menu.'
					>
						<div className='overflow-hidden rounded-md border border-border'>
							<RightSidebarHeader activeWorkspace={workspace} />
						</div>
					</SceneSection>

					<SceneSection
						label='Checks panel'
						note='The Conflicts section lists every unmergeable file and hands the whole job to the agent.'
					>
						<div className='h-128 overflow-hidden rounded-md border border-border'>
							<ChecksPanel workspace={workspace} />
						</div>
					</SceneSection>

					<SceneSection
						label='Changes list'
						note='Conflicts lead in their natural order; everything else keeps the viewed ordering below.'
					>
						<div className='h-128 overflow-hidden rounded-md border border-border'>
							<ReviewFileList
								conflictPaths={conflictPaths}
								files={[...CONFLICTED_REVIEW_FILES]}
								onDiscardFile={() => undefined}
								viewMode='list'
								workspaceCwd={workspace.pathLabel}
								workspaceId={workspace.id}
							/>
						</div>
					</SceneSection>
				</div>
				<Toaster />
			</ReviewActionsContextProvider>
		</QueryClientProvider>
	);
}

/** Toggles for the scene's two independent axes. */
function ConflictControls({
	isAgentWorking,
	onAgentWorkingChange,
	onSourceChange,
	source,
}: {
	isAgentWorking: boolean;
	onAgentWorkingChange: (value: boolean) => void;
	onSourceChange: (value: ConflictSource) => void;
	source: ConflictSource;
}) {
	return (
		<SceneControls>
			<ControlGroup label='conflict source'>
				<SceneToggle
					isActive={source === 'worktree'}
					label='worktree'
					onClick={() => onSourceChange('worktree')}
				/>
				<SceneToggle
					isActive={source === 'probe'}
					label='trial merge'
					onClick={() => onSourceChange('probe')}
				/>
			</ControlGroup>
			<ControlGroup label='agent'>
				<SceneToggle
					isActive={!isAgentWorking}
					label='idle'
					onClick={() => onAgentWorkingChange(false)}
				/>
				<SceneToggle
					isActive={isAgentWorking}
					label='working'
					onClick={() => onAgentWorkingChange(true)}
				/>
			</ControlGroup>
		</SceneControls>
	);
}
