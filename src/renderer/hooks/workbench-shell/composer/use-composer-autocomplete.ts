import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useState,
} from 'react';

import {
	detectAutocomplete,
	useFuzzyMatches,
} from '@/renderer/hooks/workbench-shell/composer/use-autocomplete';
import { useMentionMatches } from '@/renderer/hooks/workbench-shell/composer/use-mention-matches';
import { useSlashCommands } from '@/renderer/hooks/workbench-shell/composer/use-slash-commands';
import { resolveComposerProvider } from '@/renderer/lib/workbench/composer';
import type {
	AutocompleteKind,
	AutocompleteState,
	ComposerShellState,
	SlashCommandDescriptor,
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
 * Module-level so `useFuzzyMatches` keeps its memo across renders; an inline
 * arrow would be a fresh dependency every render and rescore the whole
 * catalogue on each keystroke.
 * @param entry - Slash command being scored.
 * @returns The text the fuzzy query is matched against.
 */
function getSlashCommandKey(entry: SlashCommandDescriptor): string {
	return entry.command;
}

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
 * Splits the draft around the token the caret sits in, so a pick can rewrite
 * just that token and leave the rest of the sentence intact.
 * @param value - The whole draft
 * @param token - Where the detected token starts and ends
 * @returns The text before and after the token
 */
function splitAroundToken(
	value: string,
	token: { tokenEnd: number; tokenStart: number },
): { after: string; before: string } {
	return {
		after: value.slice(token.tokenEnd),
		before: value.slice(0, token.tokenStart),
	};
}

/**
 * The composer's `@`-mention and `/`-command autocomplete: detects the token
 * under the caret, scores matches against it, tracks the highlighted row, and
 * applies a pick back into the draft.
 *
 * A `/`-command picked on an otherwise empty draft submits straight away; every
 * other pick rewrites the token in place and restores the caret after it.
 * @param input - The live draft, the composer shell, and the sinks a pick writes to
 * @returns The open state, the match lists, and the handlers the textarea binds to
 */
export function useComposerAutocomplete({
	composer,
	onSubmitSlashCommand,
	setAttachmentError,
	setMentionAttachments,
	setValue,
	textareaRef,
	value,
}: {
	composer: ComposerShellState;
	onSubmitSlashCommand: (text: string) => void;
	setAttachmentError: (error: string | null) => void;
	setMentionAttachments: Dispatch<
		SetStateAction<readonly WorkspaceFileSummary[]>
	>;
	setValue: Dispatch<SetStateAction<string>>;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
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
	const slashMatches = useFuzzyMatches(
		slashCatalogue.commands,
		slashOpen ? autocomplete.query : '',
		getSlashCommandKey,
		80,
	);

	const updateAutocomplete = useCallback((nextValue: string, caret: number) => {
		setAutocomplete(detectAutocomplete(nextValue, caret));
		setActiveIndex(0);
	}, []);

	const dismissAutocomplete = useCallback(() => {
		setAutocomplete(EMPTY_AUTOCOMPLETE);
		setActiveIndex(0);
	}, []);

	/** Restores focus and the caret after a pick has rewritten the draft. */
	const restoreCaret = useCallback(
		(caret: number) => {
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) {
					return;
				}
				textarea.focus();
				textarea.setSelectionRange(caret, caret);
			});
		},
		[textareaRef],
	);

	const replaceToken = useCallback(
		(insert: string, keepTrailingSpace = true) => {
			const { after, before } = splitAroundToken(value, autocomplete);
			const trailing = keepTrailingSpace ? ' ' : '';
			setValue(`${before}${insert}${trailing}${after}`);
			dismissAutocomplete();
			restoreCaret(before.length + insert.length + trailing.length);
		},
		[autocomplete, dismissAutocomplete, restoreCaret, value, setValue],
	);

	const onMentionSelect = useCallback(
		(entry: WorkspaceFileSummary) => {
			// Drop the @query token from textarea, push file onto chip list
			setAttachmentError(null);
			const { after, before } = splitAroundToken(value, autocomplete);
			const trimmedBefore = before.trimEnd();
			setValue(
				`${trimmedBefore}${trimmedBefore.length > 0 ? ' ' : ''}${after.trimStart()}`,
			);
			setMentionAttachments((prev) =>
				prev.some((existing) => existing.path === entry.path)
					? prev
					: [...prev, entry],
			);
			dismissAutocomplete();
			restoreCaret(trimmedBefore.length + 1);
		},
		[
			autocomplete,
			dismissAutocomplete,
			restoreCaret,
			setAttachmentError,
			setMentionAttachments,
			setValue,
			value,
		],
	);

	const onSlashSelect = useCallback(
		(command: string, autoSubmit: boolean) => {
			const { after, before } = splitAroundToken(value, autocomplete);
			const slashText = `/${command}`;
			const replacesWholeDraft =
				before.trim().length === 0 && after.trim().length === 0;
			if (autoSubmit && replacesWholeDraft) {
				dismissAutocomplete();
				setValue('');
				onSubmitSlashCommand(slashText);
				return;
			}
			replaceToken(slashText);
		},
		[
			autocomplete,
			dismissAutocomplete,
			onSubmitSlashCommand,
			replaceToken,
			setValue,
			value,
		],
	);

	const autocompleteKind: AutocompleteKind = autocomplete.kind;
	const autocompleteTotal = mentionOpen
		? mentionMatches.length
		: slashMatches.length * Number(slashOpen);
	// The list can shrink under a stored index — a slash catalogue refetch drops
	// entries while the token is untouched — which would strand the highlight off
	// the end and make Enter a silent no-op.
	const safeActiveIndex = Math.min(
		activeIndex,
		Math.max(0, autocompleteTotal - 1),
	);

	const confirmAutocomplete = useCallback(() => {
		if (mentionOpen) {
			const match = mentionMatches[safeActiveIndex];
			if (match) {
				onMentionSelect(match);
			}
			return;
		}
		const match = slashMatches[safeActiveIndex];
		if (match) {
			onSlashSelect(match.command, match.autoSubmit);
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
		/** Re-detects the token under the caret after a click or arrow move. */
		handleSelect: useCallback(() => {
			const textarea = textareaRef.current;
			if (!textarea) {
				return;
			}
			updateAutocomplete(
				textarea.value,
				textarea.selectionStart ?? textarea.value.length,
			);
		}, [textareaRef, updateAutocomplete]),
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
