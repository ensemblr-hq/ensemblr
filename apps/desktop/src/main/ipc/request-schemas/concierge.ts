/**
 * Zod schemas for the Concierge IPC surface.
 *
 * Strict throughout, matching the chat-tab stance rather than the lenient
 * clone/root one: every one of these payloads is built by the Concierge panel
 * from state it already holds, so a malformed one is a renderer bug worth
 * surfacing rather than input to coerce into an empty request.
 */
import { z } from 'zod';

import { optionalBoolean, optionalNullableString } from './primitives.ts';

/** Session id every Concierge call but `open` addresses. */
const sessionId = z.string().min(1);

/** Opens or resumes the Concierge session; `fresh` forces a new one. */
export const openConciergeSessionRequestSchema = z.object({
	fresh: optionalBoolean,
});

/** Submits a prompt to the open Concierge session. */
export const submitConciergePromptRequestSchema = z.object({
	model: optionalNullableString,
	prompt: z.string(),
	sessionId,
	thinkingLevel: optionalNullableString,
});

/** Stops the Concierge's streaming turn. */
export const stopConciergeSessionRequestSchema = z.object({
	reason: z.string().optional(),
	sessionId,
});

/** Reads the Concierge transcript, optionally from an ordinal onward. */
export const listConciergeEventsRequestSchema = z.object({
	fromOrdinal: z.number().int().min(0).optional(),
	sessionId,
});

/** Clears the Concierge context, writing memory first unless told not to. */
export const clearConciergeContextRequestSchema = z.object({
	reason: z.enum(['manual', 'threshold']),
	skipMemoryPass: optionalBoolean,
});
