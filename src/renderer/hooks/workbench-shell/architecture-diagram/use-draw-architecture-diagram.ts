import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useComposerSubmit } from '@/renderer/state/composer';

/**
 * What the diagram pane's empty state sends when the user asks for a diagram.
 *
 * Names the skill rather than the control op: the ops alone leave an agent
 * guessing at what a good diagram looks like, and the skill is where the shape,
 * the ceilings, and the curation rules are written.
 */
const DRAW_DIAGRAM_PROMPT =
	// i18next-instrument-ignore -- agent-facing prose, steered by buildLanguageDirective rather than translated.
	'Use the architecture-diagram skill to map this workspace and store the result.';

/**
 * Builds the diagram pane's "Draw it" handler: opens a fresh chat and sends
 * {@link DRAW_DIAGRAM_PROMPT} to it without the user having to type or send
 * anything.
 *
 * A new chat rather than the one in front, because drawing the diagram is a
 * whole task of its own and dropping it mid-thread would derail whatever that
 * chat was doing. The send is queued against the new tab by id and drains when
 * that tab's composer mounts, so there is nothing to await between opening the
 * chat and handing it the work.
 * @param openSessionTab - Opens a new chat tab
 * @param selectChat - Brings a chat tab to the front
 * @returns A stable callback for the empty state's button
 */
export function useDrawArchitectureDiagram({
	openSessionTab,
	selectChat,
}: {
	openSessionTab: () => Promise<{ chatTabId: string } | null>;
	selectChat: (chatTabId: string) => void;
}): () => void {
	const submitToComposer = useComposerSubmit();
	const { t } = useTranslation();

	return useCallback(() => {
		void openSessionTab()
			.then((opened) => {
				if (!opened) {
					throw new Error('New chat did not open.');
				}
				submitToComposer({
					chatTabId: opened.chatTabId,
					text: DRAW_DIAGRAM_PROMPT,
				});
				selectChat(opened.chatTabId);
			})
			.catch(() => {
				toast.error(
					t(
						'errors:architecture-diagram.chat-failed.title',
						'Could not open a new chat.',
					),
					{
						description: t(
							'errors:architecture-diagram.chat-failed.description',
							'Try the "Draw it with an agent" action again from the diagram tab.',
						),
					},
				);
			});
	}, [openSessionTab, selectChat, submitToComposer, t]);
}
