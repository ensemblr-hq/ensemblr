import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { RunScriptIcon } from '@/renderer/components/run-script-icon';
import { SettingsEmptyState } from '@/renderer/components/settings/settings-empty-state';
import { Button } from '@/renderer/components/ui/button';
import {
	formatRunScriptLabel,
	isRunScriptAvailableLocally,
	type RunScriptDefinition,
} from '@/shared/scripts';

import { RunScriptEditorDialog } from './run-script-editor-dialog';

/** Which script the editor dialog is open for, if any. */
type EditorTarget = { kind: 'add' } | { kind: 'edit'; name: string };

/**
 * Repository run scripts editor: the list the dock's Run menu offers, with add,
 * edit, and delete. Every entry is editable — the list is written straight back
 * to the repository's committed `.ensemblr/settings.toml`.
 */
export function RunScriptsSection({
	onChange,
	scripts,
}: {
	onChange: (scripts: RunScriptDefinition[]) => void;
	scripts: readonly RunScriptDefinition[];
}) {
	const { t } = useTranslation();
	const [target, setTarget] = useState<EditorTarget | null>(null);
	const editing =
		target?.kind === 'edit'
			? (scripts.find((script) => script.name === target.name) ?? null)
			: null;

	const submit = (next: RunScriptDefinition): void => {
		onChange(applyRunScriptEdit({ editing, next, scripts }));
		setTarget(null);
	};

	return (
		<div className='py-4'>
			<div className='flex items-start justify-between gap-6'>
				<div className='min-w-0 flex-1 space-y-1'>
					<p className='font-medium text-foreground text-sm'>
						{t('settings:run-scripts.title', 'Run scripts')}
					</p>
					<p className='max-w-prose text-muted-foreground text-xs leading-relaxed'>
						<Trans
							components={{ port: <code /> }}
							defaults="Shortcuts for quick actions, like running your dev server or test suite. Use <port>$ENSEMBLR_PORT</port> for the workspace's allocated port."
							i18nKey='settings:run-scripts.description'
						/>
					</p>
				</div>
				<Button
					onClick={() => setTarget({ kind: 'add' })}
					size='sm'
					type='button'
					variant='outline'
				>
					<PlusIcon data-icon='inline-start' />
					{t('common:actions.add', 'Add')}
				</Button>
			</div>

			{scripts.length === 0 ? (
				<SettingsEmptyState
					className='mt-3'
					description={t(
						'settings:run-scripts.empty-description',
						'Add one and it shows up in the terminal panel’s Run menu.',
					)}
					title={t('settings:run-scripts.empty', 'No run scripts yet')}
				/>
			) : (
				<ul className='mt-3 space-y-2'>
					{scripts.map((script) => (
						<RunScriptRow
							key={script.name}
							onDelete={() =>
								onChange(scripts.filter((entry) => entry.name !== script.name))
							}
							onEdit={() => setTarget({ kind: 'edit', name: script.name })}
							script={script}
						/>
					))}
				</ul>
			)}

			<RunScriptEditorDialog
				nameConflicts={(name) =>
					scripts.some(
						(script) => script.name === name && script.name !== editing?.name,
					)
				}
				onOpenChange={(open) => {
					if (!open) {
						setTarget(null);
					}
				}}
				onSubmit={submit}
				open={target !== null}
				script={editing}
			/>
		</div>
	);
}

/** One configured run script: icon, name, command, and its edit/delete controls. */
function RunScriptRow({
	onDelete,
	onEdit,
	script,
}: {
	onDelete: () => void;
	onEdit: () => void;
	script: RunScriptDefinition;
}) {
	const { t } = useTranslation();

	return (
		<li className='flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2'>
			<span className='grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground'>
				<RunScriptIcon className='size-4' name={script.icon} />
			</span>
			<div className='min-w-0 flex-1'>
				<p className='flex items-center gap-2 text-sm'>
					{formatRunScriptLabel(script.name)}
					{script.isDefault ? (
						<span className='text-muted-foreground text-xs'>
							{t('settings:run-scripts.row.default', 'Default')}
						</span>
					) : null}
					{isRunScriptAvailableLocally(script) ? null : (
						<span className='text-muted-foreground text-xs'>
							{t(
								'settings:run-scripts.row.unavailable',
								'Not available locally',
							)}
						</span>
					)}
				</p>
				<p className='truncate font-mono text-muted-foreground text-xs'>
					{script.command}
				</p>
			</div>
			<Button
				aria-label={t(
					'settings:run-scripts.row.edit-aria-label',
					'Edit {{name}}',
					{ name: script.name },
				)}
				onClick={onEdit}
				size='icon-sm'
				type='button'
				variant='ghost'
			>
				<PencilIcon aria-hidden='true' />
			</Button>
			<Button
				aria-label={t(
					'settings:run-scripts.row.delete-aria-label',
					'Delete {{name}}',
					{ name: script.name },
				)}
				onClick={onDelete}
				size='icon-sm'
				type='button'
				variant='ghost'
			>
				<Trash2Icon aria-hidden='true' />
			</Button>
		</li>
	);
}

/**
 * Folds an add or edit into the run-script list, keeping declaration order and
 * enforcing a single default so the dock never has to break a tie.
 * @param input - The edited script, the entry it replaces, and the current list.
 * @returns The next list.
 */
function applyRunScriptEdit({
	editing,
	next,
	scripts,
}: {
	editing: RunScriptDefinition | null;
	next: RunScriptDefinition;
	scripts: readonly RunScriptDefinition[];
}): RunScriptDefinition[] {
	const replaced = editing
		? scripts.map((script) => (script.name === editing.name ? next : script))
		: [...scripts, next];

	if (!next.isDefault) {
		return replaced;
	}

	return replaced.map((script) =>
		script.name === next.name ? script : { ...script, isDefault: false },
	);
}
