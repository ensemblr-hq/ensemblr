import type {
	ComposerShellState,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { PiSessionTimeline } from './timeline/timeline';
import { WorkspaceLandingCard } from './workspace-landing-card';

/**
 * Scrollable timeline content shown above the composer.
 *
 * The chat tab renders ONLY chat: the workspace landing card (when a workspace
 * is fresh) and the structured Pi RPC event timeline. Setup / diagnostic /
 * readiness UI lives in the sidebar footer and the settings → diagnostics
 * screen — it never appears inside the conversation surface.
 */
export function WorkspaceTimeline({
	activeSession,
	composer,
	workspace,
}: {
	activeSession: SessionTabModel;
	composer: ComposerShellState;
	workspace: WorkspaceShellModel;
}) {
	return (
		<div className='mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5'>
			<WorkspaceLandingCard
				composer={composer}
				landingSummary={workspace.landingSummary}
				name={workspace.name}
				pathLabel={workspace.pathLabel}
			/>
			<PiSessionTimeline activeSession={activeSession} workspace={workspace} />
		</div>
	);
}
