import type { TFunction } from 'i18next';

import { SETUP_DETAIL_TEXT } from '@/renderer/lib/setup-check-text/details';
import { SETUP_LOG_LABEL_TEXT } from '@/renderer/lib/setup-check-text/log-labels';
import { SETUP_REMEDIATION_LABEL } from '@/renderer/lib/setup-check-text/remediations';
import { SETUP_CHECK_TITLE } from '@/renderer/lib/setup-check-text/titles';
import type {
	SetupCheckId,
	SetupCheckLogSnapshot,
	SetupCheckSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc/contracts/setup';

export {
	piAgentDirectorySourceLabel,
	piExecutableSourceLabel,
} from '@/renderer/lib/setup-check-text/source-labels';

/**
 * Renders a setup check's title in the app language. The snapshot carries the
 * English source for the support bundle; every surface reads the translation
 * keyed by check id instead.
 * @param id - The check being named.
 * @param t - Translator from the calling component.
 * @returns The check title.
 */
export function setupCheckTitle(id: SetupCheckId, t: TFunction): string {
	return SETUP_CHECK_TITLE[id](t);
}

/**
 * Renders a setup check's detail line in the app language, falling back to the
 * English text when the line passes an upstream message through — tool stderr
 * and thrown `Error` messages are not ours to translate.
 * @param check - The check whose detail to render.
 * @param t - Translator from the calling component.
 * @returns The detail line.
 */
export function setupCheckDetail(
	check: Pick<SetupCheckSnapshot, 'detail' | 'detailMessage'>,
	t: TFunction,
): string {
	const message = check.detailMessage;

	return message
		? SETUP_DETAIL_TEXT[message.code](t, message.params ?? {})
		: check.detail;
}

/**
 * Renders a remediation button's label in the app language. An id the catalogue
 * does not name falls back to the generic retry label, or to the English the
 * check authored when the action is not a retry.
 * @param action - The remediation being labelled.
 * @param t - Translator from the calling component.
 * @returns The button label.
 */
export function setupRemediationLabel(
	action: SetupRemediationAction,
	t: TFunction,
): string {
	const entry = SETUP_REMEDIATION_LABEL[action.id];
	if (entry) return entry(t);

	return action.kind === 'retry'
		? t('common:setup-check.action.retry', 'Retry check')
		: action.label;
}

/**
 * Renders a diagnostics-log label in the app language. Stream names and upstream
 * diagnostic codes arrive without a code and surface verbatim.
 * @param log - The log entry being labelled.
 * @param t - Translator from the calling component.
 * @returns The log label.
 */
export function setupLogLabel(
	log: Pick<SetupCheckLogSnapshot, 'label' | 'labelMessage'>,
	t: TFunction,
): string {
	const message = log.labelMessage;

	return message
		? SETUP_LOG_LABEL_TEXT[message.code](t, message.params ?? {})
		: log.label;
}
