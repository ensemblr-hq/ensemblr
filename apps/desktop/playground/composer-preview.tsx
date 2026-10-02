import { QueryClientProvider } from '@tanstack/react-query';
import { useStore } from 'jotai';
import { useCallback, useState } from 'react';

import { ComposerPanel } from '@/renderer/components/workbench-shell/conversation-panel';
import { PlanReviewPanel } from '@/renderer/components/workbench-shell/conversation-panel/plan-review-panel';
import { chatLinkedDirectoriesAtomFamily } from '@/renderer/state/preferences';
import type { LinkedDirectory } from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

import { useComposerStub } from './composer-fixtures.ts';
import { createPlaygroundQueryClient } from './playground-query-client.ts';
import {
	ControlGroup,
	SceneControls,
	SceneOnOff,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/** Prompt `usePlanReview` submits on approval, mirrored so the scene reports it. */
const APPROVAL_PROMPT = 'Approved — implement the plan.';

/**
 * The composer, and the exit-plan-mode bar that rides as its header when an
 * agent finishes a plan. The bar is the composer's top edge rather than a
 * floating panel, so it can only be judged with the composer under it — hence a
 * scene that drives the shipped `ComposerPanel` instead of the bar alone.
 *
 * The decision handlers repeat what `usePlanReview` does on each answer, so
 * clicking through the bar here shows the same transition the app makes:
 * approve leaves plan mode and sends the implementation prompt, refine hands the
 * composer back with plan mode still on, hand off leaves plan mode too.
 */
export function ComposerScene() {
	const [client] = useState(createPlaygroundQueryClient);
	const [hasPlanReview, setPlanReview] = useState(true);
	const [planMode, setPlanMode] = useState(true);
	const [isHandingOff, setHandingOff] = useState(false);
	const [isStreaming, setStreaming] = useState(false);
	const [lastDecision, setLastDecision] = useState<string | null>(null);
	const [lockedProvider, setLockedProvider] = useState<AgentProviderId | null>(
		null,
	);

	const approve = useCallback(() => {
		setPlanMode(false);
		setPlanReview(false);
		setLastDecision(`approve → submitted "${APPROVAL_PROMPT}"`);
	}, []);
	const refine = useCallback(() => {
		setPlanReview(false);
		setLastDecision('refine → composer focused, plan mode still on');
	}, []);
	const handOff = useCallback(() => {
		setPlanMode(false);
		setPlanReview(false);
		setLastDecision('hand off → plan moved to a fresh chat');
	}, []);

	return (
		<QueryClientProvider client={client}>
			<div className='flex flex-col gap-8'>
				<ComposerControls
					hasPlanReview={hasPlanReview}
					isHandingOff={isHandingOff}
					isStreaming={isStreaming}
					lastDecision={lastDecision}
					lockedProvider={lockedProvider}
					onHandingOffChange={setHandingOff}
					onLockedProviderChange={setLockedProvider}
					onPlanModeChange={setPlanMode}
					onPlanReviewChange={(enabled) => {
						setPlanReview(enabled);
						setLastDecision(null);
					}}
					onStreamingChange={setStreaming}
					planMode={planMode}
				/>

				<SceneSection
					label='live composer — ComposerPanel + PlanReviewPanel'
					note='the bar answers for real: each decision runs the transition usePlanReview makes'
				>
					<ComposerCase
						chatTabId='playground-composer-live'
						isStreaming={isStreaming}
						lockedProvider={lockedProvider}
						onPlanModeChange={setPlanMode}
						planMode={planMode}
						planReview={
							hasPlanReview ? (
								<PlanReviewPanel
									busy={isHandingOff}
									onApprove={approve}
									onHandoff={handOff}
									onRefine={refine}
								/>
							) : null
						}
					/>
				</SceneSection>

				<SceneSection
					label='the three shapes side by side'
					note='what the card looks like plain, planning, and holding a finished plan'
				>
					<ComposerCase
						chatTabId='playground-composer-plain'
						label='plain composer'
						planMode={false}
					/>
					<ComposerCase
						chatTabId='playground-composer-planning'
						label='plan mode on — dashed border, no plan yet'
						planMode
					/>
					<ComposerCase
						chatTabId='playground-composer-review'
						label='plan finished — decision bar as the card header'
						planMode
						planReview={
							<PlanReviewPanel
								onApprove={() => undefined}
								onHandoff={() => undefined}
								onRefine={() => undefined}
							/>
						}
					/>
					<ComposerCase
						chatTabId='playground-composer-linked-directory'
						label='linked directory — chip carries the absolute path it granted'
						linkedDirectories={[
							{
								name: 'Vault 111',
								path: '/Users/you/Documents/Obsidian/Vault 111',
							},
						]}
						planMode={false}
					/>
					<ComposerCase
						chatTabId='playground-composer-handing-off'
						label='hand off in flight — every action locked'
						planMode
						planReview={
							<PlanReviewPanel
								busy
								onApprove={() => undefined}
								onHandoff={() => undefined}
								onRefine={() => undefined}
							/>
						}
					/>
				</SceneSection>
			</div>
		</QueryClientProvider>
	);
}

/** One composer card, optionally captioned and optionally carrying a plan bar. */
function ComposerCase({
	chatTabId,
	isStreaming = false,
	label,
	linkedDirectories,
	lockedProvider = null,
	onPlanModeChange,
	planMode,
	planReview,
}: {
	chatTabId: string;
	isStreaming?: boolean;
	label?: string;
	/** Seeds the chat's linked-directory set so the sticky chip has something to render. */
	linkedDirectories?: readonly LinkedDirectory[];
	lockedProvider?: AgentProviderId | null;
	onPlanModeChange?: (planMode: boolean) => void;
	planMode: boolean;
	planReview?: React.ReactNode;
}) {
	const store = useStore();
	useState(() => {
		if (linkedDirectories) {
			store.set(chatLinkedDirectoriesAtomFamily(chatTabId), linkedDirectories);
		}
	});
	const composer = useComposerStub({
		isStreaming,
		lockedProvider,
		onPlanModeChange,
		planMode,
	});

	return (
		<div className='flex flex-col gap-1.5'>
			{label ? (
				<span className='font-mono text-muted-foreground text-xxs'>
					{label}
				</span>
			) : null}
			<div className='overflow-hidden rounded-md border border-border'>
				<ComposerPanel
					chatTabId={chatTabId}
					composer={composer}
					planReview={planReview}
					repositoryId='playground-repository'
					workspaceId='playground-workspace'
				/>
			</div>
		</div>
	);
}

/** Toggles for the inputs the live composer cannot derive on its own. */
function ComposerControls({
	hasPlanReview,
	isHandingOff,
	isStreaming,
	lastDecision,
	lockedProvider,
	onHandingOffChange,
	onLockedProviderChange,
	onPlanModeChange,
	onPlanReviewChange,
	onStreamingChange,
	planMode,
}: {
	hasPlanReview: boolean;
	isHandingOff: boolean;
	isStreaming: boolean;
	lastDecision: string | null;
	lockedProvider: AgentProviderId | null;
	onHandingOffChange: (enabled: boolean) => void;
	onLockedProviderChange: (provider: AgentProviderId | null) => void;
	onPlanModeChange: (enabled: boolean) => void;
	onPlanReviewChange: (enabled: boolean) => void;
	onStreamingChange: (enabled: boolean) => void;
	planMode: boolean;
}) {
	return (
		<SceneControls>
			<div className='flex flex-col gap-3'>
				<ControlGroup label='plan review pending'>
					<SceneOnOff isOn={hasPlanReview} onChange={onPlanReviewChange} />
				</ControlGroup>
				<ControlGroup label='plan mode'>
					<SceneOnOff isOn={planMode} onChange={onPlanModeChange} />
				</ControlGroup>
				<ControlGroup label='handing off'>
					<SceneOnOff isOn={isHandingOff} onChange={onHandingOffChange} />
				</ControlGroup>
				<ControlGroup label='streaming'>
					<SceneOnOff isOn={isStreaming} onChange={onStreamingChange} />
				</ControlGroup>
				<ControlGroup label='provider pin'>
					<SceneToggle
						isActive={lockedProvider === null}
						label='new chat'
						onClick={() => onLockedProviderChange(null)}
					/>
					<SceneToggle
						isActive={lockedProvider === 'pi'}
						label='pi'
						onClick={() => onLockedProviderChange('pi')}
					/>
					<SceneToggle
						isActive={lockedProvider === 'claude'}
						label='claude'
						onClick={() => onLockedProviderChange('claude')}
					/>
				</ControlGroup>
			</div>
			<span className='break-all font-mono text-muted-foreground text-xxs'>
				{lastDecision ?? 'no decision yet'}
			</span>
		</SceneControls>
	);
}
