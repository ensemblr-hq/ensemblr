import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMemo } from 'react';

import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type { AutocompleteKind } from '@/renderer/types/workbench';

/**
 * Keyboard bindings for the composer editor: autocomplete navigation and
 * confirm, send, explicit queue, and the send that bypasses the queue.
 *
 * Each binding returns `false` when it does not apply, which hands the key back
 * to the editor's own handling — that is how Enter still inserts a newline with
 * no autocomplete open. Backspace is not bound: an attachment is a node in the
 * document now, so the editor already deletes a whole chip on its own.
 * @param input - What is currently open, what can be acted on, and the actions
 * @returns The keydown handler to bind to the editor
 */
export function useComposerKeymap({
	autocompleteKind,
	canConfirmAutocomplete,
	onConfirmAutocomplete,
	onDismissAutocomplete,
	onQueue,
	onSendNow,
	onStepActiveIndex,
	onSubmit,
	submitsOnBareEnter,
}: {
	autocompleteKind: AutocompleteKind;
	canConfirmAutocomplete: boolean;
	onConfirmAutocomplete: () => void;
	onDismissAutocomplete: () => void;
	onQueue: () => void;
	onSendNow: () => void;
	onStepActiveIndex: (delta: number) => void;
	onSubmit: () => void;
	submitsOnBareEnter: boolean;
}): (event: ReactKeyboardEvent<HTMLElement>) => void {
	const keymapBindings = useMemo<readonly KeymapBinding<HTMLElement>[]>(
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
				'composer.sendNow',
				(event) => {
					if (event.nativeEvent.isComposing) {
						return false;
					}
					onSendNow();
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
			onConfirmAutocomplete,
			onDismissAutocomplete,
			onQueue,
			onSendNow,
			onStepActiveIndex,
			onSubmit,
			submitsOnBareEnter,
		],
	);

	return useKeymapHandler(keymapBindings);
}
