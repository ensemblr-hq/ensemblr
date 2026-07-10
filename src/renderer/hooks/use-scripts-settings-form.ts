import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
	settingsResolutionQuery,
	updateRepositoryScripts,
} from '@/renderer/api/ensemblr';
import type { RepoProject, ScriptsForm } from '@/renderer/types/settings';

/** Debounce window before a form edit is persisted to SQLite. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Owns the Scripts settings form: local edit state seeded once at mount,
 * debounced persistence to repository-scoped SQLite, a flush on unmount so an
 * in-flight edit is never dropped, and error surfacing via a toast. When
 * `project` is `undefined` (unknown repo) edits stay local and are not
 * persisted.
 *
 * @param repoId - Repository whose scripts are being edited.
 * @param project - Resolved repo project, or `undefined` for an unknown repo.
 * @param initial - Seed values captured from the resolved snapshot at mount.
 * @returns The current form and a debounced field updater.
 */
export function useScriptsSettingsForm(
	repoId: string,
	project: RepoProject,
	initial: ScriptsForm,
): { form: ScriptsForm; updateForm: (patch: Partial<ScriptsForm>) => void } {
	const queryClient = useQueryClient();
	const [form, setForm] = useState<ScriptsForm>(initial);
	const formRef = useRef(form);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const persist = useCallback(async (): Promise<void> => {
		if (!project) {
			return;
		}

		const next = formRef.current;
		try {
			const result = await updateRepositoryScripts({
				archive: next.archive.trim() ? next.archive : null,
				autoRunAfterSetup: next.autoRun,
				repositoryId: repoId,
				run: next.run.trim() ? next.run : null,
				runScriptMode: next.runMode,
				setup: next.setup.trim() ? next.setup : null,
			});
			if (!result.ok) {
				toast.error('Could not save script settings.');
				return;
			}
			await queryClient.invalidateQueries({
				queryKey: settingsResolutionQuery({
					repositoryId: repoId,
					repositoryPath: project.pathLabel,
				}).queryKey,
			});
		} catch {
			toast.error('Could not save script settings.');
		}
	}, [project, queryClient, repoId]);

	// Keep the latest persist closure reachable from the unmount-only cleanup.
	const persistRef = useRef(persist);
	persistRef.current = persist;

	// Flush a pending debounced save on unmount so a just-typed edit survives
	// navigating away inside the debounce window.
	useEffect(
		() => () => {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
				saveTimerRef.current = null;
				void persistRef.current();
			}
		},
		[],
	);

	const updateForm = useCallback(
		(patch: Partial<ScriptsForm>): void => {
			const next = { ...formRef.current, ...patch };
			formRef.current = next;
			setForm(next);

			if (!project) {
				return;
			}

			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = setTimeout(() => {
				saveTimerRef.current = null;
				void persist();
			}, SAVE_DEBOUNCE_MS);
		},
		[persist, project],
	);

	return { form, updateForm };
}
