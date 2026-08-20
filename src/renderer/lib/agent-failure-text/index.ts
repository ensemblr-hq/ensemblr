/**
 * Turns a runtime failure into the designed, translated row the agent timeline
 * shows. The sibling of `lib/failure-text/`, for the one boundary that could not
 * use it: agent errors arrive as prose a provider wrote, so the class is derived
 * from that prose rather than chosen by main, and the runtime's own sentence is
 * demoted to disclosed detail instead of being the headline.
 */

import type { TFunction } from 'i18next';

import {
	type AgentFailureClass,
	classifyAgentFailure,
} from '@/shared/agent-failure';
import type { AgentWireError } from '@/shared/ipc/contracts/agent-session';

import {
	type AgentFailureDescription,
	describeAgentFailureClass,
} from './descriptions.ts';

export type {
	AgentFailureAction,
	AgentFailureDescription,
	AgentFailureIcon,
	AgentFailureSeverity,
} from './descriptions.ts';

/** A failure's designed presentation plus the raw runtime text behind it. */
export interface AgentFailureReadout extends AgentFailureDescription {
	failureClass: AgentFailureClass;
	/** Runtime detail worth disclosing under the row, or null when it adds nothing. */
	detail: string | null;
	/** The runtime's own sentence, kept for the details disclosure and support bundles. */
	raw: string;
}

/**
 * Resolves the class a persisted error belongs to, preferring the tag main
 * wrote and re-classifying the prose when there is none.
 *
 * Rows persisted before the taxonomy shipped carry no `failureClass`, and they
 * replay on every load — classifying them here is what keeps an old transcript
 * from rendering every past failure as `unknown`.
 * @param error - The persisted wire error
 * @returns The class this failure belongs to
 */
export function agentFailureClassOf(error: AgentWireError): AgentFailureClass {
	return error.failureClass ?? classifyAgentFailure(error);
}

/**
 * Describes a runtime failure for the timeline: designed copy and recovery
 * actions in the reader's language, with the provider's own words carried
 * alongside rather than in place of them.
 * @param t - Translator bound to the active language
 * @param error - The persisted wire error
 * @returns The row's full readout
 */
export function describeAgentFailure(
	t: TFunction,
	error: AgentWireError,
): AgentFailureReadout {
	const failureClass = agentFailureClassOf(error);
	const raw = error.message.trim();
	const detail = error.detail?.trim() ?? '';
	return {
		...describeAgentFailureClass(t, failureClass),
		detail: detail && detail !== raw ? detail : null,
		failureClass,
		raw,
	};
}
