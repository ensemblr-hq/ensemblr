import { useCallback, useMemo, useState } from 'react';

import { isEnsembleApiAvailable } from '@/renderer/api/ensemble-queries';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { useQuickStartFlow } from '@/renderer/components/welcome/use-quick-start-flow';
import {
	type KeymapBinding,
	useKeymapHandler,
} from '@/renderer/hooks/use-keymap-handler';
import type { QuickStartProjectDiagnostic } from '@/shared/ipc';

interface QuickStartDialogProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

/** Modal for creating a brand-new local project (folder + git init + register). */
export function QuickStartDialog({
	onOpenChange,
	open,
}: QuickStartDialogProps) {
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
const NAME_MAX_LENGTH = 100;

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
	const localValidation = validateNameLocally(trimmedName);
	const canCreate =
		!isBusy &&
		trimmedName.length > 0 &&
		localValidation === null &&
		isEnsembleApiAvailable();
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
						disabled={isBusy || !isEnsembleApiAvailable()}
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
				<QuickStartDiagnosticsList diagnostics={diagnostics} />
			) : null}

			<div className='-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-border border-t bg-muted/40 px-4 py-3'>
				{stage === 'failure' ? (
					<Button
						className='h-8'
						onClick={retry}
						type='button'
						variant='outline'
					>
						Try again
					</Button>
				) : null}
				<Button
					className='h-8 gap-2'
					disabled={!canCreate}
					onClick={handleCreate}
					type='button'
				>
					{stage === 'creating' ? 'Creating…' : 'Create'}
					<span
						aria-hidden='true'
						className='ml-1 inline-flex items-center gap-0.5 text-[0.6875rem] opacity-70'
					>
						⌘↵
					</span>
				</Button>
			</div>
		</>
	);
}

/** Renders the diagnostics card shown on a quick-start failure. */
function QuickStartDiagnosticsList({
	diagnostics,
}: {
	diagnostics: QuickStartProjectDiagnostic[];
}) {
	return (
		<ul
			className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs'
			data-testid='quick-start-diagnostics'
		>
			{diagnostics.map((diagnostic) => (
				<li className='flex flex-col gap-0.5' key={diagnostic.code}>
					<span className='font-medium'>{diagnostic.message}</span>
					{diagnostic.path ? (
						<span className='font-mono text-[0.6875rem] opacity-80'>
							{diagnostic.path}
						</span>
					) : null}
				</li>
			))}
		</ul>
	);
}

/**
 * Mirrors the main-process name rules so we surface immediate feedback before
 * the IPC round-trip.
 */
function validateNameLocally(name: string): string | null {
	if (!name) {
		return null;
	}
	if (name.length > NAME_MAX_LENGTH) {
		return `Project names must be ${NAME_MAX_LENGTH} characters or fewer.`;
	}
	if (name === '.' || name === '..' || name.startsWith('.')) {
		return 'Project names cannot start with a dot.';
	}
	if (!NAME_PATTERN.test(name)) {
		return 'Use only letters, numbers, dots, dashes, or underscores.';
	}
	return null;
}
