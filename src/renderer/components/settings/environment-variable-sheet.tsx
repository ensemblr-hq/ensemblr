import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import {
	ensembleQueryKeys,
	readEnvironmentVariableValue,
	setEnvironmentVariable,
} from '@/renderer/api/ensemble';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from '@/renderer/components/ui/sheet';
import { Textarea } from '@/renderer/components/ui/textarea';
import type { EnvironmentVariableScope } from '@/shared/ipc/contracts/environment';

/** The variable a sheet opens for: a brand-new entry or an existing key. */
export interface EnvironmentVariableSheetTarget {
	/** Pre-filled key (documented add or edit); empty for a blank add. */
	key: string;
	/** True when editing an existing variable (loads the current value). */
	isEdit: boolean;
}

interface EnvironmentVariableSheetProps {
	scope: EnvironmentVariableScope;
	scopeId?: string;
	target: EnvironmentVariableSheetTarget | null;
	onClose: () => void;
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Right slide-over form for creating or editing one environment variable. */
export function EnvironmentVariableSheet({
	onClose,
	scope,
	scopeId,
	target,
}: EnvironmentVariableSheetProps) {
	const queryClient = useQueryClient();
	const nameId = useId();
	const valueId = useId();
	const [name, setName] = useState('');
	const [value, setValue] = useState('');
	const [error, setError] = useState<string | null>(null);

	const isEdit = target?.isEdit ?? false;
	const previousKey = target?.key ?? '';
	// Name is fixed when the key is preset: editing an existing variable, or
	// adding a documented catalog variable from the list.
	const nameLocked = previousKey !== '';
	// Only a documented catalog add (preset key, not an edit) gets the hint.
	const isDocumentedAdd = nameLocked && !isEdit;

	// Reset the form whenever a new target opens; load the existing value on edit.
	useEffect(() => {
		if (!target) {
			return;
		}

		setName(target.key);
		setValue('');
		setError(null);

		if (!target.isEdit) {
			return;
		}

		let cancelled = false;
		void readEnvironmentVariableValue({ key: target.key, scope, scopeId }).then(
			(result) => {
				if (!cancelled) {
					setValue(result.value ?? '');
				}
			},
		);

		return () => {
			cancelled = true;
		};
	}, [target, scope, scopeId]);

	const mutation = useMutation({
		mutationFn: () =>
			setEnvironmentVariable({
				key: name.trim(),
				previousKey: isEdit ? previousKey : undefined,
				scope,
				scopeId,
				value,
			}),
		onSuccess: async (result) => {
			if (result.error) {
				setError(result.error);
				return;
			}

			await queryClient.invalidateQueries({
				queryKey: ensembleQueryKeys.environmentVariables(),
			});
			onClose();
		},
	});

	const trimmedName = name.trim();
	const nameValid = KEY_PATTERN.test(trimmedName);
	// Documented catalog vars may be set to an empty string; everything else
	// (custom adds and edits) requires a value.
	const valueRequired = !isDocumentedAdd;
	const valueValid = !valueRequired || value.length > 0;
	const canSave = nameValid && valueValid && !mutation.isPending;

	const handleSubmit = () => {
		setError(null);

		if (!nameValid) {
			setError(
				'Variable names may only contain letters, numbers, and underscores.',
			);
			return;
		}

		if (!valueValid) {
			setError('A value is required.');
			return;
		}

		mutation.mutate();
	};

	return (
		<Sheet
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={target !== null}
		>
			<SheetContent className='w-[28rem] sm:max-w-none'>
				<SheetHeader>
					<SheetTitle>
						{isEdit ? 'Edit environment variable' : 'Add environment variable'}
					</SheetTitle>
					<SheetDescription>
						Variable names may only contain letters, numbers, and underscores.
					</SheetDescription>
				</SheetHeader>
				<form
					className='flex min-h-0 flex-1 flex-col gap-4 px-4'
					onSubmit={(event) => {
						event.preventDefault();
						handleSubmit();
					}}
				>
					<div className='flex flex-col gap-1.5'>
						<Label htmlFor={nameId}>Name</Label>
						<Input
							autoFocus={!nameLocked}
							disabled={nameLocked}
							id={nameId}
							onChange={(event) => setName(event.target.value)}
							placeholder='MY_VARIABLE'
							spellCheck={false}
							value={name}
						/>
					</div>
					<div className='flex min-h-0 flex-1 flex-col gap-1.5'>
						<Label htmlFor={valueId}>Value</Label>
						<Textarea
							autoFocus={nameLocked}
							className='min-h-70 font-mono text-sm'
							id={valueId}
							onChange={(event) => setValue(event.target.value)}
							placeholder={
								isDocumentedAdd
									? 'Use an empty value to set this variable to an empty string.'
									: undefined
							}
							spellCheck={false}
							value={value}
						/>
					</div>
					{error ? <p className='text-sm text-status-danger'>{error}</p> : null}
				</form>
				<SheetFooter className='flex-row justify-end gap-2'>
					<Button onClick={onClose} type='button' variant='ghost'>
						Cancel
					</Button>
					<Button
						disabled={!canSave}
						onClick={handleSubmit}
						type='button'
						variant='default'
					>
						{mutation.isPending ? 'Saving…' : 'Save'}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
