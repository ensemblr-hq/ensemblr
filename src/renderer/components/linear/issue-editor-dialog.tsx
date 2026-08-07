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
	const { error, fields, isSaving, metadata, mode, submit, update } =
		useIssueEditorForm({ issue, onOpenChange, open });
	const isCreate = mode === 'create';

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='max-w-lg'>
				<DialogHeader>
					<DialogTitle>
						{isCreate ? 'New Linear issue' : `Edit ${issue?.identifier}`}
					</DialogTitle>
					<DialogDescription>
						{isCreate
							? 'Create an issue in the connected Linear workspace.'
							: 'Update fields where your Linear permissions allow.'}
					</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-3'>
					<Input
						aria-label='Issue title'
						onChange={(event) => update({ title: event.target.value })}
						placeholder='Issue title'
						value={fields.title}
					/>
					<Textarea
						aria-label='Issue description'
						className='min-h-24'
						onChange={(event) => update({ description: event.target.value })}
						placeholder='Description (markdown)'
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
						Cancel
					</Button>
					<Button disabled={isSaving} onClick={submit} size='sm'>
						{isSaving ? 'Saving…' : isCreate ? 'Create issue' : 'Save changes'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
