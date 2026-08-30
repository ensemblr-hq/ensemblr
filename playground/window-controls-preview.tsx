import { QueryClientProvider } from '@tanstack/react-query';
import {
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';

import { NavigationSidebarHeader } from '@/renderer/components/workbench-shell/navigation-sidebar/navigation-sidebar-header';
import { ReviewActionsContextProvider } from '@/renderer/components/workbench-shell/review-actions/review-actions-context';
import { RightSidebarHeader } from '@/renderer/components/workbench-shell/right-sidebar-header/right-sidebar-header';
import { WindowControlCluster } from '@/renderer/components/workbench-shell/window-controls';
import { WorkbenchHeader } from '@/renderer/components/workbench-shell/workbench-header';
import { getDefaultProject } from '@/renderer/fixtures/workbench';
import type { ReviewActionsValue } from '@/renderer/types/workbench';

import { createPlaygroundQueryClient } from './playground-query-client.ts';
import { HEADER_STATE_FIXTURES } from './right-sidebar-header-fixtures.ts';
import { SceneSection } from './scene-chrome.tsx';
import { useSceneWindowChrome } from './scene-window-chrome.tsx';
import { StubbedWorkbenchLayout } from './stubbed-workbench-layout.tsx';

/** Every action the inline review header reads, stubbed to do nothing. */
const IDLE_REVIEW_ACTIONS: ReviewActionsValue = {
	archiveMergedWorkspace: () => undefined,
	commitAndPush: () => undefined,
	continueMergedWorkspace: () => undefined,
	isAgentWorking: false,
	isArchivingMergedWorkspace: false,
	isContinuingMergedWorkspace: false,
	isPushingBranch: false,
	isRefreshingPullRequest: false,
	openMergeConfirmation: () => undefined,
	pushBranch: () => undefined,
	refreshPullRequest: () => undefined,
	runAgentAction: () => undefined,
};

/**
 * Ensemblr's own window controls over the toolbars they overlay — the Linux and
 * Windows chrome, which a macOS machine can never show.
 *
 * The scene applies the real chrome to `<html>` rather than faking the class,
 * so the shipped `html.app-window-controls` rules decide how much room each
 * toolbar reserves. That is the whole point: the trailing inset is CSS, and the
 * bug it had — the workbench toolbar giving the space back while the review
 * sidebar was collapsed and therefore *not* under the buttons — was invisible
 * from the component alone.
 */
export function WindowControlsScene() {
	const [client] = useState(createPlaygroundQueryClient);
	useSceneWindowChrome(true);

	return (
		<QueryClientProvider client={client}>
			<ReviewActionsContextProvider value={IDLE_REVIEW_ACTIONS}>
				<div className='flex flex-col gap-8'>
					<TrailingInsetStates />
					<AlignmentStates />
				</div>
			</ReviewActionsContextProvider>
		</QueryClientProvider>
	);
}

/** Which toolbar reserves room for the cluster, in each review-sidebar state. */
function TrailingInsetStates() {
	const workspace = HEADER_STATE_FIXTURES[0].workspace;

	return (
		<SceneSection
			label='trailing inset — WorkbenchHeader'
			note='the toolbar reserves 7rem for the cluster unless the review sidebar is genuinely to its right'
		>
			<AlignedRow
				label='review sidebar collapsed'
				note='nothing else is under the buttons, so the toolbar keeps the inset and its own actions clear them'
			>
				<StubbedWorkbenchLayout isRightSidebarCollapsed={true}>
					<WorkbenchHeader
						activeProject={getDefaultProject()}
						activeWorkspace={workspace}
					/>
				</StubbedWorkbenchLayout>
			</AlignedRow>

			<AlignedRow
				label='review sidebar expanded'
				note='the sidebar header is the one under the buttons, so the main toolbar gives the room back and the sidebar reserves it instead'
			>
				<div className='flex'>
					<div className='min-w-0 flex-1'>
						<StubbedWorkbenchLayout isRightSidebarCollapsed={false}>
							<WorkbenchHeader
								activeProject={getDefaultProject()}
								activeWorkspace={workspace}
							/>
						</StubbedWorkbenchLayout>
					</div>
					<div className='w-96 shrink-0 border-border border-l'>
						<RightSidebarHeader activeWorkspace={workspace} />
					</div>
				</div>
			</AlignedRow>
		</SceneSection>
	);
}

/** The cluster against each top bar, with the measured heights beside it. */
function AlignmentStates() {
	return (
		<SceneSection
			label='vertical alignment — WindowControlCluster'
			note='every top bar and the cluster read one --ensemblr-toolbar-height, so the button centres cannot drift apart'
		>
			<AlignedRow
				label='.native-toolbar'
				note='height comes from the custom property, not from a per-toolbar class'
			>
				<header className='native-toolbar flex shrink-0 items-center gap-2.5 border-border border-b px-3 font-medium text-sm'>
					{/* i18next-instrument-ignore -- scene label, never shipped */}
					<span>Toolbar content</span>
				</header>
			</AlignedRow>

			<AlignedRow
				label='sidebar title bar — NavigationSidebarHeader'
				note='not a .native-toolbar, so it reads the same property directly'
			>
				<StubbedWorkbenchLayout>
					<NavigationSidebarHeader showsWordmark={true} />
				</StubbedWorkbenchLayout>
			</AlignedRow>
		</SceneSection>
	);
}

/**
 * One toolbar under the control cluster, in a box standing in for the window's
 * top-right corner. The badge beside the label reports both measured heights,
 * so a drift is a red number rather than something to squint at.
 */
function AlignedRow({
	children,
	label,
	note,
}: {
	children: ReactNode;
	label: string;
	note: string;
}) {
	const { clusterHeight, ref, toolbarHeight } = useRowHeights();

	return (
		<section className='flex flex-col gap-1.5'>
			<div className='flex items-baseline gap-2'>
				<h3 className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
					{label}
				</h3>
				<span className='truncate text-muted-foreground text-xxs'>{note}</span>
				<HeightBadge
					clusterHeight={clusterHeight}
					toolbarHeight={toolbarHeight}
				/>
			</div>
			<div
				className='relative overflow-hidden rounded-md border border-border'
				ref={ref}
			>
				{children}
				<div className='pointer-events-none absolute top-0 right-0'>
					<WindowControlCluster
						isMaximized={false}
						onClose={() => undefined}
						onMinimize={() => undefined}
						onToggleMaximize={() => undefined}
					/>
				</div>
			</div>
		</section>
	);
}

/** Green only when the cluster is exactly as tall as the bar it overlays. */
function HeightBadge({
	clusterHeight,
	toolbarHeight,
}: {
	clusterHeight: number;
	toolbarHeight: number;
}) {
	const isAligned = toolbarHeight > 0 && toolbarHeight === clusterHeight;

	return (
		<span
			className={
				isAligned
					? 'shrink-0 rounded border border-status-success/40 px-1.5 py-0.5 font-mono text-status-success text-xxs'
					: 'shrink-0 rounded border border-status-danger/40 px-1.5 py-0.5 font-mono text-status-danger text-xxs'
			}
		>
			{`bar ${toolbarHeight}px · cluster ${clusterHeight}px`}
		</span>
	);
}

/**
 * Measures the row's toolbar against the cluster overlaying it, so the scene
 * reports the alignment from the DOM rather than asserting it in a caption.
 * @returns The two measured heights and the ref to attach to the row.
 */
function useRowHeights(): {
	clusterHeight: number;
	ref: RefObject<HTMLDivElement | null>;
	toolbarHeight: number;
} {
	const ref = useRef<HTMLDivElement>(null);
	const [heights, setHeights] = useState({ cluster: 0, toolbar: 0 });

	useLayoutEffect(() => {
		const root = ref.current;
		if (!root) {
			return;
		}

		const measure = () => {
			const bar = root.firstElementChild;
			const cluster = root.lastElementChild?.firstElementChild;
			setHeights({
				cluster: Math.round(cluster?.getBoundingClientRect().height ?? 0),
				toolbar: Math.round(bar?.getBoundingClientRect().height ?? 0),
			});
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		return () => observer.disconnect();
	}, []);

	return {
		clusterHeight: heights.cluster,
		ref,
		toolbarHeight: heights.toolbar,
	};
}
