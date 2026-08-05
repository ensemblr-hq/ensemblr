import { useEffect, useState } from 'react';

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
import { Switch } from '@/renderer/components/ui/switch';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	DEFAULT_RUN_SCRIPT_ICON,
	type RunScriptDefinition,
} from '@/shared/scripts';

import { RunScriptIconPicker } from './run-script-icon-picker';

/** A blank run script, used to seed the dialog when adding rather than editing. */
const BLANK_RUN_SCRIPT: RunScriptDefinition = {
	availableIn: null,
	command: '',
	icon: DEFAULT_RUN_SCRIPT_ICON,
	isDefault: false,
	name: '',
};

/**
 * Add/edit dialog for one named run script. Editing is transactional — the
 * caller only sees the change on save — so an abandoned edit never persists a
 * half-typed command to a repository's settings.
 */
export function RunScriptEditorDialog({
	nameConflicts,
	onOpenChange,
	onSubmit,
	open,
	script,
}: {
	/** Rejects a rename onto another script's name. */
	nameConflicts: (name: string) => boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (script: RunScriptDefinition) => void;
	open: boolean;
	/** Script being edited, or null when adding a new one. */
	script: RunScriptDefinition | null;
}) {
	const [draft, setDraft] = useState<RunScriptDefinition>(
		script ?? BLANK_RUN_SCRIPT,
	);

	useEffect(() => {
		if (open) {
			setDraft(script ?? BLANK_RUN_SCRIPT);
		}
	}, [open, script]);

	const { canSave, duplicateName, trimmedName } = validateDraft(
		draft,
		nameConflicts,
	);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className='sm:max-w-lg'>
				<DialogHeader>
					<DialogTitle>
						{script ? 'Edit run script' : 'Add run script'}
					</DialogTitle>
					<DialogDescription>
						Shortcuts for quick actions, like running your dev server or test
						suite. Use <code>$ENSEMBLR_PORT</code> for this workspace's
						allocated port.
					</DialogDescription>
				</DialogHeader>

				<RunScriptEditorFields
					draft={draft}
					duplicateName={duplicateName}
					onChange={setDraft}
				/>

				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						type='button'
						variant='ghost'
					>
						Cancel
					</Button>
					<Button
						disabled={!canSave}
						onClick={() =>
							onSubmit({
								...draft,
								command: draft.command.trim(),
								name: trimmedName,
							})
						}
						type='button'
					>
						{script ? 'Save' : 'Add'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Checks whether a draft can be saved: it needs a name and a command, and the
 * name must not already belong to another script.
 * @param draft - The in-progress script.
 * @param nameConflicts - Reports whether a name is taken by a different script.
 * @returns The trimmed name plus the save and duplicate flags.
 */
function validateDraft(
	draft: RunScriptDefinition,
	nameConflicts: (name: string) => boolean,
): { canSave: boolean; duplicateName: boolean; trimmedName: string } {
	const trimmedName = draft.name.trim();
	const duplicateName = trimmedName.length > 0 && nameConflicts(trimmedName);

	return {
		canSave:
			trimmedName.length > 0 && Boolean(draft.command.trim()) && !duplicateName,
		duplicateName,
		trimmedName,
	};
}

/** Name, icon, command, and default-flag fields of the run-script editor. */
function RunScriptEditorFields({
	draft,
	duplicateName,
	onChange,
}: {
	draft: RunScriptDefinition;
	/** True when the typed name already belongs to another script. */
	duplicateName: boolean;
	onChange: (next: RunScriptDefinition) => void;
}) {
	return (
		<div className='space-y-4'>
			<div className='space-y-1.5'>
				<label className='font-medium text-sm' htmlFor='run-script-name'>
					Name
				</label>
				<div className='flex gap-2'>
					<RunScriptIconPicker
						onChange={(icon) => onChange({ ...draft, icon })}
						value={draft.icon}
					/>
					<Input
						autoFocus
						id='run-script-name'
						onChange={(event) =>
							onChange({ ...draft, name: event.target.value })
						}
						placeholder='dev'
						value={draft.name}
					/>
				</div>
				{duplicateName ? (
					<p className='text-destructive text-xs'>
						Another run script already uses this name.
					</p>
				) : null}
			</div>

			<div className='space-y-1.5'>
				<label className='font-medium text-sm' htmlFor='run-script-command'>
					Command
				</label>
				<Textarea
					className='min-h-18 font-mono text-xs'
					id='run-script-command'
					onChange={(event) =>
						onChange({ ...draft, command: event.target.value })
					}
					placeholder='PORT=$ENSEMBLR_PORT npm run dev'
					value={draft.command}
				/>
			</div>

			<div className='flex items-center justify-between gap-4'>
				<div>
					<p className='font-medium text-sm'>Default</p>
					<p className='text-muted-foreground text-xs'>
						Runs when you press ⌘R in a workspace that has no other pick.
					</p>
				</div>
				<Switch
					checked={draft.isDefault}
					onCheckedChange={(isDefault) => onChange({ ...draft, isDefault })}
				/>
			</div>
		</div>
	);
}
