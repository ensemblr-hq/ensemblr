import type { RepositoryPreviewUrl } from '@/shared/ipc/contracts/repository-settings';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/** A resolved, interpolated preview URL option shown on the dock Open control. */
export interface PreviewUrlOption {
	name: string;
	url: string;
}

/**
 * Reads the configured per-repo preview URLs from the resolved settings
 * snapshot, dropping entries without a URL. Empty when none are configured, in
 * which case the dock falls back to the auto-detected preview URL.
 * @param resolution - Resolved settings snapshot, when loaded.
 * @returns The configured preview URL entries.
 */
export function configuredPreviewUrls(
	resolution: SettingsResolutionSnapshot | undefined,
): RepositoryPreviewUrl[] {
	const value = resolution?.repository?.settings.find(
		(setting) => setting.key === 'previewUrls',
	)?.value;

	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter(
		(entry): entry is RepositoryPreviewUrl =>
			typeof entry === 'object' &&
			entry !== null &&
			typeof (entry as RepositoryPreviewUrl).url === 'string' &&
			(entry as RepositoryPreviewUrl).url.trim().length > 0,
	);
}

/**
 * Substitutes the `$ENSEMBLR_PORT` and `$ENSEMBLR_WORKSPACE_NAME` template
 * fields a configured preview URL may reference. An unknown port leaves the
 * `$ENSEMBLR_PORT` token intact so the user can see it was not resolved.
 * @param template - Configured preview URL template.
 * @param fields - The detected run port and the workspace name.
 * @returns The interpolated URL.
 */
function interpolatePreviewUrl(
	template: string,
	fields: { port: number | null; workspaceName: string },
): string {
	return template
		.replaceAll('$ENSEMBLR_WORKSPACE_NAME', fields.workspaceName)
		.replaceAll(
			'$ENSEMBLR_PORT',
			fields.port === null ? '$ENSEMBLR_PORT' : String(fields.port),
		);
}

/**
 * Resolves the effective ordered preview URL options for the dock Open control:
 * the interpolated configured entries when present, otherwise the auto-detected
 * URL as a single option, otherwise none.
 * @param input - Configured entries, the auto-detected URL, and interpolation fields.
 * @returns The ordered preview URL options (first is the default action).
 */
export function resolvePreviewUrlOptions({
	configured,
	detectedUrl,
	port,
	workspaceName,
}: {
	configured: RepositoryPreviewUrl[];
	detectedUrl: string | null;
	port: number | null;
	workspaceName: string;
}): PreviewUrlOption[] {
	if (configured.length > 0) {
		return configured.map((entry, index) => ({
			name: entry.name.trim() || `Preview ${index + 1}`,
			url: interpolatePreviewUrl(entry.url, { port, workspaceName }),
		}));
	}

	return detectedUrl ? [{ name: 'Open', url: detectedUrl }] : [];
}
