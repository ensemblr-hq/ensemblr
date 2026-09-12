import type { ReactNode } from 'react';

import { RunStoppedEmptyState } from '@/renderer/components/workbench-shell/dock-panel/run-stopped-empty-state';
import { ScriptEmptyState } from '@/renderer/components/workbench-shell/dock-panel/script-empty-state';
import { SetupMissingEmptyState } from '@/renderer/components/workbench-shell/dock-panel/setup-missing-empty-state';
import { SetupNotRunEmptyState } from '@/renderer/components/workbench-shell/dock-panel/setup-not-run-empty-state';

import { SceneSection } from './scene-chrome.tsx';

/**
 * Stands the state inside the rail it ships in: `bg-card` down the outside, a
 * header rule above it, and the dock's own default height. The point of the
 * scene is the seam between the two surfaces, which is invisible on a canvas
 * that paints neither.
 */
function DockFrame({ children, tab }: { children: ReactNode; tab: string }) {
	return (
		<div className='flex h-72 flex-col overflow-hidden rounded-lg border border-border bg-card'>
			<div className='flex h-9 shrink-0 items-center px-3 font-medium text-xs shadow-bottom-rule'>
				{tab}
			</div>
			<div className='min-h-0 flex-1'>{children}</div>
		</div>
	);
}

/**
 * Every empty state the Setup and Run dock tabs can show, on the surface they
 * show it on. They once stood on a surface that was dark in both window modes
 * while the terminal they stand in for takes its colours from `--sidebar`, so
 * in light mode the panel went black the moment a script was missing or
 * stopped. Flip the canvas theme to check both cuts.
 */
export function DockEmptyStatesScene() {
	return (
		<div className='flex flex-col gap-10'>
			<SceneSection
				label='Setup · no script configured'
				note='The repository has no setup script. Ask agent is the path the product leads with, so it takes the fill; Add manually is the escape hatch and is outlined, because a secondary fill is within 0.01 lightness of the panel behind it.'
			>
				<DockFrame tab='Setup'>
					<SetupMissingEmptyState
						onAddManually={() => undefined}
						onAskAgent={() => undefined}
					/>
				</DockFrame>
			</SceneSection>

			<SceneSection
				label='Setup · configured but not run'
				note='A setup script exists and has produced no output yet. Replaced by the live terminal the moment it starts.'
			>
				<DockFrame tab='Setup'>
					<SetupNotRunEmptyState onRunSetupScript={() => undefined} />
				</DockFrame>
			</SceneSection>

			<SceneSection
				label='Run · no script configured'
				note='The generic dock empty state, worded by the Run tab. The same component backs any future dock tab that has nothing to show.'
			>
				<DockFrame tab='Run'>
					<ScriptEmptyState
						actionLabel='Setup Scripts'
						detail='Add a run script for the normal dev server, watcher, worker, or local app command.'
						onAction={() => undefined}
						title='No run script configured'
					/>
				</DockFrame>
			</SceneSection>

			<SceneSection
				label='Run · configured but stopped'
				note='A run script exists and is not running. The ⌘R hint sits inside the button, so it has to read against the button fill rather than the panel.'
			>
				<DockFrame tab='Run'>
					<RunStoppedEmptyState
						activeRunScriptName='dev'
						onRunScript={() => undefined}
					/>
				</DockFrame>
			</SceneSection>
		</div>
	);
}
