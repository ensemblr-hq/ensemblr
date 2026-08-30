import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr';
import { ConciergeLauncher } from '@/renderer/components/concierge';
import {
	SidebarInset,
	SidebarProvider,
} from '@/renderer/components/ui/sidebar';
import {
	type ConciergePresentation,
	conciergePresentationAtom,
} from '@/renderer/state/concierge';
import { appSettingsAtom } from '@/renderer/state/preferences';

import {
	CONCIERGE_SESSION_ID,
	type ConciergeFixtureTranscript,
	resolveFixtureAppSettings,
	setConciergeFixtureDictation,
	setConciergeFixturePressure,
	setConciergeFixtureTranscript,
} from './concierge-fixtures.ts';
import { createPlaygroundQueryClient } from './playground-query-client.ts';
import {
	ControlGroup,
	SceneControls,
	SceneOnOff,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';
import {
	SceneWindowTitleBar,
	useSceneWindowChrome,
} from './scene-window-chrome.tsx';

/** The three presentations, in the order the panel's own controls cycle them. */
const PRESENTATIONS: readonly ConciergePresentation[] = [
	'closed',
	'panel',
	'fullscreen',
];

/** The staged transcripts, labelled by what each one is for. */
const TRANSCRIPTS: readonly {
	label: string;
	value: ConciergeFixtureTranscript;
}[] = [
	{ label: 'conversation', value: 'conversation' },
	{ label: 'empty', value: 'empty' },
	{ label: 'streaming', value: 'streaming' },
];

/**
 * The Concierge, driven for real: the shipped launcher, panel, timeline, and
 * composer against a fixture bridge.
 *
 * It mounts `ConciergeLauncher` rather than `ConciergePanel` because the two are
 * one surface — the bubble and the panel hang from the same persisted corner,
 * and dragging either is what the placement code exists to do. A scene that
 * mounted the panel alone could not show that the bubble comes back where the
 * panel was left.
 *
 * The stand-in `SidebarInset` is what the maximized panel measures itself
 * against: it covers the shell's content area rather than the viewport, so
 * without an inset in the tree there is nothing to cover and the maximized state
 * would render at a size the app never shows.
 */
export function ConciergeScene() {
	const [client] = useState(createPlaygroundQueryClient);

	return (
		<QueryClientProvider client={client}>
			<SidebarProvider defaultOpen={false}>
				<ConciergeStage />
			</SidebarProvider>
		</QueryClientProvider>
	);
}

/** The canvas the Concierge floats over, plus the scene's own toggles. */
function ConciergeStage() {
	const queryClient = useQueryClient();
	const setPresentation = useSetAtom(conciergePresentationAtom);
	const setAppSettings = useSetAtom(appSettingsAtom);
	const [presentation, setLocalPresentation] =
		useState<ConciergePresentation>('panel');
	const [transcript, setTranscript] =
		useState<ConciergeFixtureTranscript>('conversation');
	const [pressured, setPressured] = useState(false);
	const [dictating, setDictating] = useState(false);
	const [drawsOwnControls, setDrawsOwnControls] = useState(false);

	useSceneWindowChrome(drawsOwnControls);

	useEffect(() => {
		setPresentation(presentation);
	}, [presentation, setPresentation]);

	// Reset rather than invalidate: the shipped transcript query merges what it
	// fetches with whatever the broadcast wrote into the same key, so an
	// invalidation can only ever add rows — a scene that switched to the empty
	// transcript would keep showing the conversation it was staged from.
	const restageTranscript = useCallback(() => {
		void queryClient.resetQueries({
			queryKey: ensemblrQueryKeys.conciergeEvents(CONCIERGE_SESSION_ID),
		});
	}, [queryClient]);

	const chooseTranscript = useCallback(
		(next: ConciergeFixtureTranscript) => {
			setConciergeFixtureTranscript(next);
			setTranscript(next);
			restageTranscript();
		},
		[restageTranscript],
	);

	const choosePressure = useCallback(
		(next: boolean) => {
			setConciergeFixturePressure(next);
			setPressured(next);
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.conciergeContextPressure(),
			});
		},
		[queryClient],
	);

	// The settings mirror is hydrated by `useAppSettingsSync`, which belongs to
	// the app shell rather than to a scene — so the scene writes the atom the way
	// that hook would have, and invalidates the key probe the mic is also gated on.
	const chooseDictation = useCallback(
		(next: boolean) => {
			setConciergeFixtureDictation(next);
			setDictating(next);
			setAppSettings(resolveFixtureAppSettings());
			void queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.dictationKeyStatus(),
			});
		},
		[queryClient, setAppSettings],
	);

	return (
		<>
			<SceneControls>
				<div className='flex flex-col gap-3'>
					<ControlGroup label='presentation'>
						{PRESENTATIONS.map((value) => (
							<SceneToggle
								isActive={presentation === value}
								key={value}
								label={value}
								onClick={() => setLocalPresentation(value)}
							/>
						))}
					</ControlGroup>
					<ControlGroup label='transcript'>
						{TRANSCRIPTS.map((option) => (
							<SceneToggle
								isActive={transcript === option.value}
								key={option.value}
								label={option.label}
								onClick={() => chooseTranscript(option.value)}
							/>
						))}
					</ControlGroup>
					<ControlGroup label='context over threshold'>
						<SceneOnOff isOn={pressured} onChange={choosePressure} />
					</ControlGroup>
					<ControlGroup label='dictation configured'>
						<SceneOnOff isOn={dictating} onChange={chooseDictation} />
					</ControlGroup>
					<ControlGroup label='Linux window controls'>
						<SceneOnOff
							isOn={drawsOwnControls}
							onChange={setDrawsOwnControls}
						/>
					</ControlGroup>
				</div>
				<span className='font-mono text-muted-foreground text-xxs'>
					drag the header to move it, any edge or corner to resize it — pick the
					Claude Code model with dictation on for the widest control row
				</span>
			</SceneControls>

			<SidebarInset className='relative min-h-[46rem] overflow-hidden rounded-md border border-border bg-background'>
				<SceneSection
					label='the shell the Concierge floats over'
					note='a stand-in content area, so the maximized panel has the same inset to cover that the app gives it'
				>
					<p className='max-w-prose text-muted-foreground text-sm'>
						Every surface below the bubble is the shipped component: the docked
						card, its header, the transcript, and the composer. Switch the
						presentation on the right, or use the panel’s own maximize and close
						controls.
					</p>
				</SceneSection>
				<ConciergeLauncher />
			</SidebarInset>
			<SceneWindowTitleBar isEnabled={drawsOwnControls} />
		</>
	);
}
