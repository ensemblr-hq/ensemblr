import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	MaximizeIcon,
	MinusIcon,
	NetworkIcon,
	PlusIcon,
	RotateCcwIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
	architectureSnapshotQuery,
	ensemblrQueryKeys,
	scanArchitectureSnapshot,
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
 * Seeds a workspace that arrives with no diagram, which is how a workspace
 * created before the scan moved onto the creation path gets one. There is no
 * manual rescan: the seed is scanned once and everything after it is an agent's
 * refinement, so a control that re-ran the scanner would overwrite that work.
 *
 * Attempted once per workspace, tracked by ref rather than by state: a
 * repository the scan finds no modules in still stores no snapshot, so a re-run
 * on every settle would be an unbounded scan loop.
 *
 * The outcome is not inspected, only re-read: main reports a failed scan in the
 * snapshot it hands back, which is the surface already showing it.
 * @param needsSeed - True when the read settled with nothing and no error
 * @param workspaceId - Workspace being shown
 */
function useSeedScan({
	needsSeed,
	workspaceId,
}: {
	needsSeed: boolean;
	workspaceId: string;
}): void {
	const queryClient = useQueryClient();
	const attemptedFor = useRef<string | null>(null);
	useEffect(() => {
		if (!needsSeed || attemptedFor.current === workspaceId) {
			return;
		}
		attemptedFor.current = workspaceId;
		void scanArchitectureSnapshot({ workspaceId })
			.catch(() => undefined)
			.then(() =>
				queryClient.invalidateQueries({
					queryKey: ensemblrQueryKeys.architectureSnapshot(workspaceId),
				}),
			);
	}, [needsSeed, queryClient, workspaceId]);
}

/**
 * Resolves what the open control on a node should do.
 *
 * Every node the scanner emits stands for a *directory*, which the file preview
 * cannot render — it answers "is a directory and cannot be previewed". A refined
 * diagram may name a real file, so the path decides.
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
 * The snapshot is read, never computed here — main owns the scan, and the panel
 * only asks for one when the workspace has none yet.
 */
export function ArchitectureDiagramPanel({
	onDirectoryReveal,
	workspaceId,
}: {
	/** Selects All files and expands a workspace-relative directory. */
	onDirectoryReveal: (directoryPath: string) => void;
	workspaceId: string;
}) {
	const { t } = useTranslation();
	const { data } = useQuery(architectureSnapshotQuery(workspaceId));
	const openSource = useSourceOpener(onDirectoryReveal);
	useSnapshotBroadcast(workspaceId);

	const failure = failureText(t, data?.error ?? null);
	const current = data?.current ?? null;
	useSeedScan({
		needsSeed: Boolean(data) && !current && !data?.error,
		workspaceId,
	});

	const delta = useMemo(
		() =>
			data?.current
				? diffArchitectureIr(data.previous ?? null, data.current.ir)
				: null,
		[data],
	);

	if (!current || !delta) {
		return (
			<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
				<PanelMessage
					message={
						failure ??
						t(
							'workbench:architecture-diagram.loading',
							'Reading the workspace architecture…',
						)
					}
					tone={failure ? 'error' : 'muted'}
				/>
			</div>
		);
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

/** Header strip: title, capture time, and the viewport controls. */
function DiagramToolbar({
	capturedAt,
	onFit,
	onReset,
	onZoom,
	zoom,
}: {
	capturedAt: string | null;
	onFit: () => void;
	onReset: () => void;
	onZoom: (zoom: number) => void;
	zoom: number;
}) {
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
						{t(
							'workbench:architecture-diagram.captured-at',
							'scanned {{when}}',
							{
								when: formatRelativeTimestamp(capturedAt),
							},
						)}
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

/** Translated label for each component role, shown in the footer legend. */
function useComponentTypeLabels(): Record<string, string> {
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
