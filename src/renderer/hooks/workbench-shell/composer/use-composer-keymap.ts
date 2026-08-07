import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMemo } from 'react';

import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type { AutocompleteKind } from '@/renderer/types/workbench';

/**
 * Keyboard bindings for the composer textarea: autocomplete navigation and
 * confirm, backspace-removes-the-last-mention, send, and explicit queue.
 *
 * Each binding returns `false` when it does not apply, which hands the key back
 * to the textarea's native handling — that is how Enter still inserts a newline
 * with no autocomplete open, and how Backspace still deletes a character while
 * the draft has text.
 * @param input - What is currently open, what can be acted on, and the actions
 * @returns The keydown handler to bind to the textarea
 */
export function useComposerKeymap({
	autocompleteKind,
	canConfirmAutocomplete,
	canRemoveLastMention,
	onConfirmAutocomplete,
	onDismissAutocomplete,
	onQueue,
	onRemoveLastMention,
	onStepActiveIndex,
	onSubmit,
	submitsOnBareEnter,
}: {
	autocompleteKind: AutocompleteKind;
	canConfirmAutocomplete: boolean;
	canRemoveLastMention: boolean;
	onConfirmAutocomplete: () => void;
	onDismissAutocomplete: () => void;
	onQueue: () => void;
	onRemoveLastMention: () => void;
	onStepActiveIndex: (delta: number) => void;
	onSubmit: () => void;
	submitsOnBareEnter: boolean;
}): (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void {
	const keymapBindings = useMemo<readonly KeymapBinding<HTMLTextAreaElement>[]>(
		() => [
			[
				'autocomplete.next',
				() => {
					if (!canConfirmAutocomplete) {
						return false;
					}
					onStepActiveIndex(1);
				},
			],
			[
				'autocomplete.prev',
				() => {
					if (!canConfirmAutocomplete) {
						return false;
					}
					onStepActiveIndex(-1);
				},
			],
			[
				'autocomplete.confirm',
				() => {
					if (!canConfirmAutocomplete) {
						return false;
					}
					onConfirmAutocomplete();
				},
			],
			[
				'autocomplete.dismiss',
				() => {
					if (autocompleteKind === null) {
						return false;
					}
					onDismissAutocomplete();
				},
			],
			[
				'composer.removeLastMention',
				() => {
					if (!canRemoveLastMention) {
						return false;
					}
					onRemoveLastMention();
				},
			],
			[
				'composer.submit',
				(event) => {
					if (event.nativeEvent.isComposing) {
						return false;
					}
					// In "Cmd + Enter" mode a bare Enter inserts a newline instead
					// (fall through to the textarea's native handling).
					if (!submitsOnBareEnter) {
						return false;
					}
					onSubmit();
				},
			],
			[
				'composer.submitWithMod',
				(event) => {
					if (event.nativeEvent.isComposing) {
						return false;
					}
					onSubmit();
				},
			],
			[
				'composer.queue',
				() => {
					onQueue();
				},
			],
		],
		[
			autocompleteKind,
			canConfirmAutocomplete,
			canRemoveLastMention,
			onConfirmAutocomplete,
			onDismissAutocomplete,
			onQueue,
			onRemoveLastMention,
			onStepActiveIndex,
			onSubmit,
			submitsOnBareEnter,
		],
	);

	return useKeymapHandler(keymapBindings);
}
