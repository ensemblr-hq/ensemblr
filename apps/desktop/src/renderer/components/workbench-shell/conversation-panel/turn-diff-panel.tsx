import { useQuery } from '@tanstack/react-query';
import { FileDiffIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { turnDiffQuery } from '@/renderer/api/ensemblr-queries';
import { CodeViewerHeader } from '@/renderer/components/code-surface';
import {
	countPatchesWithinRowBudget,
	DiffDisplayToggles,
	DiffViewer,
	MAX_RENDERED_TURN_DIFF_ROWS,
} from '@/renderer/components/diff-viewer';
import { splitCombinedPatch } from '@/renderer/lib/diff/parse';
import { failureText } from '@/renderer/lib/failure-text';
import type {
	ComputeTurnDiffResult,
	TurnDiffFileWire,
} from '@/shared/ipc/contracts/checkpoint';

import { PanelMessage } from './panel-message';

/**
 * Read-only diff surface shown when a `kind: 'diff'` tab is active. Shows the
 * changes between a turn's opening checkpoint and where it ended (the snapshot
 * taken as it stopped, or the live working tree while it still runs), rendering
 * one rich {@link DiffViewer} per changed file.
 *
 * The display toggles sit in this panel's own header rather than above every
 * file: they are app-wide preferences, so stacking one copy per file repeated a
 * control that acts on all of them at once. The diff/file switch is left out
 * entirely — nothing here loads full file sources to switch to.
 */
export function TurnDiffPanel({ turnId }: { turnId: string | null }) {
	const { t } = useTranslation();
	const { data, isError, isPending } = useQuery(turnDiffQuery(turnId));

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

	if (result.files.length === 0) {
		return (
			<PanelMessage
				message={t(
					'workbench:turn-diff.empty.no-changes',
					'No file changes in this turn.',
				)}
			/>
		);
	}

	return <TurnDiffFiles key={turnId} result={result} />;
}

/**
 * The loaded turn diff: a summary of every changed file, then a viewer per file
 * mounted one row budget at a time.
 *
 * Every file stays in the summary, but only the leading files that fit
 * {@link MAX_RENDERED_TURN_DIFF_ROWS} get a viewer, and a control lays out the
 * next window's worth on request. Mounting them all is what let a turn that
 * touched hundreds of files, or added one generated file, commit tens of
 * thousands of table rows at once. Keyed by turn at the call site, so a window
 * opened on one turn is not inherited by the next.
 */
function TurnDiffFiles({
	result,
}: {
	result: Extract<ComputeTurnDiffResult, { ok: true }>;
}) {
	const { t } = useTranslation();
	const [windows, setWindows] = useState(1);
	const patchFiles = useMemo(
		() => (result.patch ? splitCombinedPatch(result.patch) : []),
		[result.patch],
	);
	const { revealCount, shownCount } = useMemo(() => {
		const patches = patchFiles.map((file) => file.patch);
		const budget = windows * MAX_RENDERED_TURN_DIFF_ROWS;
		const shown = countPatchesWithinRowBudget(patches, budget);
		const next = countPatchesWithinRowBudget(
			patches,
			budget + MAX_RENDERED_TURN_DIFF_ROWS,
		);
		return { revealCount: next - shown, shownCount: shown };
	}, [patchFiles, windows]);

	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
			<CodeViewerHeader
				actions={
					<>
						<span className='text-muted-foreground text-xs tabular-nums'>
							{t('workbench:turn-diff.file-count', {
								count: result.files.length,
								defaultValue_one: '{{count}} file',
								defaultValue_other: '{{count}} files',
							})}
						</span>
						<div aria-hidden='true' className='mx-1 h-4 w-px bg-border' />
						<DiffDisplayToggles />
					</>
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
					{result.files.map((file) => (
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
					{patchFiles.slice(0, shownCount).map((file) => (
						<div
							className='border-border border-b last:border-b-0'
							key={file.path || file.patch}
						>
							<DiffViewer
								fillHeight={false}
								filePath={file.path}
								patch={file.patch}
								showToolbar={false}
							/>
						</div>
					))}
				</div>
				{revealCount > 0 ? (
					<button
						className='w-full border-border border-t px-3 py-2 text-left text-muted-foreground text-xs hover:text-foreground'
						onClick={() => setWindows((current) => current + 1)}
						type='button'
					>
						{t('workbench:turn-diff.show-more-files', {
							count: revealCount,
							defaultValue_one: 'Show {{count}} more file',
							defaultValue_other: 'Show {{count}} more files',
						})}
					</button>
				) : null}
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
