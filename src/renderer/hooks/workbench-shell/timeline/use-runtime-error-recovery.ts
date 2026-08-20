import { useNavigate } from '@tanstack/react-router';
import type { UIMessage } from 'ai';
import { useCallback, useMemo } from 'react';

import { parsePromptAttachments } from '@/renderer/lib/agent-timeline';
import {
	useComposerInsert,
	useComposerSubmit,
} from '@/renderer/state/composer';

/**
 * Prompt the Continue action sends. One English word by design: agents are
 * steered into the app's language by `buildLanguageDirective`, not by the
 * language the prompt happens to be written in, so translating it would only
 * make the transcript inconsistent.
 */
const CONTINUE_PROMPT = 'Continue';

/**
 * The recoveries a runtime-error row can offer, in a shape whose identity is
 * stable across renders — the timeline's message rows are memoized, and a fresh
 * handler object per render would re-render every turn in the transcript on
 * every token.
 */
export interface RuntimeErrorRecovery {
	continueTurn: () => void;
	/** Puts the failed prompt back in the composer to reword before re-sending. */
	editPrompt: (prompt: string) => void;
	/** Null when this timeline has no session to fork from. */
	fork: (() => void) | null;
	openPermissions: () => void;
	openProviderSettings: () => void;
	retry: (prompt: string) => void;
}

/**
 * Wires the recoveries the timeline's error rows offer: resume the turn, send
 * the failed prompt again, reword it, fork the chat, or open the settings a
 * credential, quota, or permission failure points at.
 *
 * Retry and continue go through the composer's submit *channel*
 * (`useComposerSubmit`), not the raw session send, so a recovered turn inherits
 * everything a typed message gets: the disabled and in-flight guards, the
 * linked-directory preamble, the Follow-up behavior mid-turn, and the composer's
 * error strip when the send does not land. A send the composer cannot take right
 * now stays queued and drains when it frees up rather than disappearing.
 * @param fork - Fork handlers for this conversation, or null when it cannot fork
 * @param projectId - Repository whose security settings hold the permission mode
 * @param workspaceId - Workspace whose active chat the recovered prompt is sent to
 * @returns Stable handlers for every recovery the row can render
 */
export function useRuntimeErrorRecovery({
	fork,
	projectId,
	workspaceId,
}: {
	fork: (() => void) | null;
	projectId: string;
	workspaceId: string;
}): RuntimeErrorRecovery {
	const navigate = useNavigate();
	const submitToComposer = useComposerSubmit(workspaceId);
	const insertIntoComposer = useComposerInsert();

	const continueTurn = useCallback(() => {
		submitToComposer(CONTINUE_PROMPT, 'user');
	}, [submitToComposer]);

	const retry = useCallback(
		(prompt: string) => {
			submitToComposer(prompt, 'user');
		},
		[submitToComposer],
	);

	const editPrompt = useCallback(
		(prompt: string) => {
			insertIntoComposer(prompt);
		},
		[insertIntoComposer],
	);

	const openProviderSettings = useCallback(() => {
		void navigate({ to: '/settings/providers' });
	}, [navigate]);

	const openPermissions = useCallback(() => {
		void navigate({
			params: { repoId: projectId },
			to: '/settings/repo/$repoId/security',
		});
	}, [navigate, projectId]);

	return useMemo(
		() => ({
			continueTurn,
			editPrompt,
			fork,
			openPermissions,
			openProviderSettings,
			retry,
		}),
		[
			continueTurn,
			editPrompt,
			fork,
			openPermissions,
			openProviderSettings,
			retry,
		],
	);
}

/**
 * Recovers, for each diagnostic row in a transcript, the prompt the failed turn
 * was answering — so "Send again" re-sends the user's own words rather than the
 * word "Continue".
 *
 * Only the typed runs survive: a persisted prompt also carries the bodies of
 * whatever files were attached, and re-sending those verbatim would resubmit a
 * snapshot of a file that may have changed since. Attachments are the composer's
 * job, and the user still has them there.
 * @param messages - The transcript, in order
 * @returns The prompt to re-send, keyed by the id of the row that offers it
 */
export function retryPromptsByMessageId(
	messages: readonly UIMessage[],
): ReadonlyMap<string, string> {
	const prompts = new Map<string, string>();
	let latest: string | null = null;
	for (const message of messages) {
		if (message.role === 'user') {
			latest = typedRunsOf(message);
			continue;
		}
		if (message.role === 'system' && latest) {
			prompts.set(message.id, latest);
		}
	}
	return prompts;
}

/**
 * Typed text already recovered from a prompt, keyed by the message it came from.
 *
 * The transcript is re-walked on every persisted event — the projector hands
 * back a fresh array each fold — and parsing a prompt means three regex sweeps
 * over text that includes every attached file's inlined body. The projector
 * keeps unchanged rows referentially identical across folds, so caching on the
 * message itself turns those repeat walks into map lookups.
 */
const TYPED_RUNS = new WeakMap<UIMessage, string | null>();

/**
 * Reads back what the user actually typed in a persisted prompt, dropping the
 * inlined bodies of anything they attached.
 * @param message - The persisted user prompt
 * @returns The typed text, or null when the prompt was attachments only
 */
function typedRunsOf(message: UIMessage): string | null {
	const cached = TYPED_RUNS.get(message);
	if (cached !== undefined) {
		return cached;
	}
	const typed = parsePromptAttachments(textOf(message))
		.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : []))
		.join('')
		.trim();
	const recovered = typed || null;
	TYPED_RUNS.set(message, recovered);
	return recovered;
}

/**
 * Joins the text parts of a message into one string.
 * @param message - The message to read
 * @returns The concatenated text of every text part
 */
function textOf(message: UIMessage): string {
	return message.parts
		.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
		.join('\n');
}
