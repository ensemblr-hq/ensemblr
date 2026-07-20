import { useQuery } from '@tanstack/react-query';
import { FileDiffIcon } from 'lucide-react';
import { useMemo } from 'react';

import { turnDiffQuery } from '@/renderer/api/ensemblr-queries';
import { DiffViewer } from '@/renderer/components/diff-viewer';
import { splitCombinedPatch } from '@/renderer/components/diff-viewer/parse';
import type { TurnDiffFileWire } from '@/shared/ipc/contracts/checkpoint';

import { PanelMessage } from './panel-message';

/**
 * Read-only diff surface shown when a `kind: 'diff'` tab is active. Shows the
 * changes between a turn's pre-prompt checkpoint and the post-turn state
 * (next checkpoint, or the live working tree for the latest turn), rendering
 * one rich {@link DiffViewer} per changed file.
 */
export function TurnDiffPanel({ turnId }: { turnId: string | null }) {
	const { data, isError, isPending } = useQuery(turnDiffQuery(turnId));

	const patchFiles = useMemo(
		() => (data?.ok && data.patch ? splitCombinedPatch(data.patch) : []),
		[data],
	);

	if (!turnId) {
		return <PanelMessage message='This tab has no turn associated.' />;
	}
	if (isPending) {
		return <PanelMessage message='Computing turn diff…' />;
	}
	if (isError) {
		return <PanelMessage message='Could not compute diff.' tone='error' />;
	}

	const result = data;
	if (!result.ok) {
		return <PanelMessage message={result.error.message} tone='error' />;
	}

	const files = result.files;
	if (files.length === 0) {
		return <PanelMessage message='No file changes in this turn.' />;
	}

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<div className='flex h-9 shrink-0 items-center gap-2 border-border border-b bg-muted/30 px-4'>
				<FileDiffIcon
					aria-hidden='true'
					className='size-3.5 shrink-0 text-muted-foreground'
				/>
				<span className='truncate text-muted-foreground text-xs'>
					{result.checkpoint.label}
				</span>
				<span className='ml-auto shrink-0 text-muted-foreground text-xs'>
					{files.length} file{files.length === 1 ? '' : 's'}
				</span>
			</div>
			<div className='min-h-0 flex-1 overflow-auto'>
				<ul className='border-border border-b px-4 py-2'>
					{files.map((file) => (
						<li
							className='flex items-center gap-2 py-0.5 font-mono text-xs'
							key={file.path}
						>
							<span className='w-4 shrink-0 text-muted-foreground'>
								{statusGlyph(file.status)}
							</span>
							<span className='min-w-0 truncate'>{file.path}</span>
							<span className='ml-auto shrink-0 text-status-success'>
								{file.additions !== null ? `+${file.additions}` : ''}
							</span>
							<span className='shrink-0 text-destructive'>
								{file.deletions !== null ? `-${file.deletions}` : ''}
							</span>
						</li>
					))}
				</ul>
				<div className='flex flex-col'>
					{patchFiles.map((file) => (
						<div
							className='border-border border-b'
							key={file.path || file.patch}
						>
							<div className='bg-muted/20 px-4 py-1 font-mono text-muted-foreground text-xs'>
								{file.path}
							</div>
							<DiffViewer
								fillHeight={false}
								filePath={file.path}
								patch={file.patch}
							/>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * Map a turn-diff file status to its single-letter glyph.
 * @param status - The changed-file status.
 * @returns The status glyph (A/D/R/M).
 */
function statusGlyph(status: TurnDiffFileWire['status']): string {
	switch (status) {
		case 'added':
			return 'A';
		case 'deleted':
			return 'D';
		case 'renamed':
			return 'R';
		default:
			return 'M';
	}
}
