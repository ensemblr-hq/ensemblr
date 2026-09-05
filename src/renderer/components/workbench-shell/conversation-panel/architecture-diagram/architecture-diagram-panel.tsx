import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	MaximizeIcon,
	MinusIcon,
	NetworkIcon,
	PlusIcon,
	RotateCcwIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
	architectureSnapshotQuery,
	ensemblrQueryKeys,
} from '@/renderer/api/ensemblr-queries';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea, ScrollBar } from '@/renderer/components/ui/scroll-area';
import { useDiagramViewport } from '@/renderer/hooks/workbench-shell/architecture-diagram/use-diagram-viewport';
import { compileArchitectureLayout } from '@/renderer/lib/architecture-diagram';
import { ZOOM } from '@/renderer/lib/architecture-diagram/viewport';
import { failureText } from '@/renderer/lib/failure-text';
import { formatRelativeTimestamp } from '@/renderer/lib/workbench/relative-time';
import {
	ARCHITECTURE_COMPONENT_TYPES,
	ARCHITECTURE_FILE_RELATIVE_PATH,
	type ArchitectureComponentType,
	type ArchitectureIR,
	diffArchitectureIr,
} from '@/shared/architecture-diagram';

import { useFilePreviewOpener } from '../file-preview-context';
import { PanelMessage } from '../panel-message';
import { DiagramCanvas } from './diagram-canvas';
import { COMPONENT_TONE } from './diagram-tokens';
import { namesAFile } from './source-path';

/**
 * Keeps the panel's query in step with the main process, which broadcasts every
 * snapshot it stores — so a diagram left open while an agent works updates
 * itself rather than being polled.
 * @param workspaceId - Workspace whose snapshot this panel shows
 */
function useSnapshotBroadcast(workspaceId: string): void {
	const queryClient = useQueryClient();
	useEffect(() => {
		const unsubscribe = window.ensemblr?.onArchitectureSnapshotChanged(
			(event) => {
				if (event.workspaceId === workspaceId) {
					void queryClient.invalidateQueries({
						queryKey: ensemblrQueryKeys.architectureSnapshot(workspaceId),
					});
				}
			},
		);
		return unsubscribe;
	}, [queryClient, workspaceId]);
}

/**
 * Resolves what the open control on a node should do.
 *
 * A node usually stands for a *directory*, which the file preview cannot render
 * — it answers "is a directory and cannot be previewed" — but a diagram may
 * name a real file instead, so the path decides.
 * @param onDirectoryReveal - Selects All files and expands a directory
 * @returns The open handler for a node's first source
 */
function useSourceOpener(
	onDirectoryReveal: (directoryPath: string) => void,
): (sourcePath: string) => void {
	const openFilePreview = useFilePreviewOpener();
	return useCallback(
		(sourcePath: string) => {
			if (namesAFile(sourcePath)) {
				openFilePreview?.(sourcePath);
				return;
			}
			onDirectoryReveal(sourcePath);
		},
		[onDirectoryReveal, openFilePreview],
	);
}

/**
 * The workspace's architecture diagram: modules as nodes, cross-module imports
 * as edges, top-level directories as boundaries.
 *
 * The snapshot is read, never computed — nothing in the app derives a diagram,
 * so a workspace nobody has drawn gets the empty state rather than a wait.
 */
export function ArchitectureDiagramPanel({
	onDirectoryReveal,
	onDraw,
	workspaceId,
}: {
	/** Selects All files and expands a workspace-relative directory. */
	onDirectoryReveal: (directoryPath: string) => void;
	/** Opens a fresh chat and asks its agent to draw the diagram. */
	onDraw?: () => void;
	workspaceId: string;
}) {
	const { t } = useTranslation();
	const { data } = useQuery(architectureSnapshotQuery(workspaceId));
	const openSource = useSourceOpener(onDirectoryReveal);
	useSnapshotBroadcast(workspaceId);

	const failure = failureText(t, data?.error ?? null);
	const current = data?.current ?? null;

	const delta = useMemo(
		() =>
			data?.current
				? diffArchitectureIr(data.previous ?? null, data.current.ir)
				: null,
		[data],
	);

	if (failure) {
		return (
			<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
				<PanelMessage message={failure} tone='error' />
			</div>
		);
	}

	if (!data) {
		return (
			<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
				<PanelMessage
					message={t(
						'workbench:architecture-diagram.loading',
						'Reading the workspace architecture…',
					)}
					tone='muted'
				/>
			</div>
		);
	}

	if (!current || !delta) {
		return <UndrawnDiagram onDraw={onDraw} />;
	}

	return (
		<DiagramSurface
			capturedAt={current.generatedAt}
			delta={delta}
			ir={current.ir}
			onOpenSource={openSource}
		/>
	);
}

/**
 * What the pane shows for a workspace no agent has drawn yet. Nothing derives a
 * diagram, so this is a durable state rather than a wait: it says who has to act
 * and hands the work over on one click.
 */
function UndrawnDiagram({ onDraw }: { onDraw?: () => void }) {
	const { t } = useTranslation();

	return (
		<div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-8 text-center'>
			<div className='flex size-12 items-center justify-center rounded-full bg-muted'>
				<NetworkIcon
					aria-hidden='true'
					className='size-6 text-muted-foreground'
				/>
			</div>
			<div className='flex max-w-md flex-col gap-1.5'>
				<h2 className='font-medium text-sm'>
					{t(
						'workbench:architecture-diagram.undrawn.title',
						'No architecture diagram yet',
					)}
				</h2>
				<p className='text-muted-foreground text-sm'>
					{t(
						'workbench:architecture-diagram.undrawn.body',
						'An agent reads the codebase and draws it. The diagram is stored at {{path}} and travels with your commits.',
						{ path: ARCHITECTURE_FILE_RELATIVE_PATH },
					)}
				</p>
			</div>
			{onDraw ? (
				<Button onClick={onDraw} size='sm' type='button'>
					{t(
						'workbench:architecture-diagram.undrawn.draw',
						'Draw it with an agent',
					)}
				</Button>
			) : null}
		</div>
	);
}

/**
 * The diagram once a snapshot exists: the compiled layout, the viewport that
 * frames it, and the chrome around both.
 *
 * Split from the panel so the viewport's hooks only ever run against a real
 * layout — a compile cannot be conditional, and framing an empty canvas would
 * fight the first real one for the initial fit.
 */
function DiagramSurface({
	capturedAt,
	delta,
	ir,
	onOpenSource,
}: {
	capturedAt: string;
	delta: ReturnType<typeof diffArchitectureIr>;
	ir: ArchitectureIR;
	onOpenSource: (path: string) => void;
}) {
	const { t } = useTranslation();
	const layout = useMemo(() => compileArchitectureLayout(ir), [ir]);
	const viewport = useDiagramViewport(layout.viewBox);

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<DiagramToolbar
				capturedAt={capturedAt}
				onFit={viewport.fitToView}
				onReset={viewport.reset}
				onZoom={viewport.setZoom}
				zoom={viewport.view.zoom}
			/>
			{layout.problems.length > 0 ? (
				<p className='shrink-0 border-border border-b px-3 py-1.5 text-amber-600 text-xs dark:text-amber-400'>
					{t('workbench:architecture-diagram.problems', {
						count: layout.problems.length,
						defaultValue_one: '{{count}} placement problem in this diagram.',
						defaultValue_other: '{{count}} placement problems in this diagram.',
					})}
				</p>
			) : null}
			<div
				className='relative min-h-0 flex-1 overflow-hidden'
				ref={viewport.paneRef}
			>
				<DiagramCanvas
					delta={delta}
					layout={layout}
					onOpenSource={onOpenSource}
					title={ir.meta.title}
					viewport={viewport}
				/>
			</div>
			<DiagramLegend />
		</div>
	);
}

/** The toolbar's title strip and the viewport controls it drives. */
interface DiagramToolbarProps {
	capturedAt: string | null;
	onFit: () => void;
	onReset: () => void;
	onZoom: (zoom: number) => void;
	zoom: number;
}

/** Header strip: title, capture time, and the viewport controls. */
function DiagramToolbar({
	capturedAt,
	onFit,
	onReset,
	onZoom,
	zoom,
}: DiagramToolbarProps) {
	const { t } = useTranslation();
	return (
		<div className='flex h-10 shrink-0 items-center justify-between gap-3 border-border border-b px-3'>
			<div className='flex min-w-0 items-center gap-2'>
				<NetworkIcon
					aria-hidden='true'
					className='size-4 text-muted-foreground'
				/>
				<span className='truncate font-medium text-sm'>
					{t('workbench:architecture-diagram.title', 'Architecture')}
				</span>
				{capturedAt ? (
					<span className='truncate text-muted-foreground text-xs'>
						{t('workbench:architecture-diagram.captured-at', 'drawn {{when}}', {
							when: formatRelativeTimestamp(capturedAt),
						})}
					</span>
				) : null}
			</div>
			<div className='flex shrink-0 items-center gap-1'>
				<Button
					aria-label={t(
						'workbench:architecture-diagram.fit-to-view',
						'Fit to view',
					)}
					onClick={onFit}
					size='icon-sm'
					variant='ghost'
				>
					<MaximizeIcon />
				</Button>
				<Button
					aria-label={t(
						'workbench:architecture-diagram.reset-view',
						'Reset to actual size',
					)}
					onClick={onReset}
					size='icon-sm'
					variant='ghost'
				>
					<RotateCcwIcon />
				</Button>
				<Button
					aria-label={t('workbench:architecture-diagram.zoom-out', 'Zoom out')}
					disabled={zoom <= ZOOM.min}
					onClick={() => onZoom(zoom - ZOOM.step)}
					size='icon-sm'
					variant='ghost'
				>
					<MinusIcon />
				</Button>
				<span className='w-10 text-center text-muted-foreground text-xs tabular-nums'>
					{Math.round(zoom * 100)}%
				</span>
				<Button
					aria-label={t('workbench:architecture-diagram.zoom-in', 'Zoom in')}
					disabled={zoom >= ZOOM.max}
					onClick={() => onZoom(zoom + ZOOM.step)}
					size='icon-sm'
					variant='ghost'
				>
					<PlusIcon />
				</Button>
			</div>
		</div>
	);
}

/**
 * Translated label for each component role, shown in the footer legend. Keyed by
 * the union so a new role is a compile error here rather than a blank row.
 */
function useComponentTypeLabels(): Record<ArchitectureComponentType, string> {
	const { t } = useTranslation();
	return {
		backend: t('workbench:architecture-diagram.legend.backend', 'Backend'),
		cloud: t('workbench:architecture-diagram.legend.cloud', 'Infrastructure'),
		database: t('workbench:architecture-diagram.legend.database', 'Data'),
		external: t('workbench:architecture-diagram.legend.external', 'External'),
		frontend: t('workbench:architecture-diagram.legend.frontend', 'Interface'),
		messagebus: t(
			'workbench:architecture-diagram.legend.messagebus',
			'Messaging',
		),
		security: t('workbench:architecture-diagram.legend.security', 'Security'),
	};
}

/**
 * Footer legend naming what each node colour means. Scrolls sideways rather
 * than wrapping, so a narrow panel keeps the canvas its height instead of
 * spending it on a second legend row.
 */
function DiagramLegend() {
	const labels = useComponentTypeLabels();
	return (
		<ScrollArea className='w-full shrink-0 border-border border-t'>
			<div className='flex items-center gap-x-4 px-3 py-2'>
				{ARCHITECTURE_COMPONENT_TYPES.map((type) => (
					<span
						className='flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs'
						key={type}
					>
						<svg aria-hidden='true' height={8} width={8}>
							<rect
								className={`${COMPONENT_TONE[type].fill} ${COMPONENT_TONE[type].stroke}`}
								height={8}
								rx={2}
								width={8}
							/>
						</svg>
						{labels[type]}
					</span>
				))}
			</div>
			<ScrollBar orientation='horizontal' />
		</ScrollArea>
	);
}
