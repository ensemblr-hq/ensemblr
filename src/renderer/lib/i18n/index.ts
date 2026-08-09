/**
 * Public surface of the renderer i18n concern: the initialized i18next
 * singleton plus the namespace catalogue metadata.
 *
 * `i18n.t()` is for `lib/` only — anything reachable from a component or hook
 * must call `useTranslation()` instead, or it will not re-render when the
 * language changes.
 */

export { INITIAL_LANGUAGE, i18n } from './instance';
export {
	DEFAULT_NAMESPACE,
	I18N_NAMESPACES,
	type I18nNamespace,
	resources,
} from './resources';
