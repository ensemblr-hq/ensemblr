import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import {
	type DragEvent as ReactDragEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { conciergeContextPressureQuery } from '@/renderer/api/ensemblr';
import {
	type ConciergeComposerDraft,
	useConciergeComposerDraft,
} from '@/renderer/hooks/concierge/use-concierge-composer-draft';
import {
	type ConciergeModelSelection,
	useConciergeModelSelection,
} from '@/renderer/hooks/concierge/use-concierge-model-selection';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import { conciergeComposerFocusRequestAtom } from '@/renderer/state/concierge';
import { sendShortcutAtom } from '@/renderer/state/preferences';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type { ComposerContextUsage } from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import { formatShortcut } from '@/shared/keymap';

/** What one Concierge send carries beyond its prompt. */
export interface ConciergeSendSelection {
	model: string | null;
	provider: AgentProviderId;
	thinkingLevel: string | null;
}

/** Everything the Concierge composer renders from, already resolved. */
export interface ConciergeComposerModel {
	/** The window the gauge draws, or null until the runtime reports one. */
	contextUsage: ComposerContextUsage | null;
	draft: ConciergeComposerDraft;
	handleDragOver: (event: ReactDragEvent<HTMLElement>) => void;
	handleDrop: (event: ReactDragEvent<HTMLElement>) => void;
	handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	/** True across the draft read a send waits on, which is not instant. */
	isSending: boolean;
	selection: ConciergeModelSelection;
	send: () => void;
	/** The chord the send button names, per the Send shortcut setting. */
	sendShortcutHint: string;
}

/**
 * Drives the Concierge composer: its model pickers, its draft, its send, and the
 * keys and drops that reach it.
 *
 * Split from the component so the composer is left rendering a resolved model
 * rather than wiring six hooks together between its own JSX branches.
 * @param input - The Concierge home and what a send should do with the prompt.
 * @returns The resolved composer model.
 */
export function useConciergeComposer({
	cwd,
	disabled,
	onSubmit,
}: {
	cwd: string;
	disabled: boolean;
	onSubmit: (prompt: string, selection: ConciergeSendSelection) => void;
}): ConciergeComposerModel {
	const { t } = useTranslation();
	const sendShortcut = useAtomValue(sendShortcutAtom);
	const [isSending, setIsSending] = useState(false);
	const selection = useConciergeModelSelection();
	const pressure = useQuery(conciergeContextPressureQuery);

	const submitPrompt = useCallback(
		(prompt: string) => {
			if (!prompt.trim()) {
				return;
			}
			onSubmit(prompt, {
				model: selection.modelId,
				provider: selection.provider,
				thinkingLevel: selection.thinkingLevel,
			});
		},
		[onSubmit, selection.modelId, selection.provider, selection.thinkingLevel],
	);

	const draft = useConciergeComposerDraft({
		cwd,
		onSubmitSlashCommand: submitPrompt,
		provider: selection.provider,
	});

	const send = useCallback(() => {
		if (isSending || !draft.canSend || disabled) {
			return;
		}
		// The prompt is built from the draft's segments rather than its text, so a
		// dropped file reaches the agent as its contents rather than as the chip's
		// label. Read before clearing: clearing empties the segments. The latch is
		// what the draft cannot do for us — a chip's contents are read from disk, and
		// until that lands the draft still reads as sendable, so a second ⌘↵ inside
		// the read would submit the same prompt twice.
		setIsSending(true);
		draft
			.readPrompt()
			.then((prompt) => {
				draft.clear();
				submitPrompt(prompt);
			})
			.catch(() => {
				draft.reportError(
					t(
						'workbench:concierge.composer.prompt-failed',
						'The message could not be prepared for sending.',
					),
				);
			})
			.finally(() => setIsSending(false));
	}, [disabled, draft, isSending, submitPrompt, t]);

	// Both submit chords are always bound, and only the bare-Enter one answers to
	// the setting: ⌘↵ sends whichever mode is selected, exactly as it does in a
	// workspace chat, so the setting decides what plain Enter means rather than
	// which chords exist. A binding that returns false hands the key back to
	// Lexical, which is how Enter still inserts a newline.
	const submitBindings = useMemo<readonly KeymapBinding<HTMLElement>[]>(
		() => [
			[
				'composer.submit',
				(event) => {
					if (event.nativeEvent.isComposing || sendShortcut === 'mod+enter') {
						return false;
					}
					send();
				},
			],
			[
				'composer.submitWithMod',
				(event) => {
					if (event.nativeEvent.isComposing) {
						return false;
					}
					send();
				},
			],
		],
		[send, sendShortcut],
	);
	const handleSubmitKeys = useKeymapHandler(submitBindings);

	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			draft.handleKeyDown(event);
			if (event.defaultPrevented) {
				return;
			}
			handleSubmitKeys(event);
		},
		[draft.handleKeyDown, handleSubmitKeys],
	);

	const handleDrop = useCallback(
		(event: ReactDragEvent<HTMLElement>) => {
			if (draft.consumeDroppedTransfer(event.dataTransfer)) {
				event.preventDefault();
			}
		},
		[draft.consumeDroppedTransfer],
	);

	/** Signals the composer as a drop target so `handleDrop` fires at all. */
	const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
		if (Array.from(event.dataTransfer.types).includes('Files')) {
			event.preventDefault();
		}
	}, []);

	const contextUsage = useMemo<ComposerContextUsage | null>(
		() =>
			pressure.data?.maxTokens
				? {
						maxTokens: pressure.data.maxTokens,
						usedTokens: pressure.data.usedTokens ?? 0,
					}
				: null,
		[pressure.data?.maxTokens, pressure.data?.usedTokens],
	);

	// The request is raised from outside the panel — a shortcut, a menu item —
	// and the editor handle only exists once the composer has mounted, so the
	// request is consumed here rather than fulfilled where it is made.
	const focusRequest = useAtomValue(conciergeComposerFocusRequestAtom);
	const { editorRef } = draft;
	useEffect(() => {
		if (focusRequest > 0) {
			editorRef.current?.focus();
		}
	}, [editorRef, focusRequest]);

	return {
		contextUsage,
		draft,
		handleDragOver,
		handleDrop,
		handleKeyDown,
		isSending,
		selection,
		send,
		sendShortcutHint: formatShortcut(
			sendShortcut === 'mod+enter'
				? 'composer.submitWithMod'
				: 'composer.submit',
		),
	};
}
