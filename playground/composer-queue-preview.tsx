import { QueryClientProvider } from '@tanstack/react-query';
import { useStore } from 'jotai';
import { useCallback, useState } from 'react';

import { ComposerPanel } from '@/renderer/components/workbench-shell/conversation-panel';
import { FollowUpQueueList } from '@/renderer/components/workbench-shell/conversation-panel/composer/follow-up-queue-list';
import {
	followUpQueueAtomFamily,
	followUpQueueHoldReasonAtomFamily,
	moveFollowUp,
	removeFollowUp,
	reorderFollowUps,
} from '@/renderer/state/composer';
import {
	type FollowUpBehavior,
	followUpBehaviorAtom,
} from '@/renderer/state/preferences';
import type {
	ComposerDraftSegment,
	FollowUpQueueHoldReason,
	QueuedFollowUp,
} from '@/renderer/types/workbench';

import { useComposerStub } from './composer-fixtures.ts';
import { createPlaygroundQueryClient } from './playground-query-client.ts';
import {
	ControlGroup,
	SceneControls,
	SceneOnOff,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

const BEHAVIORS: readonly FollowUpBehavior[] = ['steer', 'queue', 'block'];

const SHORT_MESSAGES: readonly string[] = [
	'Also rename the helper to `resolveSendIntent`.',
	'Add a test for the empty case.',
	'Then run the linter and push.',
	'Check the Greek plural forms too.',
	'Squash the two commits before opening the PR.',
	'Double-check the popover closes on remove.',
	'Roll the version to 0.1.1.',
	'Update the glossary row for “queue”.',
];

/**
 * A message written around its chips rather than beside them, which is the case
 * the row's flat draft text cannot carry: every chip flattens to one space, so a
 * preview built from that text reads as a sentence with holes in it.
 */
const MENTION_MESSAGE: readonly ComposerDraftSegment[] = [
	{ kind: 'text', text: 'Check that ' },
	{
		attachment: {
			id: 'playground-attachment-queue',
			kind: 'workspace-file',
			label: 'follow-up-queue.ts',
			path: 'src/renderer/state/composer/follow-up-queue.ts',
		},
		kind: 'attachment',
	},
	{ kind: 'text', text: ' still drains once you have renamed ' },
	{
		attachment: {
			id: 'playground-attachment-list',
			kind: 'workspace-file',
			label: 'follow-up-queue-list.tsx',
			path: 'src/renderer/components/workbench-shell/conversation-panel/composer/follow-up-queue-list.tsx',
		},
		kind: 'attachment',
	},
	{ kind: 'text', text: '.' },
];

/**
 * The flat draft text Lexical would have produced for a set of runs, each chip
 * standing in as the single space that keeps caret offsets addressable.
 * @param segments - The draft's runs and chips, in document order
 * @returns The text the queue entry carries alongside its segments
 */
function flattenDraft(segments: readonly ComposerDraftSegment[]): string {
	return segments
		.map((segment) => (segment.kind === 'text' ? segment.text : ' '))
		.join('');
}

const LONG_MESSAGE =
	'When you get to the flush hook, remember the composer is not permanently mounted — the ask_user_question card replaces it and a tab switch unmounts it — so a turn can end with nothing there to notice. Read the standing state rather than the transition, and add the regression test alongside it.';

/**
 * The chip-carrying message at the length the scene is showing, so the two-line
 * clamp can be read against a row holding chips rather than only against prose.
 * @param shape - Whether the scene's entries read short or long enough to clamp
 * @returns The runs and chips to queue
 */
function mentionMessage(
	shape: 'long' | 'short',
): readonly ComposerDraftSegment[] {
	return shape === 'short'
		? MENTION_MESSAGE
		: [...MENTION_MESSAGE, { kind: 'text', text: ` ${LONG_MESSAGE}` }];
}

/**
 * Builds a queue of the requested depth. The second entry is written around two
 * chips rather than beside them, so the row's inline rendering and the
 * edit-restores-chips path are both visible, and the third is a chore so its
 * muted styling can be compared against a user message queued right beside it.
 * @param count - How many entries to build
 * @param shape - Whether entries read short or long enough to clamp
 * @returns The entries to seed the queue atom with
 */
function buildQueueEntries(
	count: number,
	shape: 'long' | 'short',
): readonly QueuedFollowUp[] {
	return Array.from({ length: count }, (_unused, index) => {
		const text =
			shape === 'long'
				? LONG_MESSAGE
				: SHORT_MESSAGES[index % SHORT_MESSAGES.length];
		const segments: readonly ComposerDraftSegment[] =
			index === 1 ? mentionMessage(shape) : [{ kind: 'text', text }];
		return {
			id: `playground-queued-${index}`,
			queuedAt: `2026-08-11T20:0${index % 10}:00.000Z`,
			segments,
			snapshot: null,
			source: index === 2 ? ('chore' as const) : ('user' as const),
			text: flattenDraft(segments),
		};
	});
}

/**
 * The composer's follow-up queue: the stack pinned above the composer, the
 * status line that says whether it moves on its own, and the surfaces that say
 * what a mid-turn send will do.
 *
 * Driven through the shipped `ComposerPanel` rather than the stack alone,
 * because the stack only means anything sitting on the composer it feeds — and
 * because the block status has to be read against the placeholder and notices
 * strip it has to agree with.
 */
export function ComposerQueueScene() {
	const [client] = useState(createPlaygroundQueryClient);
	const store = useStore();
	const [behavior, setBehaviorState] = useState<FollowUpBehavior>('queue');
	const [isStreaming, setStreaming] = useState(true);
	const [disabled, setDisabled] = useState(false);
	const [depth, setDepthState] = useState(3);
	const [shape, setShapeState] = useState<'long' | 'short'>('short');
	const [pauseReason, setPauseReasonState] =
		useState<FollowUpQueueHoldReason | null>(null);
	const [lastAction, setLastAction] = useState<string | null>(null);

	const chatTabId = 'playground-composer-queue-live';

	const seed = useCallback(
		(count: number, entryShape: 'long' | 'short') => {
			store.set(
				followUpQueueAtomFamily(chatTabId),
				buildQueueEntries(count, entryShape),
			);
		},
		[store],
	);

	useState(() => {
		seed(depth, shape);
		store.set(followUpBehaviorAtom, behavior);
	});

	const setBehavior = useCallback(
		(next: FollowUpBehavior) => {
			setBehaviorState(next);
			store.set(followUpBehaviorAtom, next);
			setLastAction(`behavior → ${next}`);
		},
		[store],
	);

	const setDepth = useCallback(
		(next: number) => {
			setDepthState(next);
			seed(next, shape);
			setLastAction(`queue depth → ${next}`);
		},
		[seed, shape],
	);

	const setShape = useCallback(
		(next: 'long' | 'short') => {
			setShapeState(next);
			seed(depth, next);
			setLastAction(`entry shape → ${next}`);
		},
		[depth, seed],
	);

	const setPauseReason = useCallback(
		(next: FollowUpQueueHoldReason | null) => {
			setPauseReasonState(next);
			store.set(followUpQueueHoldReasonAtomFamily(chatTabId), next);
			setLastAction(next ? `queue paused — ${next}` : 'queue resumed');
		},
		[store],
	);

	const composer = useComposerStub({
		disabled,
		isStreaming,
		lockedProvider: null,
		planMode: false,
	});

	return (
		<QueryClientProvider client={client}>
			<div className='flex flex-col gap-8'>
				<SceneControls>
					<div className='flex flex-col gap-3'>
						<ControlGroup label='follow-up behavior'>
							{BEHAVIORS.map((option) => (
								<SceneToggle
									isActive={behavior === option}
									key={option}
									label={option}
									onClick={() => setBehavior(option)}
								/>
							))}
						</ControlGroup>
						<ControlGroup label='streaming'>
							<SceneOnOff isOn={isStreaming} onChange={setStreaming} />
						</ControlGroup>
						<ControlGroup label='queue depth'>
							{[0, 1, 3, 8].map((count) => (
								<SceneToggle
									isActive={depth === count}
									key={count}
									label={String(count)}
									onClick={() => setDepth(count)}
								/>
							))}
						</ControlGroup>
						<ControlGroup label='entry shape'>
							<SceneToggle
								isActive={shape === 'short'}
								label='short'
								onClick={() => setShape('short')}
							/>
							<SceneToggle
								isActive={shape === 'long'}
								label='long'
								onClick={() => setShape('long')}
							/>
						</ControlGroup>
						<ControlGroup label='queue paused'>
							<SceneToggle
								isActive={pauseReason === null}
								label='no'
								onClick={() => setPauseReason(null)}
							/>
							<SceneToggle
								isActive={pauseReason === 'turn-stopped'}
								label='turn stopped'
								onClick={() => setPauseReason('turn-stopped')}
							/>
							<SceneToggle
								isActive={pauseReason === 'send-failed'}
								label='send failed'
								onClick={() => setPauseReason('send-failed')}
							/>
						</ControlGroup>
						<ControlGroup label='composer disabled'>
							<SceneOnOff isOn={disabled} onChange={setDisabled} />
						</ControlGroup>
					</div>
					<span className='break-all font-mono text-muted-foreground text-xxs'>
						{lastAction ?? 'no action yet'}
					</span>
				</SceneControls>

				<SceneSection
					label='live composer — the queue stack, block status, send tooltip'
					note='type and send while streaming: steer goes to the runtime, queue and block land in the stack above the composer'
				>
					<div className='overflow-hidden rounded-md border border-border'>
						<ComposerPanel
							chatTabId={chatTabId}
							composer={composer}
							repositoryId='playground-repository'
							workspaceId='playground-workspace'
						/>
					</div>
				</SceneSection>

				<SceneSection
					label='the queue list on its own'
					note='the rows without the stack chrome around them, at depths the live composer is awkward to hold'
				>
					<QueueListCase
						caption='3 queued — row 1 is next, row 2 carries a chip, row 3 is a Checks chore'
						count={3}
					/>
					<QueueListCase
						caption='1 queued — both chevrons disabled'
						count={1}
					/>
					<QueueListCase
						caption='8 queued — scrolls at the clamped height'
						count={8}
					/>
					<QueueListCase
						caption='edit disabled — the composer already holds a draft'
						count={2}
						editable={false}
					/>
					<QueueListCase
						caption='idle — the out-of-turn send is a plain send, not a steer'
						count={2}
						streaming={false}
					/>
				</SceneSection>
			</div>
		</QueryClientProvider>
	);
}

/** One captioned queue list at a fixed depth, with inert row actions. */
function QueueListCase({
	caption,
	count,
	editable = true,
	streaming = true,
}: {
	caption: string;
	count: number;
	editable?: boolean;
	streaming?: boolean;
}) {
	const [entries, setEntries] = useState(() =>
		buildQueueEntries(count, 'short'),
	);

	return (
		<div className='flex flex-col gap-1.5'>
			<span className='font-mono text-muted-foreground text-xxs'>
				{caption}
			</span>
			<div className='flex w-full max-w-2xl flex-col gap-1 rounded-xl border border-border bg-pane/60 p-1.5'>
				<FollowUpQueueList
					entries={entries}
					onEdit={
						editable
							? (id) => setEntries((current) => removeFollowUp(current, id))
							: null
					}
					onMove={(id, direction) =>
						setEntries((current) => moveFollowUp(current, id, direction))
					}
					onRemove={(id) =>
						setEntries((current) => removeFollowUp(current, id))
					}
					onReorder={(orderedIds) =>
						setEntries((current) => reorderFollowUps(current, orderedIds))
					}
					onSteer={(id) => setEntries((current) => removeFollowUp(current, id))}
					streaming={streaming}
				/>
			</div>
		</div>
	);
}
