import type { ReactNode } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangePreview,
	RootDirectorySelectionResult,
} from '@/shared/ipc/contracts/root-directory';

import { RootDirectoryApplyResult } from './apply-result';
import { RootDirectoryDiagnostics } from './diagnostics';
import { RootPathPreview } from './path-preview';

/** Modal dialog wrapping the root-directory change flow. */
export function RootDirectoryChangeDialog({
	applyResult,
	isApplying,
	onConfirm,
	onOpenChange,
	selection,
}: {
	applyResult: RootDirectoryChangeApplyResult | null;
	isApplying: boolean;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	selection: RootDirectorySelectionResult | null;
}) {
	const preview = selection?.preview ?? null;
	const canApply = Boolean(preview?.canApply) && !isApplying;

	return (
		<Dialog onOpenChange={onOpenChange} open={Boolean(selection)}>
			<DialogContent className='sm:max-w-lg'>
				<RootDirectoryChangeContent
					applyResult={applyResult}
					canApply={canApply}
					header={
						<DialogHeader>
							<DialogTitle>Change root directory</DialogTitle>
							<DialogDescription>
								Switch Ensemblr to the selected root and reindex/adopt from that
								filesystem layout after confirmation.
							</DialogDescription>
						</DialogHeader>
					}
					isApplying={isApplying}
					onConfirm={onConfirm}
					preview={preview}
				/>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Inner content of the root-directory change dialog (preview + apply).
 *
 * `header` is an optional render-prop: the dialog wrapper passes a
 * `<DialogHeader>` so it lives inside the dialog tree; the embedded panel
 * variant passes nothing, and a plain heading is rendered by default.
 */
export function RootDirectoryChangeContent({
	applyResult,
	canApply,
	header,
	isApplying,
	onConfirm,
	preview,
}: {
	applyResult: RootDirectoryChangeApplyResult | null;
	canApply: boolean;
	header?: ReactNode;
	isApplying: boolean;
	onConfirm: () => void;
	preview: RootDirectoryChangePreview | null;
}) {
	return (
		<>
			{header ?? (
				<div className='flex flex-col gap-2'>
					<h2 className='font-heading font-medium text-base leading-none'>
						Change root directory
					</h2>
					<p className='text-muted-foreground text-sm'>
						Switch Ensemblr to the selected root and reindex/adopt from that
						filesystem layout after confirmation.
					</p>
				</div>
			)}

			{preview ? (
				<div className='flex flex-col gap-3'>
					<RootPathPreview preview={preview} />
					<section className='rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2.5 text-xs leading-5'>
						<p className='font-medium text-foreground'>
							Old root contents are preserved.
						</p>
						<p className='mt-1 text-muted-foreground'>
							Switching changes where Ensemblr looks for repos, workspaces, and
							archived contexts. Reindex/adopt is the default behavior.
							Migration is a separate action. Delete or cleanup is a separate
							destructive action.
						</p>
						<p className='mt-1 text-muted-foreground'>
							Shared Conductor root continuity covers filesystem, git, and
							config only; chat/session/checkpoint continuity is not guaranteed
							across apps.
						</p>
					</section>
					<RootDirectoryDiagnostics
						diagnostics={preview.diagnostics}
						emptyLabel='No blocking root warnings.'
					/>
					{applyResult ? (
						<RootDirectoryApplyResult result={applyResult} />
					) : null}
				</div>
			) : null}

			<DialogFooter>
				<Button
					disabled={!canApply}
					onClick={onConfirm}
					type='button'
					variant='default'
				>
					{isApplying ? 'Applying' : 'Switch root'}
				</Button>
			</DialogFooter>
		</>
	);
}
