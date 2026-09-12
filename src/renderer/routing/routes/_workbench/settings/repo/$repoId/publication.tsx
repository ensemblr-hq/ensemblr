import { createFileRoute } from '@tanstack/react-router';

import { SettingsPublicationPanel } from '@/renderer/components/settings/repo-publication/settings-publication-panel';

/** Route for a repository's Settings file page; publishes the root clone's pending `.ensemblr/settings.toml` onto a live workspace keyed by the `repoId` path param. */
export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/publication',
)({
	component: RepoPublicationSettings,
});

/**
 * Per-repository settings publication. Remounted per repo via `key` so the
 * picked workspace and any in-progress publication reset when the route param
 * changes.
 */
function RepoPublicationSettings() {
	const { repoId } = Route.useParams();

	return <SettingsPublicationPanel key={repoId} repoId={repoId} />;
}
