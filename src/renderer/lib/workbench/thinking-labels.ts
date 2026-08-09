import type { TFunction } from 'i18next';

/**
 * Translated name for one thinking level, falling back to the raw id so a level
 * a runtime adds later still renders as something. Both runtimes name the
 * levels they share identically, so one key set covers pi and Claude Code.
 *
 * This lives here rather than beside either caller because the settings panel
 * and the composer picker must name the same level identically; `shared/`
 * cannot own it, since it has no access to the renderer's i18n instance.
 * @param t - Translation function from `useTranslation`
 * @param level - Raw level id reported by the runtime
 * @returns The level's display label in the active language
 */
export function thinkingLevelLabel(t: TFunction, level: string): string {
	switch (level) {
		case 'off':
			return t('settings:models.thinking.level.off', 'No thinking');
		case 'minimal':
			return t('settings:models.thinking.level.minimal', 'Minimal');
		case 'low':
			return t('settings:models.thinking.level.low', 'Low');
		case 'medium':
			return t('settings:models.thinking.level.medium', 'Medium');
		case 'high':
			return t('settings:models.thinking.level.high', 'High');
		case 'xhigh':
			return t('settings:models.thinking.level.xhigh', 'Extra high');
		case 'max':
			return t('settings:models.thinking.level.max', 'Max');
		default:
			return level;
	}
}
