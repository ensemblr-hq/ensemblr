/// <reference types="vite/client" />
import type { AppLanguage } from '@/shared/i18n';

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
	'onboarding',
] as const;

/** One of the eight message namespaces. */
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

/** Namespace resolved when a key carries no `<namespace>:` prefix. */
export const DEFAULT_NAMESPACE = 'common' satisfies I18nNamespace;

/** Every namespace of one language, keyed the way i18next's `resources` are. */
export type LanguageCatalogue = Record<I18nNamespace, object>;

/**
 * The 24 catalogue files, each its own lazily-fetched chunk.
 *
 * Statically importing all three languages put 1.03 MB raw / 272 KB gzip on the
 * critical path for the ~166 KB one launch renders; the other two are reachable
 * only after the user switches language. A glob keeps every catalogue a
 * build-time-resolved module specifier, so nothing depends on a base URL at
 * runtime and the loading path is the same in both serving modes — which is
 * what let the packaged renderer move from `file://` to `app://bundle`
 * (ADR 0072) without this file being touched.
 */
const catalogueModules = import.meta.glob<{ default: object }>(
	'./locales/*/*.json',
);

/**
 * Loads every namespace of one language.
 * @param language - The language whose catalogue to fetch
 * @returns The language's eight namespaces, ready to hand i18next
 * @throws When the glob carries no module for one of the namespaces, which
 *   means a catalogue file is missing from `locales/<language>/`
 */
export async function loadCatalogue(
	language: AppLanguage,
): Promise<LanguageCatalogue> {
	const namespaces = await Promise.all(
		I18N_NAMESPACES.map(async (namespace) => {
			const load = catalogueModules[`./locales/${language}/${namespace}.json`];

			if (!load) {
				throw new Error(
					`Missing i18n catalogue for ${language}:${namespace}.json`,
				);
			}

			return [namespace, (await load()).default] as const;
		}),
	);

	return Object.fromEntries(namespaces) as LanguageCatalogue;
}
