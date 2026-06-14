import { useQuery } from '@tanstack/react-query';
import { FileDiffIcon, TriangleAlertIcon } from 'lucide-react';

import type { BundledLanguage } from 'shiki';

import { turnDiffQuery } from '@/renderer/api/ensemble-queries';
import { CodeBlockContent } from '@/renderer/components/code-block';
import type { TurnDiffFileWire } from '@/shared/ipc/contracts/checkpoint';

/**
 * Read-only diff surface shown when a `kind: 'diff'` tab is active. Shows the
 * changes between a turn's pre-prompt checkpoint and the post-turn state
 * (next checkpoint, or the live working tree for the latest turn).
 */
export function TurnDiffPanel({ turnId }: { turnId: string | null }) {
	const { data, isError, isPending } = useQuery(turnDiffQuery(turnId));

	if (!turnId) {
		return <TurnDiffMessage message='This tab has no turn associated.' />;
	}
	if (isPending) {
		return <TurnDiffMessage message='Computing turn diff…' />;
	}
	if (isError) {
		return <TurnDiffMessage message='Could not compute diff.' tone='error' />;
	}

	const result = data;
	if (!result.ok) {
		return <TurnDiffMessage message={result.error.message} tone='error' />;
	}

	const files = result.files;
	if (files.length === 0) {
		return <TurnDiffMessage message='No file changes in this turn.' />;
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
				{result.patch ? (
					<CodeBlockContent
						code={result.patch}
						language={'diff' as BundledLanguage}
					/>
				) : null}
			</div>
		</div>
	);
}

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

function TurnDiffMessage({
	message,
	tone = 'muted',
}: {
	message: string;
	tone?: 'error' | 'muted';
}) {
	return (
		<div className='flex min-h-0 flex-1 items-center justify-center p-6'>
			<div className='flex items-center gap-2 text-sm'>
				{tone === 'error' ? (
					<TriangleAlertIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-destructive'
					/>
				) : null}
				<span
					className={
						tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
					}
				>
					{message}
				</span>
			</div>
		</div>
	);
}
