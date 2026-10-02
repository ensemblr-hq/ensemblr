import { QueryClientProvider } from '@tanstack/react-query';
import {
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';

import { ReviewActionsContextProvider } from '@/renderer/components/workbench-shell/review-actions/review-actions-context';
import { RightSidebarHeader } from '@/renderer/components/workbench-shell/right-sidebar-header/right-sidebar-header';
import {
	AppMenuBar,
	WindowTitleBarSurface,
} from '@/renderer/components/workbench-shell/window-controls';
import { WorkbenchHeader } from '@/renderer/components/workbench-shell/workbench-header';
import { getDefaultProject } from '@/renderer/fixtures/workbench';
import type { MenuBarDescriptor } from '@/shared/menu-bar';

import {
	EMPTY_MENU_BAR_FIXTURE,
	MENU_BAR_FIXTURE,
} from './menu-bar-fixtures.ts';
import { createPlaygroundQueryClient } from './playground-query-client.ts';
import { IDLE_REVIEW_ACTIONS } from './review-actions-fixtures.ts';
import { HEADER_STATE_FIXTURES } from './right-sidebar-header-fixtures.ts';
import { SceneSection } from './scene-chrome.tsx';
import { useSceneWindowChrome } from './scene-window-chrome.tsx';
import { StubbedWorkbenchLayout } from './stubbed-workbench-layout.tsx';

/** The header state with the most to fit in one row: PR, status, and action. */
const CROWDED_HEADER_WORKSPACE = (
	HEADER_STATE_FIXTURES.find(
		(fixture) => fixture.expectedKind === 'pr-uncommitted',
	) ?? HEADER_STATE_FIXTURES[0]
).workspace;

/**
 * Ensemblr's own title bar over the toolbars it sits above — the Linux chrome,
 * which a macOS machine can never show.
 *
 * The scene applies the real chrome to `<html>` rather than faking the class,
 * so the shipped rules decide the strip's height and the room the shell gives
 * it back. That is the whole point: the strip's geometry is CSS, and the bug it
 * replaced — a floating cluster crowding whichever toolbar reached the window's
 * trailing edge, which on a review sidebar is the pull-request header — was
 * invisible from the component alone.
 */
export function WindowTitleBarScene() {
	const [client] = useState(createPlaygroundQueryClient);
	useSceneWindowChrome(true);

	return (
		<QueryClientProvider client={client}>
			<ReviewActionsContextProvider value={IDLE_REVIEW_ACTIONS}>
				<div className='flex flex-col gap-8'>
					<TitleBarOverTheShell />
					<MenuBarStates />
					<AlignmentStates />
				</div>
			</ReviewActionsContextProvider>
		</QueryClientProvider>
	);
}

/**
 * The strip above the window's top bars, in each review-sidebar state. The
 * fixture is the busiest pull-request header there is — a number, a preview
 * pill, a blocked status label, and a primary action — because that is the row
 * the floating cluster used to crowd.
 */
function TitleBarOverTheShell() {
	const workspace = CROWDED_HEADER_WORKSPACE;

	return (
		<SceneSection
			label='window title bar — WindowTitleBarSurface'
			note='the controls own a row of their own, so no toolbar below reserves trailing room for them'
		>
			<WindowMock
				label='review sidebar expanded'
				note='the pull-request header keeps its whole row — number, label, and trailing action'
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
			</WindowMock>

			<WindowMock
				label='review sidebar collapsed'
				note='the inline review actions move into the workbench toolbar and still clear the window edge'
			>
				<StubbedWorkbenchLayout isRightSidebarCollapsed={true}>
					<WorkbenchHeader
						activeProject={getDefaultProject()}
						activeWorkspace={workspace}
					/>
				</StubbedWorkbenchLayout>
			</WindowMock>
		</SceneSection>
	);
}

/** The cluster against the strip that hosts it, with the measured heights. */
function AlignmentStates() {
	return (
		<SceneSection
			label='vertical alignment — WindowControlCluster'
			note='the cluster takes its height from the strip, so a taller title bar cannot leave the buttons off-centre'
		>
			<MeasuredRow
				label='.window-title-bar'
				note='height comes from the same inset the shell pads by, not from a class of its own'
			>
				<InertTitleBar />
			</MeasuredRow>
		</SceneSection>
	);
}

/**
 * The menu bar in the two states main can hand it: the built bar, and the empty
 * one a window paints before the first descriptor arrives.
 *
 * Open a menu here rather than reading the fixture — the branches worth seeing
 * are the ones a flat list cannot show: a checkbox run against a radio run, a
 * nested submenu, and the disabled placeholder standing in for an empty dynamic
 * submenu.
 */
function MenuBarStates() {
	return (
		<SceneSection
			label='application menu — AppMenuBar'
			note='drawn from the same tree main builds the native menu from; every label, mark and chord arrives resolved'
		>
			<WindowMock
				label='menu populated'
				note='File, Edit, View, Workspace and Help — open one for the marks, submenus and disabled rows'
			>
				<div className='h-24 bg-background' />
			</WindowMock>

			<section className='flex flex-col gap-1.5'>
				<RowCaption
					label='menu empty'
					note='before main sends its first bar the strip is wordmark and controls, exactly as it was'
				/>
				<div className='overflow-hidden rounded-md border border-border'>
					<InertTitleBar menuBar={EMPTY_MENU_BAR_FIXTURE} />
					<div className='h-24 bg-background' />
				</div>
			</section>
		</SceneSection>
	);
}

/**
 * The shipped strip with its handlers stubbed out. The menu is live — Radix
 * opens and keyboard-navigates it — but picking a row does nothing, since the
 * commands behind one belong to main.
 */
function InertTitleBar({
	menuBar = MENU_BAR_FIXTURE,
}: {
	menuBar?: MenuBarDescriptor;
}) {
	return (
		<WindowTitleBarSurface
			isMaximized={false}
			menu={<AppMenuBar menuBar={menuBar} onSelect={() => undefined} />}
			onClose={() => undefined}
			onMinimize={() => undefined}
			onToggleMaximize={() => undefined}
		/>
	);
}

/** A stand-in for the window: the title bar, then whatever sits beneath it. */
function WindowMock({
	children,
	label,
	note,
}: {
	children: ReactNode;
	label: string;
	note: string;
}) {
	return (
		<section className='flex flex-col gap-1.5'>
			<RowCaption label={label} note={note} />
			<div className='overflow-hidden rounded-md border border-border'>
				<InertTitleBar />
				{children}
			</div>
		</section>
	);
}

/**
 * One bar with the cluster measured against it, so a drift between the strip
 * and the buttons it hosts is a red number rather than something to squint at.
 */
function MeasuredRow({
	children,
	label,
	note,
}: {
	children: ReactNode;
	label: string;
	note: string;
}) {
	const { barHeight, clusterHeight, ref } = useRowHeights();

	return (
		<section className='flex flex-col gap-1.5'>
			<RowCaption label={label} note={note}>
				<HeightBadge barHeight={barHeight} clusterHeight={clusterHeight} />
			</RowCaption>
			<div
				className='overflow-hidden rounded-md border border-border'
				ref={ref}
			>
				{children}
			</div>
		</section>
	);
}

/** The label, the note, and whatever badge the row wants beside them. */
function RowCaption({
	children,
	label,
	note,
}: {
	children?: ReactNode;
	label: string;
	note: string;
}) {
	return (
		<div className='flex items-baseline gap-2'>
			<h3 className='font-mono text-muted-foreground text-xxs uppercase tracking-wide'>
				{label}
			</h3>
			<span className='truncate text-muted-foreground text-xxs'>{note}</span>
			{children}
		</div>
	);
}

/** Green only when the cluster fits the bar hosting it without stretching it. */
function HeightBadge({
	barHeight,
	clusterHeight,
}: {
	barHeight: number;
	clusterHeight: number;
}) {
	const fits = barHeight > 0 && clusterHeight <= barHeight;

	return (
		<span
			className={
				fits
					? 'shrink-0 rounded border border-status-success/40 px-1.5 py-0.5 font-mono text-status-success text-xxs'
					: 'shrink-0 rounded border border-status-danger/40 px-1.5 py-0.5 font-mono text-status-danger text-xxs'
			}
		>
			{`bar ${barHeight}px · cluster ${clusterHeight}px`}
		</span>
	);
}

/**
 * Measures the row's bar against the control cluster inside it, so the scene
 * reports the fit from the DOM rather than asserting it in a caption.
 * @returns The two measured heights and the ref to attach to the row.
 */
function useRowHeights(): {
	barHeight: number;
	clusterHeight: number;
	ref: RefObject<HTMLDivElement | null>;
} {
	const ref = useRef<HTMLDivElement>(null);
	const [heights, setHeights] = useState({ bar: 0, cluster: 0 });

	useLayoutEffect(() => {
		const root = ref.current;
		if (!root) {
			return;
		}

		const measure = () => {
			const bar = root.firstElementChild;
			const cluster = root.querySelector('[role="group"]');
			setHeights({
				bar: Math.round(bar?.getBoundingClientRect().height ?? 0),
				cluster: Math.round(cluster?.getBoundingClientRect().height ?? 0),
			});
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		return () => observer.disconnect();
	}, []);

	return {
		barHeight: heights.bar,
		clusterHeight: heights.cluster,
		ref,
	};
}
