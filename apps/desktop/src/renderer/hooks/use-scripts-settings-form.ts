import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	ensemblrQueryKeys,
	updateRepositoryScripts,
} from '@/renderer/api/ensemblr';
import type { RepoProject, ScriptsForm } from '@/renderer/types/settings';

/** Debounce window before a form edit is written to the committed config. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Owns the Scripts settings form: local edit state seeded once at mount,
 * debounced writes to a chosen live workspace's committed
 * `.ensemblr/settings.toml`, a flush on unmount so an in-flight edit is never
 * dropped, and error surfacing via a toast. When `project` or `workspaceId` is
 * missing (unknown repo, or no live workspace to write to) edits stay local
 * and are not persisted.
 *
 * @param repoId - Repository whose scripts are being edited.
 * @param project - Resolved repo project, or `undefined` for an unknown repo.
 * @param initial - Seed values captured from the resolved snapshot at mount.
 * @param workspaceId - Live workspace whose branch receives the write, or `undefined` when the repo has none.
 * @returns The current form and a debounced field updater.
 */
export function useScriptsSettingsForm(
	repoId: string,
	project: RepoProject,
	initial: ScriptsForm,
	workspaceId: string | undefined,
): { form: ScriptsForm; updateForm: (patch: Partial<ScriptsForm>) => void } {
	const queryClient = useQueryClient();
	const { t } = useTranslation();
	const [form, setForm] = useState<ScriptsForm>(initial);
	const formRef = useRef(form);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const persist = useCallback(async (): Promise<void> => {
		if (!project || !workspaceId) {
			return;
		}

		const next = formRef.current;
		try {
			const result = await updateRepositoryScripts({
				archive: next.archive.trim() ? next.archive : null,
				autoRunAfterSetup: next.autoRun,
				repositoryId: repoId,
				runScripts: next.runScripts,
				runScriptMode: next.runMode,
				setup: next.setup.trim() ? next.setup : null,
				workspaceId,
			});
			if (!result.ok) {
				toast.error(
					t(
						'errors:script-settings.save-failed.title',
						'Could not save script settings.',
					),
				);
				return;
			}
			await queryClient.invalidateQueries({
				queryKey: ensemblrQueryKeys.settingsResolution(repoId),
			});
		} catch {
			toast.error(
				t(
					'errors:script-settings.save-failed.title',
					'Could not save script settings.',
				),
			);
		}
	}, [project, queryClient, repoId, t, workspaceId]);

	// Keep the latest persist closure reachable from the unmount-only cleanup.
	const persistRef = useRef(persist);
	useEffect(() => {
		persistRef.current = persist;
	});

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

			if (!project || !workspaceId) {
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
		[persist, project, workspaceId],
	);

	return { form, updateForm };
}
