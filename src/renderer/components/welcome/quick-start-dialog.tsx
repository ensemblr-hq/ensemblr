import { useCallback, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

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
import {
	entityNameIssueText,
	validateEntityName,
} from '@/renderer/lib/entity-name-validation';
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
	const { t } = useTranslation();
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
	const nameIssue = validateEntityName({
		name: trimmedName,
		pattern: NAME_PATTERN,
	});
	const canCreate =
		!isBusy &&
		trimmedName.length > 0 &&
		nameIssue === null &&
		isEnsemblrApiAvailable();
	const parentPlaceholder =
		defaultParentPath ||
		t('common:quick-start.parent-placeholder', 'Managed repos directory');

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
					{t('common:quick-start.title', 'Create project')}
				</DialogTitle>
				<p className='text-muted-foreground text-xs'>
					{t(
						'common:quick-start.description',
						'Create a local folder and initialize a new git repository.',
					)}
				</p>
			</DialogHeader>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='quick-start-name'>
					{t('common:quick-start.name-label', 'Project name')}
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
						<Trans
							components={{
								name: (
									<span className='rounded-sm bg-muted px-1 py-px font-mono' />
								),
							}}
							defaults='Creates folder and repo <name>{{projectName}}</name>'
							i18nKey='common:quick-start.creates'
							values={{ projectName: trimmedName }}
						/>
					</p>
				) : null}
				{nameIssue ? (
					<p className='text-[0.6875rem] text-destructive'>
						{entityNameIssueText(t, 'project', nameIssue)}
					</p>
				) : null}
			</div>

			<div className='flex flex-col gap-1.5'>
				<Label className='text-xs' htmlFor='quick-start-parent'>
					{t('common:quick-start.parent-label', 'Parent folder')}
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
						{t('common:actions.browse', 'Browse')}
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
						{t(
							'common:actions.reset-managed-root',
							'Reset to managed repos directory',
						)}
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
				submitLabel={
					stage === 'creating'
						? t('common:quick-start.creating', 'Creating…')
						: t('common:actions.create', 'Create')
				}
			/>
		</>
	);
}
