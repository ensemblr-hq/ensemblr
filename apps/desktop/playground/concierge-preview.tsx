import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr';
import { ConciergeHost } from '@/renderer/components/concierge';
import {
	SidebarInset,
	SidebarProvider,
} from '@/renderer/components/ui/sidebar';
import {
	CONCIERGE_ACTIVITY_NONE,
	type ConciergePresentation,
	conciergeActivityAtom,
	conciergePresentationAtom,
	conciergeStreamingAtom,
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
import {
	type ConciergeStageScreen,
	ConciergeToggleStage,
} from './concierge-toggle-stage.tsx';
import { createPlaygroundQueryClient } from './playground-query-client.ts';
import {
	ControlGroup,
	SceneControls,
	SceneLanguageControl,
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

/** The two places a screen puts the toggle, labelled by the screens that use each. */
const SCREENS: readonly { label: string; value: ConciergeStageScreen }[] = [
	{ label: 'workspace rail', value: 'workspace' },
	{ label: 'other screens', value: 'other' },
];

/** Unseen counts worth looking at: none, one, a few, and past the `9+` cap. */
const UNREAD_COUNTS: readonly number[] = [0, 1, 3, 12];

/**
 * The Concierge, driven for real: the shipped toggle row, host, panel, timeline,
 * and composer against a fixture bridge.
 *
 * It mounts `ConciergeHost` beside the toggle rather than `ConciergePanel` alone
 * because the host is what binds the toggle chord and hands focus in and out of
 * the panel, both of which the toggle relies on.
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
	const [presentation, setPresentation] = useAtom(conciergePresentationAtom);
	const setAppSettings = useSetAtom(appSettingsAtom);
	const setActivity = useSetAtom(conciergeActivityAtom);
	const setStreaming = useSetAtom(conciergeStreamingAtom);
	const [screen, setScreen] = useState<ConciergeStageScreen>('workspace');
	const [working, setWorking] = useState(false);
	const [unread, setUnread] = useState(0);
	const [transcript, setTranscript] =
		useState<ConciergeFixtureTranscript>('conversation');
	const [pressured, setPressured] = useState(false);
	const [dictating, setDictating] = useState(false);
	const [drawsOwnControls, setDrawsOwnControls] = useState(false);

	useSceneWindowChrome(drawsOwnControls);

	// Written only while the panel is shut: an open panel publishes its own
	// streaming state from the staged transcript, and this would overwrite it.
	useEffect(() => {
		if (presentation === 'closed') {
			setStreaming(working);
		}
	}, [presentation, setStreaming, working]);

	// The app clears the count when the panel opens; the scene mirrors that
	// without forgetting the count it was asked to stage.
	useEffect(() => {
		setActivity(
			presentation === 'closed' && unread > 0
				? { count: unread, hasQuestion: false, sessionId: CONCIERGE_SESSION_ID }
				: CONCIERGE_ACTIVITY_NONE,
		);
	}, [presentation, setActivity, unread]);

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
								onClick={() => setPresentation(value)}
							/>
						))}
					</ControlGroup>
					<ControlGroup label='toggle placement'>
						{SCREENS.map((option) => (
							<SceneToggle
								isActive={screen === option.value}
								key={option.value}
								label={option.label}
								onClick={() => setScreen(option.value)}
							/>
						))}
					</ControlGroup>
					<ControlGroup label='working (panel shut)'>
						<SceneOnOff isOn={working} onChange={setWorking} />
					</ControlGroup>
					<ControlGroup label='unread (panel shut)'>
						{UNREAD_COUNTS.map((count) => (
							<SceneToggle
								isActive={unread === count}
								key={count}
								label={String(count)}
								onClick={() => setUnread(count)}
							/>
						))}
					</ControlGroup>
					<SceneLanguageControl />
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
					press the toggle under the dock to open the panel; drag its header to
					move it, any edge or corner to resize it — pick the Claude Code model
					with dictation on for the widest control row
				</span>
			</SceneControls>

			<SidebarInset className='relative min-h-[46rem] overflow-hidden rounded-md border border-border bg-background'>
				<ConciergeToggleStage screen={screen}>
					<SceneSection
						label='the shell the Concierge floats over'
						note='a stand-in content area, so the maximized panel has the same inset to cover that the app gives it'
					>
						<p className='max-w-prose text-muted-foreground text-sm'>
							The toggle row is the shipped component, in the review rail under
							the terminal dock or along the foot of any other screen. So is
							everything it opens: the floating card, its header, the
							transcript, and the composer. Switch the presentation on the
							right, or use the toggle and the panel’s own controls.
						</p>
					</SceneSection>
				</ConciergeToggleStage>
				<ConciergeHost />
			</SidebarInset>
			<SceneWindowTitleBar isEnabled={drawsOwnControls} />
		</>
	);
}
