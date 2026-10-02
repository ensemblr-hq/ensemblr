import type { TFunction } from 'i18next';

import type {
	AgentPlanLimitStatusWire,
	AgentPlanLimitWindowWire,
} from '@/shared/ipc/contracts/agent-session';

/**
 * Label per named plan window. Per-model buckets are not in here: the server
 * names those itself and the runtime hands the name through, so translating them
 * would mean guessing at model names the app has never seen.
 */
const PLAN_WINDOW_LABEL: Record<string, (t: TFunction) => string> = {
	five_hour: (t) => t('settings:providers.usage.window.five-hour', 'Session'),
	overage: (t) => t('settings:providers.usage.window.overage', 'Extra usage'),
	seven_day: (t) => t('settings:providers.usage.window.seven-day', 'Weekly'),
	seven_day_oauth_apps: (t) =>
		t('settings:providers.usage.window.seven-day-oauth-apps', 'Weekly (apps)'),
	seven_day_opus: (t) =>
		t('settings:providers.usage.window.seven-day-opus', 'Weekly (Opus)'),
	seven_day_overage_included: (t) =>
		t(
			'settings:providers.usage.window.seven-day-overage-included',
			'Weekly (extra usage)',
		),
	seven_day_sonnet: (t) =>
		t('settings:providers.usage.window.seven-day-sonnet', 'Weekly (Sonnet)'),
};

/**
 * Names one plan window for display.
 * @param window - The window being named.
 * @param t - Translator from the calling component.
 * @returns The window's label.
 */
export function planWindowLabel(
	window: AgentPlanLimitWindowWire,
	t: TFunction,
): string {
	return PLAN_WINDOW_LABEL[window.id]?.(t) ?? window.displayName ?? window.id;
}

/**
 * Describes when a window resets, in whole hours or days from now.
 *
 * A window whose reset has already passed reads as resetting now rather than as
 * a negative interval: the runtime reports the boundary it last knew about, and
 * a stale one is still true until the next reading lands.
 * @param resetsAt - ISO instant the window resets, or null when unreported.
 * @param t - Translator from the calling component.
 * @param now - Clock, injectable for tests.
 * @returns The phrase, or null when there is no reset to describe.
 */
export function planWindowResetLabel(
	resetsAt: string | null,
	t: TFunction,
	now: () => number = () => Date.now(),
): string | null {
	if (!resetsAt) {
		return null;
	}
	const resetsAtMs = new Date(resetsAt).getTime();
	if (Number.isNaN(resetsAtMs)) {
		return null;
	}
	const hours = Math.ceil((resetsAtMs - now()) / (60 * 60 * 1000));
	if (hours <= 0) {
		return t('settings:providers.usage.resets-now', 'Resets now');
	}
	if (hours < 24) {
		return t(
			'settings:providers.usage.resets-in-hours',
			'Resets in {{count}}h',
			{
				count: hours,
			},
		);
	}
	return t('settings:providers.usage.resets-in-days', 'Resets in {{count}}d', {
		count: Math.ceil(hours / 24),
	});
}

/**
 * Formats a running cost for display. The runtime bills in USD whatever language
 * the app is in, so the currency is fixed and only its presentation follows the
 * user's locale. Sub-dollar amounts keep a third digit, since most turns cost
 * less than a cent and would otherwise all read as zero.
 * @param totalCostUsd - Cost estimate in USD, or null before a turn seals.
 * @param locale - Language tag the app is rendering in.
 * @returns The formatted amount, or null when there is nothing to show.
 */
export function formatSessionCost(
	totalCostUsd: number | null,
	locale: string,
): string | null {
	if (totalCostUsd === null) {
		return null;
	}
	return new Intl.NumberFormat(locale, {
		currency: 'USD',
		maximumFractionDigits: totalCostUsd < 1 ? 3 : 2,
		style: 'currency',
	}).format(totalCostUsd);
}

/**
 * Names the runtime's spend verdict for the plan, when it is worth saying. An
 * `allowed` verdict has nothing to add over the bars themselves, so it reads as
 * no message at all rather than as reassurance nobody asked for.
 * @param status - The verdict the runtime last reported, or null when it has reported none.
 * @param t - Translator from the calling component.
 * @returns The warning, or null when the plan is simply spendable.
 */
export function planStatusLabel(
	status: AgentPlanLimitStatusWire | null,
	t: TFunction,
): string | null {
	if (status === 'rejected') {
		return t(
			'workbench:plan-usage.status-rejected',
			'Plan limit reached. Turns fail until a window resets.',
		);
	}
	if (status === 'allowed-warning') {
		return t('workbench:plan-usage.status-warning', 'Close to the plan limit.');
	}
	return null;
}
