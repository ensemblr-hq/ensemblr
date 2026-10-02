import { AlertCircleIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
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
import { buildTeamChangeFields } from '@/renderer/lib/linear';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import { formatChord } from '@/shared/keymap';
import {
	IssueEditorMetaRow,
	IssueEditorTeamPicker,
} from './issue-editor-fields';

/**
 * Create/edit dialog for Linear issues. The composer runs top to bottom the way
 * an issue is actually written — team, then title, then body, then the meta
 * pills — instead of the uniform field grid it replaces, where the title sat in
 * the same bordered box as every optional picker.
 */
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
	const {
		accountFailures,
		accountId,
		canSubmit,
		error,
		fields,
		isSaving,
		metadata,
		mode,
		submit,
		update,
	} = useIssueEditorForm({ issue, onOpenChange, open });
	const isCreate = mode === 'create';
	/**
	 * Submit on ⌘↵ from anywhere in the dialog, including the description, so a
	 * filled-in form never needs a trip to the mouse.
	 * @param event - Key event bubbling out of the composer
	 */
	const onSubmitShortcut = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className='gap-0 sm:max-w-2xl'
				onKeyDown={onSubmitShortcut}
			>
				<DialogHeader className='flex-row items-center gap-2 pr-8'>
					<DialogTitle className='text-sm'>
						{isCreate
							? t('linear:issue-editor.title-create', 'New issue')
							: t('linear:issue-editor.title-edit', 'Edit {{identifier}}', {
									identifier: issue?.identifier ?? '',
								})}
					</DialogTitle>
					{isCreate ? null : (
						<span className='truncate text-muted-foreground text-xs'>
							{issue?.teamName}
						</span>
					)}
					{isCreate ? (
						<IssueEditorTeamPicker
							accountFailures={accountFailures}
							metadata={metadata}
							onChange={(teamId) => update(buildTeamChangeFields(teamId))}
							value={fields.teamId}
						/>
					) : null}
					<DialogDescription className='sr-only'>
						{isCreate
							? t(
									'linear:issue-editor.description-create',
									'Create an issue in a connected Linear workspace. The team you choose decides which organization it lands in.',
								)
							: t(
									'linear:issue-editor.description-edit',
									'Update fields where your Linear permissions allow.',
								)}
					</DialogDescription>
				</DialogHeader>

				<div className='mt-4 flex flex-col gap-1'>
					<Input
						autoFocus
						aria-label={t('linear:issue-editor.field.title', 'Issue title')}
						className='h-auto border-0 bg-transparent px-0 font-medium text-base focus-visible:border-0 focus-visible:ring-0 md:text-base dark:bg-transparent'
						onChange={(event) => update({ title: event.target.value })}
						placeholder={t('linear:issue-editor.field.title', 'Issue title')}
						value={fields.title}
					/>
					<Textarea
						aria-label={t(
							'linear:issue-editor.field.description',
							'Issue description',
						)}
						className='max-h-64 min-h-20 resize-none px-0 focus-visible:ring-0'
						onChange={(event) => update({ description: event.target.value })}
						placeholder={t(
							'linear:issue-editor.field.description-placeholder',
							'Add a description…',
						)}
						value={fields.description}
						variant='bare'
					/>
				</div>

				<div className='mt-4 border-t pt-4'>
					<IssueEditorMetaRow
						accountId={accountId}
						fields={fields}
						metadata={metadata}
						update={update}
					/>
					{isCreate && !fields.teamId ? (
						<p className='mt-2 text-muted-foreground text-xs'>
							{t(
								'linear:issue-editor.team-first',
								'Choose a team to set status, assignee, project, cycle, and labels.',
							)}
						</p>
					) : null}
				</div>

				<DialogFooter className='mt-5 items-center sm:justify-between'>
					{error ? (
						<p
							className='flex items-center gap-1.5 text-status-danger text-xs'
							role='alert'
						>
							<AlertCircleIcon className='size-3.5 shrink-0' />
							{error}
						</p>
					) : (
						<span className='hidden text-muted-foreground text-xs sm:inline'>
							{t('linear:issue-editor.submit-hint', '{{chord}} to save', {
								chord: formatChord(['mod'], 'Enter'),
							})}
						</span>
					)}
					<span className='flex items-center gap-2'>
						<Button
							onClick={() => onOpenChange(false)}
							size='sm'
							variant='ghost'
						>
							{t('common:actions.cancel', 'Cancel')}
						</Button>
						<Button
							disabled={!canSubmit}
							onClick={submit}
							pending={isSaving}
							size='sm'
						>
							{isCreate
								? t('linear:issue-editor.submit-create', 'Create issue')
								: t('linear:issue-editor.submit-edit', 'Save changes')}
						</Button>
					</span>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
