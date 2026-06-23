import { useLayoutEffect, useRef } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';

/**
 * Editable PR title + description inputs shown at the top of the Checks panel,
 * in place of the old status banner (the sidebar header already conveys PR
 * status). Seeds from the existing PR when one is open so an agent-authored PR
 * can be tweaked, and feeds the "Create PR" prompt for new ones.
 *
 * The description is a plain auto-growing textarea — it expands with its content
 * (capped, then scrolls with a sleek scrollbar) instead of a fixed box with a
 * drag handle. Discard/Save appear once the draft is dirty; Save persists the
 * title/description locally and is disabled until a title is present.
 */
export function PrDetailsForm({
	canSave,
	description,
	isDirty,
	onDescriptionChange,
	onDiscard,
	onSave,
	onTitleChange,
	title,
}: {
	canSave: boolean;
	description: string;
	isDirty: boolean;
	onDescriptionChange: (value: string) => void;
	onDiscard: () => void;
	onSave: () => void;
	onTitleChange: (value: string) => void;
	title: string;
}) {
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
					// Enter inserts a newline here; only Escape discards.
					if (event.key === 'Escape' && isDirty) {
						event.preventDefault();
						onDiscard();
					}
				}}
				placeholder='PR description'
				ref={descriptionRef}
				rows={1}
				spellCheck={false}
				value={description}
			/>
			{isDirty ? (
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
