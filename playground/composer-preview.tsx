import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { ComposerPanel } from '@/renderer/components/workbench-shell/conversation-panel';
import { PlanReviewPanel } from '@/renderer/components/workbench-shell/conversation-panel/plan-review-panel';
import type {
	ComposerModelOption,
	ComposerShellState,
	ComposerThinkingOption,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

import { createPlaygroundQueryClient } from './playground-query-client.ts';
import { ControlGroup, SceneSection, SceneToggle } from './scene-chrome.tsx';

const WORKSPACE_CWD = '/Users/you/Projects/ensemblr';

/**
 * Two runtimes' models in one catalog, so the picker's provider pin has
 * something to lock out. `provider` is the inference provider the picker groups
 * by; `agentProvider` is the runtime the pin compares against.
 */
const MODELS: readonly ComposerModelOption[] = [
	{
		agentProvider: 'pi',
		displayName: 'Opus 5',
		id: 'claude-opus-5',
		isDefault: true,
		provider: 'anthropic',
	},
	{
		agentProvider: 'pi',
		displayName: 'Sonnet 5',
		id: 'claude-sonnet-5',
		provider: 'anthropic',
	},
	{
		agentProvider: 'claude',
		displayName: 'Claude Code — Opus 5',
		id: 'claude-code/opus-5',
		provider: 'claude-code',
	},
	{
		agentProvider: 'claude',
		displayName: 'Claude Code — Sonnet 5',
		id: 'claude-code/sonnet-5',
		provider: 'claude-code',
	},
];

const THINKING_LEVELS: readonly ComposerThinkingOption[] = [
	{ id: 'off', label: 'Off' },
	{ id: 'think', label: 'Think' },
	{ id: 'ultrathink', label: 'Ultrathink' },
];

/**
 * Enough of a file tree for the `@` mention picker to have something to match,
 * without pulling the app's own fixture list into a scene that only needs the
 * popover to open.
 */
const WORKSPACE_FILES: readonly WorkspaceFileSummary[] = [
	{ id: 'dir-src', kind: 'directory', name: 'src', path: 'src' },
	{
		id: 'file-composer-panel',
		kind: 'file',
		name: 'composer-panel.tsx',
		path: 'src/renderer/components/workbench-shell/conversation-panel/composer-panel.tsx',
	},
	{
		id: 'file-plan-review-panel',
		kind: 'file',
		name: 'plan-review-panel.tsx',
		path: 'src/renderer/components/workbench-shell/conversation-panel/plan-review-panel.tsx',
	},
	{ id: 'file-readme', kind: 'file', name: 'README.md', path: 'README.md' },
];

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
				<SceneControls
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
	lockedProvider = null,
	onPlanModeChange,
	planMode,
	planReview,
}: {
	chatTabId: string;
	isStreaming?: boolean;
	label?: string;
	lockedProvider?: AgentProviderId | null;
	onPlanModeChange?: (planMode: boolean) => void;
	planMode: boolean;
	planReview?: React.ReactNode;
}) {
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
					workspaceId='playground-workspace'
				/>
			</div>
		</div>
	);
}

/**
 * Builds the `ComposerShellState` the panel reads. Every callback is inert
 * except plan mode, which the scene owns so the chip and the dashed border stay
 * in step with the decision bar above them.
 * @param input - The two inputs the scene varies, plus the plan-mode setter.
 * @returns A composer state fixture wired to the scene's plan-mode toggle.
 */
function useComposerStub({
	isStreaming,
	lockedProvider,
	onPlanModeChange,
	planMode,
}: {
	isStreaming: boolean;
	lockedProvider: AgentProviderId | null;
	onPlanModeChange?: (planMode: boolean) => void;
	planMode: boolean;
}): ComposerShellState {
	return useMemo(
		() => ({
			activeAgentSessionId: 'playground-session',
			availableModels: MODELS,
			availableThinkingLevels: THINKING_LEVELS,
			contextUsage: { maxTokens: 200_000, usedTokens: 48_000 },
			disabled: false,
			disabledReason: null,
			isStreaming,
			lockedProvider,
			modelId: MODELS[0].id,
			modelLabel: MODELS[0].displayName,
			onModelChange: () => undefined,
			onPlanModeChange: (next: boolean) => onPlanModeChange?.(next),
			onStop: () => undefined,
			onSubmit: () => undefined,
			onThinkingChange: () => undefined,
			placeholder: '',
			planMode,
			thinkingLabel: 'Think',
			thinkingLevel: 'think',
			workspaceCwd: WORKSPACE_CWD,
			workspaceFiles: WORKSPACE_FILES,
		}),
		[isStreaming, lockedProvider, onPlanModeChange, planMode],
	);
}

/** Toggles for the inputs the live composer cannot derive on its own. */
function SceneControls({
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
		<div className='flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2'>
			<div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
				<ControlGroup label='plan review pending'>
					<OnOff isOn={hasPlanReview} onChange={onPlanReviewChange} />
				</ControlGroup>
				<ControlGroup label='plan mode'>
					<OnOff isOn={planMode} onChange={onPlanModeChange} />
				</ControlGroup>
				<ControlGroup label='handing off'>
					<OnOff isOn={isHandingOff} onChange={onHandingOffChange} />
				</ControlGroup>
				<ControlGroup label='streaming'>
					<OnOff isOn={isStreaming} onChange={onStreamingChange} />
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
			<span className='font-mono text-muted-foreground text-xxs'>
				{lastDecision ?? 'no decision yet'}
			</span>
		</div>
	);
}

/** The on/off pair every toggle in this scene is made of. */
function OnOff({
	isOn,
	onChange,
}: {
	isOn: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<>
			<SceneToggle isActive={isOn} label='on' onClick={() => onChange(true)} />
			<SceneToggle
				isActive={!isOn}
				label='off'
				onClick={() => onChange(false)}
			/>
		</>
	);
}
