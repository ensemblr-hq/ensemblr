import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { readBlocks } from './sdk-content-blocks.ts';

/**
 * Longest a banner runs. Claude Code's limit notices are one short sentence; a
 * cap keeps a real answer that happens to open with a matching phrase out of the
 * error path, since an answer that long is prose rather than a banner.
 */
const MAX_NOTICE_CHARS = 240;

/**
 * The shapes Claude Code's plan-limit banners take. Each is anchored on a
 * possessive or a named window rather than on the word "limit" alone, so an
 * answer *about* limits — "the retry loop reached the limit" — is not read as
 * one: the runtime always speaks about the reader's own account.
 */
const LIMIT_NOTICES: readonly RegExp[] = [
	/\b(hit|reached|exceeded)\b[^.]{0,24}\byour\b[^.]{0,24}\blimit\b/i,
	/\b(usage|session|weekly|opus) limit (reached|exceeded)\b/i,
	/\b\d+-hour limit (reached|exceeded)\b/i,
	/\byour limit will reset\b/i,
];

/**
 * Reads an assistant message that is really Claude Code announcing the account
 * has run out of plan.
 *
 * The runtime delivers these as an ordinary assistant turn — one text block, no
 * tool calls, no reasoning — so without this they render as the model's answer:
 * a bare English sentence with no icon, no severity, and nothing to press. The
 * banner is the runtime speaking about the account rather than the model
 * answering the prompt, so it belongs on the failure path instead.
 *
 * Recognition is deliberately structural as well as textual: the message has to
 * be nothing *but* that sentence. A turn that did work and then mentioned a
 * limit still reads as an answer.
 * @param message - The sealing `assistant` SDK message.
 * @returns The banner's own words, or null when this is an ordinary answer.
 */
export function readLimitNotice(
	message: Extract<SDKMessage, { type: 'assistant' }>,
): string | null {
	const blocks = readBlocks(message.message?.content);
	const [only] = blocks;
	if (blocks.length !== 1 || only?.type !== 'text') {
		return null;
	}

	const text = typeof only.text === 'string' ? only.text.trim() : '';
	if (!text || text.length > MAX_NOTICE_CHARS) {
		return null;
	}

	return LIMIT_NOTICES.some((notice) => notice.test(text)) ? text : null;
}
