import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { ChecksPanel } from '@/renderer/components/workbench-shell/checks-panel/checks-panel';
import { PanelAlert } from '@/renderer/components/workbench-shell/panel-alert';
import { ReviewActionsContextProvider } from '@/renderer/components/workbench-shell/review-actions/review-actions-context';
import {
	describeCommandFailure,
	describeMergeConflictProbeFailure,
} from '@/renderer/lib/workbench/git-failure-copy';

import {
	MERGE_PROBE_FAILURE,
	SYNC_FAILURES,
	unsyncedWorkspace,
} from './failure-banner-fixtures.ts';
import { createPlaygroundQueryClient } from './playground-query-client.ts';
import { IDLE_REVIEW_ACTIONS } from './review-actions-fixtures.ts';
import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/**
 * The failure banner every review panel shares, driven by real `GithubFailure`
 * payloads rather than hand-written copy — the translated headline, the demoted
 * command output, the dedupe that drops output only repeating the headline, and
 * the drop of a failure that wrote no stderr at all, all come from the shipped
 * `describeCommandFailure`.
 *
 * Both surfaces are shown at the review sidebar's real width, because the banner
 * reads very differently in a 24rem column than across a full canvas, and the
 * wrapping is the thing under review.
 */
export function FailureBannerScene() {
	const [client] = useState(createPlaygroundQueryClient);
	const [label, setLabel] = useState(SYNC_FAILURES[0].label);

	const failure = useMemo(
		() =>
			(SYNC_FAILURES.find((entry) => entry.label === label) ?? SYNC_FAILURES[0])
				.failure,
		[label],
	);
	const syncError = useMemo(() => describeCommandFailure(failure), [failure]);
	const workspace = useMemo(() => unsyncedWorkspace(syncError), [syncError]);

	return (
		<QueryClientProvider client={client}>
			<ReviewActionsContextProvider value={IDLE_REVIEW_ACTIONS}>
				<div className='flex flex-col gap-8'>
					<FailureControls onSelect={setLabel} selected={label} />

					<SceneSection
						label='Sync error banner'
						note='The headline names the surface, the sentence explains the failure in the reader’s language, and gh’s own words sit underneath — dropped when they only repeat the sentence (“output repeats copy”) and when gh wrote none at all (“no stderr”), so main’s untranslated fallback prose never reads as gh output.'
					>
						<div className='max-w-96 rounded-md border border-border p-3'>
							<PanelAlert
								{...syncError}
								title='Could not refresh from GitHub'
							/>
						</div>
					</SceneSection>

					<SceneSection
						label='Checks panel'
						note='Where it actually lands: above content that still works, so the panel stays usable while the refresh is broken.'
					>
						<div className='h-96 max-w-96 overflow-hidden rounded-md border border-border'>
							<ChecksPanel workspace={workspace} />
						</div>
					</SceneSection>

					<SceneSection
						label='Merge probe failure'
						note='The same banner from the Conflicts section, where git’s multi-line stderr is what the output block has to hold.'
					>
						<div className='max-w-96 rounded-md border border-border p-3'>
							<PanelAlert
								{...describeMergeConflictProbeFailure(MERGE_PROBE_FAILURE)}
							/>
						</div>
					</SceneSection>
				</div>
			</ReviewActionsContextProvider>
		</QueryClientProvider>
	);
}

/** Picks which gh failure the scene's two sync surfaces are showing. */
function FailureControls({
	onSelect,
	selected,
}: {
	onSelect: (label: string) => void;
	selected: string;
}) {
	return (
		<SceneControls>
			<ControlGroup label='gh failure'>
				{SYNC_FAILURES.map((entry) => (
					<SceneToggle
						isActive={entry.label === selected}
						key={entry.label}
						label={entry.label}
						onClick={() => onSelect(entry.label)}
					/>
				))}
			</ControlGroup>
		</SceneControls>
	);
}
