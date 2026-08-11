import { useSetAtom } from 'jotai';
import { type RefObject, useCallback, useState } from 'react';

import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { detectAutocomplete } from '@/renderer/hooks/workbench-shell/composer/use-autocomplete';
import { useMentionMatches } from '@/renderer/hooks/workbench-shell/composer/use-mention-matches';
import { useSlashCommands } from '@/renderer/hooks/workbench-shell/composer/use-slash-commands';
import { useSlashMatches } from '@/renderer/hooks/workbench-shell/composer/use-slash-matches';
import { resolveComposerProvider } from '@/renderer/lib/workbench/composer';
import { workspaceFileAttachment } from '@/renderer/lib/workbench/composer-attachments';
import {
	recordSlashCommandUse,
	slashCommandUsageAtom,
} from '@/renderer/state/slash-commands';
import type {
	AutocompleteKind,
	AutocompleteState,
	ComposerShellState,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';

/** Default empty autocomplete state — caret outside any `@` or `/` token. */
const EMPTY_AUTOCOMPLETE: AutocompleteState = {
	kind: null,
	query: '',
	tokenStart: 0,
	tokenEnd: 0,
};

/**
 * Steps the autocomplete highlight, clamping the stored index into the list
 * first so a list that shrank under it still steps from the row on screen.
 * @param stored - The index currently held in state, which may be out of range.
 * @param delta - How far to move, positive or negative.
 * @param total - How many rows the list currently offers.
 * @returns The index to highlight next.
 */
function stepActiveIndex(stored: number, delta: number, total: number): number {
	return (Math.min(stored, Math.max(0, total - 1)) + delta + total) % total;
}

/**
 * The span a mention pick replaces. A chip already reads as one space in the
 * draft, so the spaces around the `@` token go with it — otherwise every pick
 * would leave a double space where the token used to be.
 * @param value - The whole draft
 * @param token - Where the detected token starts and ends
 * @returns The span the chip is written over
 */
function mentionReplacementRange(
	value: string,
	token: { tokenEnd: number; tokenStart: number },
): { end: number; start: number } {
	return {
		end: value[token.tokenEnd] === ' ' ? token.tokenEnd + 1 : token.tokenEnd,
		start:
			token.tokenStart > 0 && value[token.tokenStart - 1] === ' '
				? token.tokenStart - 1
				: token.tokenStart,
	};
}

/**
 * The composer's `@`-mention and `/`-command autocomplete: detects the token
 * under the caret, scores matches against it, tracks the highlighted row, and
 * applies a pick back into the draft.
 *
 * A `/`-command picked on an otherwise empty draft submits straight away; every
 * other pick rewrites the token in place — a mention becomes a chip sitting
 * where the token was, so the attachment stays in the sentence.
 * @param input - The live draft, the composer shell, and the sinks a pick writes to
 * @returns The open state, the match lists, and the handlers the editor binds to
 */
export function useComposerAutocomplete({
	composer,
	editorRef,
	onSubmitSlashCommand,
	setAttachmentError,
	value,
}: {
	composer: ComposerShellState;
	editorRef: RefObject<ComposerEditorHandle | null>;
	onSubmitSlashCommand: (text: string) => void;
	setAttachmentError: (error: string | null) => void;
	value: string;
}) {
	const [autocomplete, setAutocomplete] =
		useState<AutocompleteState>(EMPTY_AUTOCOMPLETE);
	const [activeIndex, setActiveIndex] = useState(0);

	const mentionOpen = autocomplete.kind === 'mention';
	const slashOpen = autocomplete.kind === 'slash';

	const mentionMatches = useMentionMatches(
		composer.workspaceFiles,
		mentionOpen ? autocomplete.query : '',
	);
	const slashCatalogue = useSlashCommands(
		resolveComposerProvider(composer),
		composer.workspaceCwd,
		slashOpen,
	);
	const slashMatches = useSlashMatches(
		slashCatalogue.commands,
		slashOpen ? autocomplete.query : '',
		slashOpen,
	);
	const recordSlashUsage = useSetAtom(slashCommandUsageAtom);

	const updateAutocomplete = useCallback((nextValue: string, caret: number) => {
		setAutocomplete(detectAutocomplete(nextValue, caret));
		setActiveIndex(0);
	}, []);

	const dismissAutocomplete = useCallback(() => {
		setAutocomplete(EMPTY_AUTOCOMPLETE);
		setActiveIndex(0);
	}, []);

	const replaceToken = useCallback(
		(insert: string) => {
			editorRef.current?.replaceRangeWithText(
				autocomplete.tokenStart,
				autocomplete.tokenEnd,
				`${insert} `,
			);
			dismissAutocomplete();
		},
		[autocomplete, dismissAutocomplete, editorRef],
	);

	const onMentionSelect = useCallback(
		(entry: WorkspaceFileSummary) => {
			setAttachmentError(null);
			const range = mentionReplacementRange(value, autocomplete);
			editorRef.current?.replaceRangeWithAttachment(
				range.start,
				range.end,
				workspaceFileAttachment(entry),
			);
			dismissAutocomplete();
		},
		[autocomplete, dismissAutocomplete, editorRef, setAttachmentError, value],
	);

	const onSlashSelect = useCallback(
		(command: string, autoSubmit: boolean) => {
			recordSlashUsage((usage) =>
				recordSlashCommandUse(usage, command, Date.now()),
			);
			const slashText = `/${command}`;
			const outsideToken =
				value.slice(0, autocomplete.tokenStart) +
				value.slice(autocomplete.tokenEnd);
			if (autoSubmit && outsideToken.trim().length === 0) {
				dismissAutocomplete();
				onSubmitSlashCommand(slashText);
				return;
			}
			replaceToken(slashText);
		},
		[
			autocomplete,
			dismissAutocomplete,
			onSubmitSlashCommand,
			recordSlashUsage,
			replaceToken,
			value,
		],
	);

	const autocompleteKind: AutocompleteKind = autocomplete.kind;
	const autocompleteTotal = mentionOpen
		? mentionMatches.length
		: slashMatches.length * Number(slashOpen);
	// The list can shrink under a stored index — a mention list narrows while the
	// token is untouched — which would strand the highlight off the end and make
	// Enter a silent no-op. The slash catalogue is additionally held steady for as
	// long as its menu is open, because a reorder under the highlight would make
	// Enter run a different command rather than none.
	const safeActiveIndex = Math.min(
		activeIndex,
		Math.max(0, autocompleteTotal - 1),
	);

	const confirmAutocomplete = useCallback(() => {
		if (mentionOpen) {
			const match = mentionMatches[safeActiveIndex];
			if (match) {
				onMentionSelect(match.entry);
			}
			return;
		}
		const match = slashMatches[safeActiveIndex];
		if (match) {
			onSlashSelect(match.item.command, match.item.autoSubmit);
		}
	}, [
		mentionOpen,
		mentionMatches,
		onMentionSelect,
		onSlashSelect,
		safeActiveIndex,
		slashMatches,
	]);

	return {
		activeIndex: safeActiveIndex,
		autocomplete,
		autocompleteActive: autocompleteKind !== null && autocompleteTotal > 0,
		autocompleteKind,
		autocompleteTotal,
		confirmAutocomplete,
		dismissAutocomplete,
		mentionMatches,
		onMentionSelect,
		onSlashSelect,
		setActiveIndex,
		slashLoading: slashOpen && slashCatalogue.loading,
		slashMatches,
		stepActive: useCallback(
			(delta: number) => {
				setActiveIndex((stored) =>
					stepActiveIndex(stored, delta, autocompleteTotal),
				);
			},
			[autocompleteTotal],
		),
		updateAutocomplete,
	};
}
