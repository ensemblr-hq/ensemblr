import type { TFunction } from 'i18next';

/**
 * Names where the Pi agent directory was resolved from. The environment case is
 * the variable's own name, so it reads the same in every language.
 * @param source - Raw `PiAgentDirectorySource` the check reported.
 * @param t - Translator from the calling component.
 * @returns The source label.
 */
export function piAgentDirectorySourceLabel(
	source: number | string | undefined,
	t: TFunction,
): string {
	return source === 'environment'
		? 'PI_CODING_AGENT_DIR'
		: t('common:setup-check.pi-agent-source.default', 'Pi default location');
}

/** Catalogue entry per raw Pi executable source. */
const PI_EXECUTABLE_SOURCE: Record<string, (t: TFunction) => string> = {
	'built-in-default': (t) =>
		t('common:setup-check.pi-source.built-in-default', 'built-in default'),
	'common-location': (t) =>
		t(
			'common:setup-check.pi-source.common-location',
			'common local binary location',
		),
	'config-default': (t) =>
		t('common:setup-check.pi-source.config-default', 'declarative config'),
	'ensemblr-config': (t) =>
		t(
			'common:setup-check.pi-source.ensemblr-config',
			'Ensemblr repository config',
		),
	'managed-config': (t) =>
		t('common:setup-check.pi-source.managed-config', 'managed config'),
	path: (t) => t('common:setup-check.pi-source.path', 'shell PATH'),
	sqlite: (t) => t('common:setup-check.pi-source.sqlite', 'user override'),
};

/**
 * Names where a Pi executable was resolved from. The checks send the raw source
 * so the label reads in the app language rather than arriving pre-worded.
 * @param source - Raw resolution source the check reported.
 * @param t - Translator from the calling component.
 * @returns The source label.
 */
export function piExecutableSourceLabel(
	source: number | string | undefined,
	t: TFunction,
): string {
	const entry =
		typeof source === 'string' ? PI_EXECUTABLE_SOURCE[source] : undefined;

	return (
		entry?.(t) ?? t('common:setup-check.pi-source.unknown', 'unknown source')
	);
}
