import type { AppLanguage } from '@/shared/i18n';

import elCommon from './locales/el/common.json';
import elErrors from './locales/el/errors.json';
import elGit from './locales/el/git.json';
import elLinear from './locales/el/linear.json';
import elReview from './locales/el/review.json';
import elSettings from './locales/el/settings.json';
import elWorkbench from './locales/el/workbench.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enGit from './locales/en/git.json';
import enLinear from './locales/en/linear.json';
import enReview from './locales/en/review.json';
import enSettings from './locales/en/settings.json';
import enWorkbench from './locales/en/workbench.json';
import ruCommon from './locales/ru/common.json';
import ruErrors from './locales/ru/errors.json';
import ruGit from './locales/ru/git.json';
import ruLinear from './locales/ru/linear.json';
import ruReview from './locales/ru/review.json';
import ruSettings from './locales/ru/settings.json';
import ruWorkbench from './locales/ru/workbench.json';

/**
 * Message namespaces, one per broad UI surface. Each maps onto one migration
 * slice, so a slice touches exactly one JSON triple.
 */
export const I18N_NAMESPACES = [
	'common',
	'settings',
	'workbench',
	'review',
	'git',
	'linear',
	'errors',
] as const;

/** One of the seven message namespaces. */
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

/** Namespace resolved when a key carries no `<namespace>:` prefix. */
export const DEFAULT_NAMESPACE = 'common' satisfies I18nNamespace;

/**
 * Every catalogue, bundled into the renderer chunk rather than fetched. The
 * packaged renderer loads from `file://`, where an HTTP backend cannot resolve
 * relative URLs, and passing `resources` is what makes i18next's `init` run
 * synchronously — which two `lib/workbench/` modules rely on to call `t()` at
 * module scope.
 */
export const resources = {
	el: {
		common: elCommon,
		errors: elErrors,
		git: elGit,
		linear: elLinear,
		review: elReview,
		settings: elSettings,
		workbench: elWorkbench,
	},
	en: {
		common: enCommon,
		errors: enErrors,
		git: enGit,
		linear: enLinear,
		review: enReview,
		settings: enSettings,
		workbench: enWorkbench,
	},
	ru: {
		common: ruCommon,
		errors: ruErrors,
		git: ruGit,
		linear: ruLinear,
		review: ruReview,
		settings: ruSettings,
		workbench: ruWorkbench,
	},
} as const satisfies Record<AppLanguage, Record<I18nNamespace, object>>;
