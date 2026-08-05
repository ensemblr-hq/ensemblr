import { QueryClientProvider } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';

import { Toaster } from '@/renderer/components/ui/sonner';
import { OpenTargetSplitButton } from '@/renderer/components/workbench-shell/open-target-split-button';
import { ReviewActionsContextProvider } from '@/renderer/components/workbench-shell/review-actions/review-actions-context';
import { CreatePullRequestMenu } from '@/renderer/components/workbench-shell/right-sidebar-header/create-pull-request-menu';
import { PreviewDeploymentButton } from '@/renderer/components/workbench-shell/right-sidebar-header/preview-deployment-button';
import { PullRequestNumberButton } from '@/renderer/components/workbench-shell/right-sidebar-header/pull-request-number-button';
import { RightSidebarHeader } from '@/renderer/components/workbench-shell/right-sidebar-header/right-sidebar-header';
import { WorkbenchHeader } from '@/renderer/components/workbench-shell/workbench-header';
import { getDefaultProject } from '@/renderer/fixtures/workbench';
import { getRightSidebarHeaderState } from '@/renderer/lib/workbench/right-sidebar-header-state';
import { continuedMergedPullRequestByWorkspaceAtom } from '@/renderer/state/workspace';
import type {
	ReviewActionsValue,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { MeasuredRow } from './measured-controls.tsx';
import {
	createPlaygroundQueryClient,
	PLAYGROUND_OPEN_TARGETS,
} from './playground-query-client.ts';
import {
	CONTINUED_PULL_REQUEST_NUMBER,
	CONTINUED_WORKSPACE_ID,
	HEADER_STATE_FIXTURES,
	HEADER_TONES,
	type HeaderStateFixture,
	PREVIEW_DEPLOYMENT_VARIANTS,
	READY_PREVIEW_DEPLOYMENT,
} from './right-sidebar-header-fixtures.ts';
import { ControlGroup, SceneSection, SceneToggle } from './scene-chrome.tsx';
import { StubbedWorkbenchLayout } from './stubbed-workbench-layout.tsx';

/** Which post-merge action the review-actions stub reports as in flight. */
type BusyAction = 'archiving' | 'continuing' | 'idle';

const BUSY_ACTIONS: readonly BusyAction[] = ['idle', 'continuing', 'archiving'];

/**
 * Every state of the review sidebar header, on both surfaces it mounts on, with
 * each row's rendered control heights measured against the 1.75rem cap.
 *
 * The header is derived state — `getRightSidebarHeaderState` reads a workspace's
 * pull-request slice — so the scene drives real workspace models through the
 * shipped components rather than rendering the branches directly. A row that
 * stops matching its expected kind is a resolver change, not a styling one.
 */
export function RightSidebarHeaderScene() {
	const [client] = useState(createPlaygroundQueryClient);
	const [hasPreviewDeployment, setPreviewDeployment] = useState(true);
	const [busyAction, setBusyAction] = useState<BusyAction>('idle');
	const [isAgentWorking, setAgentWorking] = useState(false);
	const [isPushing, setPushing] = useState(false);
	const [isRefreshing, setRefreshing] = useState(false);
	const setContinuedPullRequests = useSetAtom(
		continuedMergedPullRequestByWorkspaceAtom,
	);

	useEffect(() => {
		setContinuedPullRequests((previous) => ({
			...previous,
			[CONTINUED_WORKSPACE_ID]: CONTINUED_PULL_REQUEST_NUMBER,
		}));
	}, [setContinuedPullRequests]);

	const reviewActions = useMemo<ReviewActionsValue>(
		() => ({
			archiveMergedWorkspace: () => undefined,
			commitAndPush: () => undefined,
			continueMergedWorkspace: () => undefined,
			isAgentWorking,
			isArchivingMergedWorkspace: busyAction === 'archiving',
			isContinuingMergedWorkspace: busyAction === 'continuing',
			isPushingBranch: isPushing,
			isRefreshingPullRequest: isRefreshing,
			openMergeConfirmation: () => undefined,
			pushBranch: () => undefined,
			refreshPullRequest: () => undefined,
			runAgentAction: () => undefined,
		}),
		[busyAction, isAgentWorking, isPushing, isRefreshing],
	);

	const fixtures = useMemo(
		() =>
			HEADER_STATE_FIXTURES.map((fixture) =>
				withPreviewDeployment(fixture, hasPreviewDeployment),
			),
		[hasPreviewDeployment],
	);
	return (
		<QueryClientProvider client={client}>
			<ReviewActionsContextProvider value={reviewActions}>
				<div className='flex flex-col gap-8'>
					<SceneControls
						busyAction={busyAction}
						hasPreviewDeployment={hasPreviewDeployment}
						isAgentWorking={isAgentWorking}
						isPushing={isPushing}
						isRefreshing={isRefreshing}
						onAgentWorkingChange={setAgentWorking}
						onBusyActionChange={setBusyAction}
						onPreviewDeploymentChange={setPreviewDeployment}
						onPushingChange={setPushing}
						onRefreshingChange={setRefreshing}
					/>

					<SidebarHeaderStates
						fixtures={fixtures}
						isAgentWorking={isAgentWorking}
					/>
					<CollapsedToolbarStates
						fixtures={fixtures}
						isAgentWorking={isAgentWorking}
					/>
					<ChildComponentStates />
				</div>
				<Toaster />
			</ReviewActionsContextProvider>
		</QueryClientProvider>
	);
}

/** Each header state on the surface it was designed for: the review sidebar. */
function SidebarHeaderStates({
	fixtures,
	isAgentWorking,
}: {
	fixtures: readonly HeaderStateFixture[];
	isAgentWorking: boolean;
}) {
	return (
		<SceneSection
			label='sidebar header — RightSidebarHeader'
			note='the h-12 bar above the review sidebar; tone tints the whole strip'
		>
			{fixtures.map((fixture) => (
				<MeasuredRow
					key={fixture.workspace.id}
					label={describeFixture(fixture, isAgentWorking)}
					note={fixture.note}
				>
					<div className='w-full max-w-sm overflow-hidden rounded-md border border-border'>
						<RightSidebarHeader activeWorkspace={fixture.workspace} />
					</div>
				</MeasuredRow>
			))}
		</SceneSection>
	);
}

/** The same states on the main toolbar, where they mount once the sidebar is collapsed. */
function CollapsedToolbarStates({
	fixtures,
	isAgentWorking,
}: {
	fixtures: readonly HeaderStateFixture[];
	isAgentWorking: boolean;
}) {
	return (
		<SceneSection
			label='collapsed toolbar — WorkbenchHeader + RightSidebarHeaderInlineActions'
			note='the row from the screenshot; switch the canvas to "full" so it is not cramped'
		>
			{fixtures.map((fixture) => (
				<MeasuredRow
					key={fixture.workspace.id}
					label={describeFixture(fixture, isAgentWorking)}
					note={fixture.note}
				>
					<CollapsedToolbarRow workspace={fixture.workspace} />
				</MeasuredRow>
			))}
		</SceneSection>
	);
}

/**
 * The header's child controls driven directly, so every tone and provider is
 * visible at once rather than only the combinations a workspace state produces.
 */
function ChildComponentStates() {
	return (
		<SceneSection
			label='child components in isolation'
			note='every tone and provider the header pills can take'
		>
			<MeasuredRow label='PullRequestNumberButton — all tones'>
				<PillRow>
					{HEADER_TONES.map((tone) => (
						<PillCell key={tone} label={tone}>
							<PullRequestNumberButton
								number={15}
								tone={tone}
								url='https://github.com/psoldunov/ensemblr/pull/15'
							/>
						</PillCell>
					))}
					<PillCell label='no url'>
						<PullRequestNumberButton number={15} tone='neutral' />
					</PillCell>
				</PillRow>
			</MeasuredRow>

			<MeasuredRow
				label='PreviewDeploymentButton — providers and statuses'
				note='a non-ready deployment outranks the header tone'
			>
				<PillRow>
					{PREVIEW_DEPLOYMENT_VARIANTS.map((variant) => (
						<PillCell key={variant.label} label={variant.label}>
							<PreviewDeploymentButton
								deployment={variant.deployment}
								tone='ready'
							/>
						</PillCell>
					))}
				</PillRow>
			</MeasuredRow>

			<MeasuredRow label='CreatePullRequestMenu — split button'>
				<PillRow>
					<PillCell label='create-pr action'>
						<CreatePullRequestMenu
							workspace={HEADER_STATE_FIXTURES[1].workspace}
						/>
					</PillCell>
				</PillRow>
			</MeasuredRow>

			<MeasuredRow label='OpenTargetSplitButton — both variants'>
				<PillRow>
					<PillCell label='icon only (workbench header)'>
						<OpenTargetSplitButton
							menuAriaLabel='Open current workspace app options'
							onInvoke={() => undefined}
							openTargets={PLAYGROUND_OPEN_TARGETS}
							primaryAriaLabel='Open current workspace in VS Code'
							primaryTarget={PLAYGROUND_OPEN_TARGETS[0]}
						/>
					</PillCell>
					<PillCell label='labelled (settings toolbar)'>
						<OpenTargetSplitButton
							menuAriaLabel='Open settings file app options'
							onInvoke={() => undefined}
							openTargets={PLAYGROUND_OPEN_TARGETS}
							primaryAriaLabel='Edit in VS Code'
							primaryLabel='Edit in…'
							primaryTarget={PLAYGROUND_OPEN_TARGETS[0]}
						/>
					</PillCell>
				</PillRow>
			</MeasuredRow>
		</SceneSection>
	);
}

/**
 * The shipped workbench toolbar with the review sidebar collapsed, which is the
 * only configuration that mounts the inline header actions.
 */
function CollapsedToolbarRow({
	workspace,
}: {
	workspace: WorkspaceShellModel;
}) {
	return (
		<div className='overflow-hidden rounded-md border border-border'>
			<StubbedWorkbenchLayout>
				<WorkbenchHeader
					activeProject={getDefaultProject()}
					activeWorkspace={workspace}
				/>
			</StubbedWorkbenchLayout>
		</div>
	);
}

/** The scene toggles and their setters, lifted out because there are ten of them. */
interface SceneControlsProps {
	busyAction: BusyAction;
	hasPreviewDeployment: boolean;
	isAgentWorking: boolean;
	isPushing: boolean;
	isRefreshing: boolean;
	onAgentWorkingChange: (enabled: boolean) => void;
	onBusyActionChange: (action: BusyAction) => void;
	onPreviewDeploymentChange: (enabled: boolean) => void;
	onPushingChange: (enabled: boolean) => void;
	onRefreshingChange: (enabled: boolean) => void;
}

/** Toggles for the inputs the header reads from context rather than the workspace. */
function SceneControls({
	busyAction,
	hasPreviewDeployment,
	isAgentWorking,
	isPushing,
	isRefreshing,
	onAgentWorkingChange,
	onBusyActionChange,
	onPreviewDeploymentChange,
	onPushingChange,
	onRefreshingChange,
}: SceneControlsProps) {
	return (
		<div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-surface px-3 py-2'>
			<ControlGroup label='agent working'>
				<SceneToggle
					isActive={isAgentWorking}
					label='on'
					onClick={() => onAgentWorkingChange(true)}
				/>
				<SceneToggle
					isActive={!isAgentWorking}
					label='off'
					onClick={() => onAgentWorkingChange(false)}
				/>
			</ControlGroup>
			<ControlGroup label='pushing branch'>
				<SceneToggle
					isActive={isPushing}
					label='on'
					onClick={() => onPushingChange(true)}
				/>
				<SceneToggle
					isActive={!isPushing}
					label='off'
					onClick={() => onPushingChange(false)}
				/>
			</ControlGroup>
			<ControlGroup label='preview deployment'>
				<SceneToggle
					isActive={hasPreviewDeployment}
					label='on'
					onClick={() => onPreviewDeploymentChange(true)}
				/>
				<SceneToggle
					isActive={!hasPreviewDeployment}
					label='off'
					onClick={() => onPreviewDeploymentChange(false)}
				/>
			</ControlGroup>
			<ControlGroup label='post-merge action in flight'>
				{BUSY_ACTIONS.map((action) => (
					<SceneToggle
						isActive={action === busyAction}
						key={action}
						label={action}
						onClick={() => onBusyActionChange(action)}
					/>
				))}
			</ControlGroup>
			<ControlGroup label='refreshing PR'>
				<SceneToggle
					isActive={isRefreshing}
					label='on'
					onClick={() => onRefreshingChange(true)}
				/>
				<SceneToggle
					isActive={!isRefreshing}
					label='off'
					onClick={() => onRefreshingChange(false)}
				/>
			</ControlGroup>
		</div>
	);
}

/** Lays isolated controls out on the surface they sit on in the app. */
function PillRow({ children }: { children: React.ReactNode }) {
	return (
		<div className='flex flex-wrap items-start gap-4 rounded-md border border-border bg-toolbar px-3 py-2.5'>
			{children}
		</div>
	);
}

/** One captioned control inside a {@link PillRow}. */
function PillCell({
	children,
	label,
}: {
	children: React.ReactNode;
	label: string;
}) {
	return (
		<div className='flex flex-col items-start gap-1'>
			{children}
			<span className='font-mono text-muted-foreground text-xxs'>{label}</span>
		</div>
	);
}

/**
 * Attaches or strips the preview deployment on a fixture, since the pill rides
 * along on every PR-linked state and doubling the row count to show both would
 * bury the states themselves.
 * @param fixture - Scene fixture to adjust.
 * @param enabled - Whether the workspace should carry a preview deployment.
 * @returns The fixture with its deployment set or cleared.
 */
function withPreviewDeployment(
	fixture: HeaderStateFixture,
	enabled: boolean,
): HeaderStateFixture {
	return {
		...fixture,
		workspace: {
			...fixture.workspace,
			pullRequest: {
				...fixture.workspace.pullRequest,
				previewDeployment: enabled ? READY_PREVIEW_DEPLOYMENT : undefined,
			},
		},
	};
}

/**
 * Labels a row with the kind the resolver actually returned, flagging it when it
 * disagrees with the kind the fixture was built to produce. An agent turn is an
 * overlay rather than a kind, so the label keeps reporting the underlying state
 * and appends the freeze.
 * @param fixture - Scene fixture being rendered.
 * @param isAgentWorking - Whether the scene's agent-working toggle is on.
 * @returns The row label.
 */
function describeFixture(
	fixture: HeaderStateFixture,
	isAgentWorking: boolean,
): string {
	const { workspace } = fixture;
	const { kind, tone } = getRightSidebarHeaderState(
		workspace,
		workspace.changeSummary.files > 0,
		{
			agentBusy: isAgentWorking,
			...(workspace.id === CONTINUED_WORKSPACE_ID
				? { continuedPullRequestNumber: CONTINUED_PULL_REQUEST_NUMBER }
				: {}),
		},
	);
	const resolved = `${kind} · ${tone}${isAgentWorking ? ' · working' : ''}`;
	return kind === fixture.expectedKind
		? resolved
		: `${resolved} ⚠ expected ${fixture.expectedKind}`;
}
