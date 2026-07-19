import { useLayoutEffect, useRef } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';

/** Values and actions used by the pull-request details editor. */
interface PrDetailsFormProps {
	canSave: boolean;
	description: string;
	isDirty: boolean;
	isReadOnly: boolean;
	onDescriptionChange: (value: string) => void;
	onDiscard: () => void;
	onSave: () => void;
	onTitleChange: (value: string) => void;
	title: string;
}

/** Shows auto-growing pull-request details, locking edits after merge. */
export function PrDetailsForm({
	canSave,
	description,
	isDirty,
	isReadOnly,
	onDescriptionChange,
	onDiscard,
	onSave,
	onTitleChange,
	title,
}: PrDetailsFormProps) {
	const descriptionRef = useRef<HTMLTextAreaElement>(null);

	// Resize to fit content on every value change, including the initial PR seed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measures on description change; the body reads scrollHeight rather than description directly.
	useLayoutEffect(() => {
		const el = descriptionRef.current;
		if (!el) {
			return;
		}
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight}px`;
	}, [description]);

	return (
		<section className='flex min-w-0 flex-col gap-0.5'>
			<Input
				aria-label='PR title'
				autoCapitalize='off'
				autoComplete='off'
				autoCorrect='off'
				className='h-auto border-0 bg-transparent px-0 py-0 font-medium text-sm leading-tight shadow-none focus-visible:ring-0 dark:bg-transparent'
				onChange={(event) => onTitleChange(event.target.value)}
				onKeyDown={(event) => {
					if (isReadOnly) {
						return;
					}
					if (event.key === 'Enter') {
						event.preventDefault();
						if (canSave) {
							onSave();
						}
					} else if (event.key === 'Escape' && isDirty) {
						event.preventDefault();
						onDiscard();
					}
				}}
				placeholder='PR title'
				readOnly={isReadOnly}
				spellCheck={false}
				value={title}
			/>
			<textarea
				aria-label='PR description'
				autoCapitalize='off'
				autoComplete='off'
				autoCorrect='off'
				className='sleek-scrollbar max-h-[11.25rem] min-h-8 w-full resize-none overflow-auto border-none bg-transparent text-muted-foreground text-xs leading-snug outline-none placeholder:text-muted-foreground'
				onChange={(event) => onDescriptionChange(event.target.value)}
				onKeyDown={(event) => {
					if (isReadOnly) {
						return;
					}
					// Enter inserts a newline here; only Escape discards.
					if (event.key === 'Escape' && isDirty) {
						event.preventDefault();
						onDiscard();
					}
				}}
				placeholder='PR description'
				readOnly={isReadOnly}
				ref={descriptionRef}
				rows={1}
				spellCheck={false}
				value={description}
			/>
			{isDirty && !isReadOnly ? (
				<div className='flex items-center justify-end gap-1.5 pt-1'>
					<Button onClick={onDiscard} size='sm' variant='ghost'>
						Discard
					</Button>
					<Button disabled={!canSave} onClick={onSave} size='sm'>
						Save
					</Button>
				</div>
			) : null}
		</section>
	);
}
