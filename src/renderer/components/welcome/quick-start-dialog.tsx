import { useCallback, useMemo, useState } from 'react';

import { isEnsemblrApiAvailable } from '@/renderer/api/ensemblr-queries';
import { DialogActionFooter } from '@/renderer/components/dialog-action-footer';
import { DialogDiagnosticsList } from '@/renderer/components/dialog-diagnostics-list';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import { useQuickStartFlow } from '@/renderer/hooks/welcome/use-quick-start-flow';
import { validateEntityName } from '@/renderer/lib/entity-name-validation';
import type { KeymapBinding } from '@/renderer/types/keymap';

/** Modal for creating a brand-new local project (folder + git init + register). */
export function QuickStartDialog({
	onOpenChange,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='gap-4 sm:max-w-lg'>
				<QuickStartDialogForm
					key={open ? 'open' : 'closed'}
					onOpenChange={onOpenChange}
				/>
			</DialogContent>
		</Dialog>
	);
}

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Inner state-owned form that resets each time the dialog re-opens. */
function QuickStartDialogForm({
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
}) {
	const {
		defaultParentPath,
		diagnostics,
		isBusy,
		parentPath,
		parentPathOverride,
		pickParentPath,
		resetParentPath,
		retry,
		setParentPathOverride,
		stage,
		startQuickStart,
	} = useQuickStartFlow({
		onSuccess: () => {
			onOpenChange(false);
		},
	});

	const [name, setName] = useState('');

	const trimmedName = name.trim();
	const localValidation = validateEntityName({
		allowedCharacters: 'letters, numbers, dots, dashes, or underscores',
		name: trimmedName,
		noun: 'Project',
		pattern: NAME_PATTERN,
	});
	const canCreate =
		!isBusy &&
		trimmedName.length > 0 &&
		localValidation === null &&
		isEnsemblrApiAvailable();
	const parentPlaceholder = defaultParentPath || 'Managed repos directory';

	const handleCreate = useCallback(async () => {
		if (!canCreate) {
			return;
		}
		await startQuickStart({ name: trimmedName });
	}, [canCreate, startQuickStart, trimmedName]);

	const submitBindings = useMemo<readonly KeymapBinding<HTMLInputElement>[]>(
		() => [
			[
				'dialog.submit',
				() => {
					handleCreate();
				},
			],
		],
		[handleCreate],
	);
	const handleSubmitKey = useKeymapHandler(submitBindings);

	return (
		<>
			<DialogHeader>
				<DialogTitle className='font-medium text-[0.9375rem]'>
					Create project
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					Create a local folder and initialize a new git repository.
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='quick-start-name'>
					Project name
				</Label>
				<Input
					autoFocus
					className='h-9'
					disabled={isBusy}
					id='quick-start-name'
					onChange={(event) => setName(event.target.value)}
					onKeyDown={handleSubmitKey}
					placeholder='my-new-project'
					value={name}
				/>
				{trimmedName ? (
					<p className='text-[0.6875rem] text-muted-foreground'>
						Creates folder and repo{' '}
						<span className='rounded-sm bg-muted px-1 py-px font-mono'>
							{trimmedName}
						</span>
					</p>
				) : null}
				{localValidation ? (
					<p className='text-[0.6875rem] text-destructive'>{localValidation}</p>
				) : null}
			</div>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='quick-start-parent'>
					Parent folder
				</Label>
				<div className='flex gap-2'>
					<Input
						className='h-9 flex-1 font-mono text-xs'
						disabled={isBusy}
						id='quick-start-parent'
						onChange={(event) => {
							setParentPathOverride(event.target.value);
						}}
						onKeyDown={handleSubmitKey}
						placeholder={parentPlaceholder}
						value={parentPath}
					/>
					<Button
						className='h-9'
						disabled={isBusy || !isEnsemblrApiAvailable()}
						onClick={pickParentPath}
						type='button'
						variant='outline'
					>
						Browse
					</Button>
				</div>
				{parentPathOverride !== null &&
				defaultParentPath &&
				parentPath !== defaultParentPath ? (
					<button
						className='self-start text-[0.6875rem] text-muted-foreground underline-offset-2 hover:underline'
						onClick={resetParentPath}
						type='button'
					>
						Reset to managed repos directory
					</button>
				) : null}
			</div>

			{stage === 'failure' && diagnostics.length > 0 ? (
				<DialogDiagnosticsList
					diagnostics={diagnostics}
					testId='quick-start-diagnostics'
				/>
			) : null}

			<DialogActionFooter
				onRetry={stage === 'failure' ? retry : null}
				onSubmit={handleCreate}
				submitDisabled={!canCreate}
				submitLabel={stage === 'creating' ? 'Creating…' : 'Create'}
			/>
		</>
	);
}
