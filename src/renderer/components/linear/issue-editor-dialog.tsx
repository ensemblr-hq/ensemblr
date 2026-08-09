import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useIssueEditorForm } from '@/renderer/hooks/linear/use-issue-editor-form';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';

import {
	IssueEditorFieldGrid,
	IssueEditorLabelPicker,
} from './issue-editor-fields';

/** Create/edit dialog for Linear issues, fed by cached metadata pickers. */
export function LinearIssueEditorDialog({
	issue,
	onOpenChange,
	open,
}: {
	issue?: LinearIssueWire;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { t } = useTranslation();
	const { error, fields, isSaving, metadata, mode, submit, update } =
		useIssueEditorForm({ issue, onOpenChange, open });
	const isCreate = mode === 'create';

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='max-w-lg'>
				<DialogHeader>
					<DialogTitle>
						{isCreate
							? t('linear:issue-editor.title-create', 'New Linear issue')
							: t('linear:issue-editor.title-edit', 'Edit {{identifier}}', {
									identifier: issue?.identifier ?? '',
								})}
					</DialogTitle>
					<DialogDescription>
						{isCreate
							? t(
									'linear:issue-editor.description-create',
									'Create an issue in the connected Linear workspace.',
								)
							: t(
									'linear:issue-editor.description-edit',
									'Update fields where your Linear permissions allow.',
								)}
					</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-3'>
					<Input
						aria-label={t('linear:issue-editor.field.title', 'Issue title')}
						onChange={(event) => update({ title: event.target.value })}
						placeholder={t('linear:issue-editor.field.title', 'Issue title')}
						value={fields.title}
					/>
					<Textarea
						aria-label={t(
							'linear:issue-editor.field.description',
							'Issue description',
						)}
						className='min-h-24'
						onChange={(event) => update({ description: event.target.value })}
						placeholder={t(
							'linear:issue-editor.field.description-placeholder',
							'Description (markdown)',
						)}
						value={fields.description}
					/>

					<IssueEditorFieldGrid
						fields={fields}
						metadata={metadata}
						mode={mode}
						update={update}
					/>

					<IssueEditorLabelPicker
						fields={fields}
						metadata={metadata}
						update={update}
					/>

					{error ? (
						<p className='text-status-danger text-xs' role='alert'>
							{error}
						</p>
					) : null}
				</div>

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} size='sm' variant='ghost'>
						{t('common:actions.cancel', 'Cancel')}
					</Button>
					<Button disabled={isSaving} onClick={submit} size='sm'>
						{isSaving
							? t('linear:issue-editor.saving', 'Saving…')
							: isCreate
								? t('linear:issue-editor.submit-create', 'Create issue')
								: t('linear:issue-editor.submit-edit', 'Save changes')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
