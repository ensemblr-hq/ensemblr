import { useConciergeActivityWatch } from '@/renderer/hooks/concierge/use-concierge-activity-watch';
import { useConfigReloadSync } from '@/renderer/hooks/use-config-reload-sync';
import { useModalInertBodyGuard } from '@/renderer/hooks/use-modal-inert-body-guard';
import { useNotificationSoundSync } from '@/renderer/hooks/use-notification-sound-sync';
import { useAskUserQuestionSync } from '@/renderer/state/ask-user-question';
import { usePlanModeSync, usePlanReviewSync } from '@/renderer/state/plan-mode';
import {
	useAppearanceEffect,
	useAppSettingsSync,
	useLanguageEffect,
	useThemeEffect,
} from '@/renderer/state/preferences';
import { useToolApprovalSync } from '@/renderer/state/tool-approval';
import { useNotificationFocusSync } from '@/renderer/state/unread';
import { useUpdateSync } from '@/renderer/state/updates';

/**
 * Runs every subscription and effect the app root owns rather than any one
 * route: the preference effects that paint the window, the main-process
 * broadcasts nothing below the root is mounted for, and the guards that outlive
 * a route transition.
 *
 * Grouped here because each is a bare call with no arguments and no result, so
 * the root gains nothing from listing them and loses the shape of what it
 * actually renders. Order is not significant — none of them read another's
 * state during mount.
 */
export function useAppRootSyncs(): void {
	useThemeEffect();
	useAppearanceEffect();
	useLanguageEffect();
	useAppSettingsSync();
	useConfigReloadSync();
	useNotificationSoundSync();
	useNotificationFocusSync();
	useConciergeActivityWatch();
	useAskUserQuestionSync();
	useToolApprovalSync();
	usePlanReviewSync();
	usePlanModeSync();
	useUpdateSync();
	useModalInertBodyGuard();
}
