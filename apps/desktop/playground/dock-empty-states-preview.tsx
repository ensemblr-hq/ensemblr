import { HourglassIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { RunStoppedEmptyState } from '@/renderer/components/workbench-shell/dock-panel/run-stopped-empty-state';
import { ScriptEmptyState } from '@/renderer/components/workbench-shell/dock-panel/script-empty-state';
import { ScriptQueuedEmptyState } from '@/renderer/components/workbench-shell/dock-panel/script-queued-empty-state';
import { SetupMissingEmptyState } from '@/renderer/components/workbench-shell/dock-panel/setup-missing-empty-state';
import { SetupNotRunEmptyState } from '@/renderer/components/workbench-shell/dock-panel/setup-not-run-empty-state';
import type { WorkspaceScriptQueuedJob } from '@/renderer/types/workbench';

import { SceneSection } from './scene-chrome.tsx';

/** Milliseconds per second, so the fixtures' wait times read as seconds. */
const SECOND_MS = 1000;

/**
 * Builds a queued launch that entered the queue the given number of seconds
 * before the scene mounted, so its wait time ticks from a believable start.
 * @param seconds - How long ago it was queued
 * @param overrides - Fields this section needs to differ on
 * @returns A queued launch the panel can render
 */
function queuedJob(
	seconds: number,
	overrides: Partial<WorkspaceScriptQueuedJob> = {},
): WorkspaceScriptQueuedJob {
	return {
		enqueuedAt: Date.now() - seconds * SECOND_MS,
		id: 'job-playground',
		initiator: 'auto',
		kind: 'setup',
		position: 3,
		scriptName: null,
		...overrides,
	};
}

/**
 * Stands the state inside the rail it ships in: `bg-card` down the outside, a
 * header rule above it, and the dock's own default height. The point of the
 * scene is the seam between the two surfaces, which is invisible on a canvas
 * that paints neither. A queued tab wears the hourglass the real tab strip
 * gives it, so the tab and the pane can be judged together.
 */
function DockFrame({
	children,
	queued = false,
	tab,
}: {
	children: ReactNode;
	queued?: boolean;
	tab: string;
}) {
	return (
		<div className='flex h-72 flex-col overflow-hidden rounded-lg border border-border bg-card'>
			<div className='flex h-9 shrink-0 items-center gap-1.5 px-3 font-medium text-xs shadow-bottom-rule'>
				{queued ? (
					<HourglassIcon aria-hidden='true' className='size-3.5' />
				) : null}
				{tab}
			</div>
			<div className='min-h-0 flex-1'>{children}</div>
		</div>
	);
}

/**
 * The queued panel with its two actions live: Start now and Cancel both settle
 * the launch, so the frame falls back to the state the dock would show next —
 * the not-run caption — and offers to queue it again.
 */
function InteractiveQueuedSetup() {
	const [job, setJob] = useState<WorkspaceScriptQueuedJob | null>(() =>
		queuedJob(42, { position: 2 }),
	);

	return (
		<DockFrame queued={job !== null} tab='Setup'>
			{job ? (
				<ScriptQueuedEmptyState
					job={job}
					onCancel={() => setJob(null)}
					onStartNow={() => setJob(null)}
				/>
			) : (
				<SetupNotRunEmptyState
					onRunSetupScript={() => setJob(queuedJob(0, { position: 2 }))}
				/>
			)}
		</DockFrame>
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
				label='Setup · queued behind other work'
				note='Ensemblr queued setup on workspace creation and every compute slot is taken. Before this state the tab read "No setup script output", which said nothing about a script that was coming. The tab wears the queue’s hourglass; the place in line and the wait time update live; Start now launches it as the user’s own, which skips the queue, and Cancel gives up its place.'
			>
				<DockFrame queued tab='Setup'>
					<ScriptQueuedEmptyState
						job={queuedJob(95)}
						onCancel={() => undefined}
						onStartNow={() => undefined}
					/>
				</DockFrame>
			</SceneSection>

			<SceneSection
				label='Setup · next in line, queued by an agent'
				note='Position 1 reads as "Next in line" rather than "#1 in queue". An agent that starts setup waits like the app does; only a click starts at once.'
			>
				<DockFrame queued tab='Setup'>
					<ScriptQueuedEmptyState
						job={queuedJob(8, { initiator: 'agent', position: 1 })}
						onCancel={() => undefined}
						onStartNow={() => undefined}
					/>
				</DockFrame>
			</SceneSection>

			<SceneSection
				label='Setup · queued, try the actions'
				note='Start now and Cancel both settle the launch here, falling back to the not-run state; Run setup queues it again so the round trip can be repeated.'
			>
				<InteractiveQueuedSetup />
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

			<SceneSection
				label='Run · heavy run script queued by an agent'
				note='A run script whose command classifies heavy (a test suite, a build) waits for a slot when an agent starts it. The panel names the script, so a queued "test" is not mistaken for the dev server.'
			>
				<DockFrame queued tab='Run'>
					<ScriptQueuedEmptyState
						job={queuedJob(20, {
							initiator: 'agent',
							kind: 'run',
							position: 4,
							scriptName: 'test',
						})}
						onCancel={() => undefined}
						onStartNow={() => undefined}
					/>
				</DockFrame>
			</SceneSection>
		</div>
	);
}
