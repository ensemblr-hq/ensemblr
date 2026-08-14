import { z } from 'zod';

/**
 * Validates the chat the renderer reports as being on screen. Lenient in the
 * same sense as the menu context: a malformed report is dropped rather than
 * thrown back, because the renderer does not await a result — and the notifier
 * then treats the chat as unknown, which notifies rather than staying silent.
 */
export const activeChatContextSchema = z.union([
	z.object({
		agentSessionId: z.string().min(1).nullable(),
		chatTabId: z.string().min(1),
		workspaceId: z.string().min(1),
	}),
	z.null(),
]);
