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

import { createPlaygroundQueryClient } from './playground-query-client.ts';
import { ControlGroup, SceneSection, SceneToggle } from './scene-chrome.tsx';

const WORKSPACE_CWD = '/Users/you/Projects/ensemblr';

const MODELS: readonly ComposerModelOption[] = [
	{
		displayName: 'Opus 5',
		id: 'claude-opus-5',
		isDefault: true,
		provider: 'anthropic',
	},
	{ displayName: 'Sonnet 5', id: 'claude-sonnet-5', provider: 'anthropic' },
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
					onHandingOffChange={setHandingOff}
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
	onPlanModeChange,
	planMode,
	planReview,
}: {
	chatTabId: string;
	isStreaming?: boolean;
	label?: string;
	onPlanModeChange?: (planMode: boolean) => void;
	planMode: boolean;
	planReview?: React.ReactNode;
}) {
	const composer = useComposerStub({ isStreaming, onPlanModeChange, planMode });

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
	onPlanModeChange,
	planMode,
}: {
	isStreaming: boolean;
	onPlanModeChange?: (planMode: boolean) => void;
	planMode: boolean;
}): ComposerShellState {
	return useMemo(
		() => ({
			activePiSessionId: 'playground-session',
			availableModels: MODELS,
			availableThinkingLevels: THINKING_LEVELS,
			contextUsage: { maxTokens: 200_000, usedTokens: 48_000 },
			disabled: false,
			disabledReason: null,
			isStreaming,
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
		[isStreaming, onPlanModeChange, planMode],
	);
}

/** Toggles for the inputs the live composer cannot derive on its own. */
function SceneControls({
	hasPlanReview,
	isHandingOff,
	isStreaming,
	lastDecision,
	onHandingOffChange,
	onPlanModeChange,
	onPlanReviewChange,
	onStreamingChange,
	planMode,
}: {
	hasPlanReview: boolean;
	isHandingOff: boolean;
	isStreaming: boolean;
	lastDecision: string | null;
	onHandingOffChange: (enabled: boolean) => void;
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
