import { useQuery } from '@tanstack/react-query';
import { FileDiffIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { turnDiffQuery } from '@/renderer/api/ensemblr-queries';
import { CodeViewerHeader } from '@/renderer/components/code-surface';
import { DiffViewer } from '@/renderer/components/diff-viewer';
import { splitCombinedPatch } from '@/renderer/lib/diff/parse';
import { failureText } from '@/renderer/lib/failure-text';
import type { TurnDiffFileWire } from '@/shared/ipc/contracts/checkpoint';

import { PanelMessage } from './panel-message';

/**
 * Read-only diff surface shown when a `kind: 'diff'` tab is active. Shows the
 * changes between a turn's pre-prompt checkpoint and the post-turn state
 * (next checkpoint, or the live working tree for the latest turn), rendering
 * one rich {@link DiffViewer} per changed file.
 */
export function TurnDiffPanel({ turnId }: { turnId: string | null }) {
	const { t } = useTranslation();
	const { data, isError, isPending } = useQuery(turnDiffQuery(turnId));

	const patchFiles = useMemo(
		() => (data?.ok && data.patch ? splitCombinedPatch(data.patch) : []),
		[data],
	);

	if (!turnId) {
		return (
			<PanelMessage
				message={t(
					'workbench:turn-diff.empty.no-turn',
					'This tab has no turn associated.',
				)}
			/>
		);
	}
	if (isPending) {
		return (
			<PanelMessage
				message={t('workbench:turn-diff.empty.loading', 'Computing turn diff…')}
			/>
		);
	}
	if (isError) {
		return (
			<PanelMessage
				message={t(
					'workbench:turn-diff.empty.failed',
					'Could not compute diff.',
				)}
				tone='error'
			/>
		);
	}

	const result = data;
	if (!result.ok) {
		return (
			<PanelMessage message={failureText(t, result.error) ?? ''} tone='error' />
		);
	}

	const files = result.files;
	if (files.length === 0) {
		return (
			<PanelMessage
				message={t(
					'workbench:turn-diff.empty.no-changes',
					'No file changes in this turn.',
				)}
			/>
		);
	}

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<CodeViewerHeader
				actions={
					<span className='text-muted-foreground text-xs tabular-nums'>
						{t('workbench:turn-diff.file-count', {
							count: files.length,
							defaultValue_one: '{{count}} file',
							defaultValue_other: '{{count}} files',
						})}
					</span>
				}
				icon={
					<FileDiffIcon
						aria-hidden='true'
						className='size-3.5 shrink-0 text-muted-foreground'
					/>
				}
				title={result.checkpoint.label}
			/>
			<div className='sleek-scrollbar min-h-0 flex-1 overflow-auto'>
				<ul className='border-border border-b px-3 py-2'>
					{files.map((file) => (
						<li
							className='flex items-center gap-2 py-0.5 font-mono text-code-body leading-code'
							key={file.path}
						>
							<span className='w-4 shrink-0 text-muted-foreground'>
								{statusGlyph(file.status)}
							</span>
							<span className='min-w-0 truncate'>{file.path}</span>
							<span className='ml-auto shrink-0 text-diff-addition-foreground tabular-nums'>
								{file.additions !== null ? `+${file.additions}` : ''}
							</span>
							<span className='shrink-0 text-diff-deletion-foreground tabular-nums'>
								{file.deletions !== null ? `-${file.deletions}` : ''}
							</span>
						</li>
					))}
				</ul>
				<div className='flex flex-col'>
					{patchFiles.map((file) => (
						<div
							className='border-border border-b last:border-b-0'
							key={file.path || file.patch}
						>
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
