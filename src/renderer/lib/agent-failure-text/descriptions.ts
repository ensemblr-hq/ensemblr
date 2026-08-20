import type { TFunction } from 'i18next';

import type { AgentFailureClass } from '@/shared/agent-failure';

/**
 * A recovery the error row can offer. Each is wired by the timeline, which owns
 * the composer and the router; the row renders only the ones it was handed a
 * handler for, so a surface that cannot fork simply shows one button fewer.
 */
export type AgentFailureAction =
	| 'continue'
	/** Put the failed prompt back in the composer to reword before re-sending. */
	| 'edit-prompt'
	| 'fork'
	/** Open the repository's security settings, where the permission mode lives. */
	| 'open-permissions'
	/** Open provider settings, where credentials, models, and executables live. */
	| 'open-provider-settings'
	| 'retry';

/**
 * How loudly the row reads. `danger` is for a failure the user has to fix
 * before the chat works again — credentials, a missing binary, a dead process.
 * `warning` is for one that may well clear on its own.
 */
export type AgentFailureSeverity = 'danger' | 'warning';

/** Icon glyph the row shows, resolved to a component by the error card. */
export type AgentFailureIcon =
	| 'folder-x'
	| 'gauge'
	| 'key-round'
	| 'layers'
	| 'power-off'
	| 'scissors'
	| 'server-crash'
	| 'shield-alert'
	| 'terminal'
	| 'triangle-alert'
	| 'wifi-off';

/** Everything the timeline needs to draw one designed failure row. */
export interface AgentFailureDescription {
	actions: readonly AgentFailureAction[];
	/** One sentence on what happened, then what the user can do about it. */
	body: string;
	icon: AgentFailureIcon;
	severity: AgentFailureSeverity;
	title: string;
}

/** The fixed half of a class's presentation — everything but the translated copy. */
type FailurePresentation = Pick<
	AgentFailureDescription,
	'actions' | 'icon' | 'severity'
>;

/**
 * How each class presents itself. Separated from the copy so the action set and
 * the severity stay readable as one table: which failures resume, which need
 * settings, and which leave the user nothing to press.
 */
const FAILURE_PRESENTATION: Readonly<
	Record<AgentFailureClass, FailurePresentation>
> = {
	'context-overflow': {
		actions: ['fork'],
		icon: 'layers',
		severity: 'warning',
	},
	credentials: {
		actions: ['open-provider-settings', 'retry'],
		icon: 'key-round',
		severity: 'danger',
	},
	network: {
		actions: ['continue', 'retry'],
		icon: 'wifi-off',
		severity: 'warning',
	},
	'provider-overloaded': {
		actions: ['continue', 'retry'],
		icon: 'server-crash',
		severity: 'warning',
	},
	// Re-sending the same words earns the same refusal, so this class offers the
	// prompt back for editing rather than a plain retry.
	'provider-refused': {
		actions: ['edit-prompt'],
		icon: 'shield-alert',
		severity: 'warning',
	},
	'provider-truncated': {
		actions: ['continue', 'retry'],
		icon: 'scissors',
		severity: 'warning',
	},
	'rate-limit': {
		actions: ['retry', 'open-provider-settings'],
		icon: 'gauge',
		severity: 'warning',
	},
	'runtime-crashed': {
		actions: ['retry'],
		icon: 'triangle-alert',
		severity: 'danger',
	},
	'runtime-missing': {
		actions: ['open-provider-settings'],
		icon: 'terminal',
		severity: 'danger',
	},
	'session-closed': {
		actions: [],
		icon: 'power-off',
		severity: 'warning',
	},
	'tool-denied': {
		actions: ['open-permissions', 'continue'],
		icon: 'shield-alert',
		severity: 'warning',
	},
	unknown: {
		actions: ['continue', 'retry'],
		icon: 'triangle-alert',
		severity: 'warning',
	},
	'workspace-invalid': {
		actions: [],
		icon: 'folder-x',
		severity: 'danger',
	},
};

/** The authored headline for each class, in the reader's language. */
const FAILURE_TITLE: Readonly<
	Record<AgentFailureClass, (t: TFunction) => string>
> = {
	'context-overflow': (t) =>
		t('errors:agent-failure.context-overflow.title', 'This chat is too long'),
	credentials: (t) =>
		t(
			'errors:agent-failure.credentials.title',
			'The provider rejected your credentials',
		),
	network: (t) =>
		t('errors:agent-failure.network.title', 'Could not reach the provider'),
	'provider-overloaded': (t) =>
		t(
			'errors:agent-failure.provider-overloaded.title',
			'The provider is having trouble',
		),
	'provider-refused': (t) =>
		t(
			'errors:agent-failure.provider-refused.title',
			'The model declined to answer',
		),
	'provider-truncated': (t) =>
		t(
			'errors:agent-failure.provider-truncated.title',
			'The answer was cut off',
		),
	'rate-limit': (t) =>
		t('errors:agent-failure.rate-limit.title', 'You have hit a usage limit'),
	'runtime-crashed': (t) =>
		t(
			'errors:agent-failure.runtime-crashed.title',
			'The agent process stopped',
		),
	'runtime-missing': (t) =>
		t(
			'errors:agent-failure.runtime-missing.title',
			'The agent runtime is not available',
		),
	'session-closed': (t) =>
		t('errors:agent-failure.session-closed.title', 'This session has ended'),
	'tool-denied': (t) =>
		t('errors:agent-failure.tool-denied.title', 'A tool call was blocked'),
	unknown: (t) =>
		t('errors:agent-failure.unknown.title', 'The turn ended with an error'),
	'workspace-invalid': (t) =>
		t(
			'errors:agent-failure.workspace-invalid.title',
			'The workspace folder is not usable',
		),
};

/** The authored explanation for each class: what happened, then what to do. */
const FAILURE_BODY: Readonly<
	Record<AgentFailureClass, (t: TFunction) => string>
> = {
	'context-overflow': (t) =>
		t(
			'errors:agent-failure.context-overflow.body',
			'The turn no longer fits in the model’s context window. Fork the chat to carry a summary into a fresh one.',
		),
	credentials: (t) =>
		t(
			'errors:agent-failure.credentials.body',
			'Sign in again or update this runtime’s API key, then send the turn again.',
		),
	network: (t) =>
		t(
			'errors:agent-failure.network.body',
			'The connection dropped before the turn finished. Check that you are online, then try again.',
		),
	'provider-overloaded': (t) =>
		t(
			'errors:agent-failure.provider-overloaded.body',
			'The model’s servers returned an error. This usually clears on its own — try the turn again in a moment.',
		),
	'provider-refused': (t) =>
		t(
			'errors:agent-failure.provider-refused.body',
			'The provider declined this request. Put the prompt back in the composer and reword it — sending the same words again earns the same refusal.',
		),
	'provider-truncated': (t) =>
		t(
			'errors:agent-failure.provider-truncated.body',
			'The provider stopped mid-answer, so the reply above is incomplete. Continue to pick up where it stopped.',
		),
	'rate-limit': (t) =>
		t(
			'errors:agent-failure.rate-limit.body',
			'The provider is throttling this account. Wait for the window to reset, or switch to another model.',
		),
	'runtime-crashed': (t) =>
		t(
			'errors:agent-failure.runtime-crashed.body',
			'The runtime exited before the turn finished. Sending the turn again starts it back up.',
		),
	'runtime-missing': (t) =>
		t(
			'errors:agent-failure.runtime-missing.body',
			'Ensemblr could not run this provider’s command. Check its executable path in settings.',
		),
	'session-closed': (t) =>
		t(
			'errors:agent-failure.session-closed.body',
			'The turn could not be delivered because the session is already closed. Start a new chat to keep going.',
		),
	'tool-denied': (t) =>
		t(
			'errors:agent-failure.tool-denied.body',
			'The turn stopped because a tool was not allowed to run. Change the permission mode in this repository’s security settings, then continue.',
		),
	unknown: (t) =>
		t(
			'errors:agent-failure.unknown.body',
			'The runtime reported a failure it did not classify. Its own words are in the details below.',
		),
	'workspace-invalid': (t) =>
		t(
			'errors:agent-failure.workspace-invalid.body',
			'The agent could not start in this workspace’s folder. Check that the folder still exists.',
		),
};

/**
 * Builds the designed presentation of one failure class: the headline, the
 * sentence under it, the icon, the severity, and the recoveries worth offering.
 * @param t - Translator bound to the active language
 * @param failureClass - The class the failure was tagged with
 * @returns Everything the error row renders, already translated
 */
export function describeAgentFailureClass(
	t: TFunction,
	failureClass: AgentFailureClass,
): AgentFailureDescription {
	return {
		...FAILURE_PRESENTATION[failureClass],
		body: FAILURE_BODY[failureClass](t),
		title: FAILURE_TITLE[failureClass](t),
	};
}
