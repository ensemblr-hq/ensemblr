/**
 * Carries an extension-injected Pi message through the AI SDK's message-part
 * union. The SDK has no variant for "context someone else put in the
 * conversation", so it travels as a `data-` part rather than as text — which
 * is what kept a docs injection from being mistaken for the assistant's answer.
 */

import type {
	PiCustomMessageData,
	UIMessagePart,
} from '@/renderer/types/pi-timeline';

/** Part type identifying an extension-injected Pi message on a UI message. */
const PI_CUSTOM_PART_TYPE = 'data-pi-custom';

/**
 * Wraps an extension-injected message as a message part.
 * @param data - The injector's tag, visibility hint, and text
 * @returns The `data-pi-custom` part carrying it
 */
export function buildCustomMessagePart(
	data: PiCustomMessageData,
): UIMessagePart {
	return { data, type: PI_CUSTOM_PART_TYPE };
}

/**
 * Reads an extension-injected message back off a message part.
 * @param part - The part to inspect
 * @returns The injected message, or null when the part carries something else
 */
export function customMessageDataOf(
	part: UIMessagePart,
): PiCustomMessageData | null {
	if (part.type !== PI_CUSTOM_PART_TYPE || !('data' in part)) {
		return null;
	}
	const data = part.data;
	if (typeof data !== 'object' || data === null) {
		return null;
	}
	const { customType, display, text } = data as Record<string, unknown>;
	if (typeof customType !== 'string' || typeof text !== 'string') {
		return null;
	}
	return { customType, display: display === true, text };
}
