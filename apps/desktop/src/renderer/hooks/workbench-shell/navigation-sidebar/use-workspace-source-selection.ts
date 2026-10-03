import { useState } from 'react';
import type {
	ProjectShellModel,
	WorkspaceSourceKind,
} from '@/renderer/types/workbench';

/** The tab a create-from picker opens on. */
const DEFAULT_SOURCE_KIND: WorkspaceSourceKind = 'pull-request';

/**
 * Owns what the create-from picker is pointed at — the source tab, the
 * repository, and the search query — and starts each open over. The dialog
 * outlives its content, so a reopen clears the search, and a reopen that names
 * the repository it was launched from (`project`) also moves the picker onto
 * that repository and back to the default tab. A reopen without one keeps the
 * last repository and tab. The reset runs during render rather than in an
 * effect, so the first frame of an open never shows the previous open's search.
 * @param options - Whether the dialog is open, the repository it was opened
 *   from (if any), and every repository it may switch to
 * @returns The selection, its setters, and the selected repository's model
 */
export function useWorkspaceSourceSelection({
	open,
	project,
	projects,
}: {
	open: boolean;
	project: ProjectShellModel | null;
	projects: ProjectShellModel[];
}) {
	const [kind, setKind] = useState<WorkspaceSourceKind>(DEFAULT_SOURCE_KIND);
	const [repoId, setRepoId] = useState(project?.id ?? projects[0]?.id ?? '');
	const [search, setSearch] = useState('');
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSearch('');
		}
		if (open && project) {
			setRepoId(project.id);
			setKind(DEFAULT_SOURCE_KIND);
		}
	}

	const selectedRepo =
		projects.find((candidate) => candidate.id === repoId) ?? project ?? null;

	return { kind, repoId, search, selectedRepo, setKind, setRepoId, setSearch };
}
