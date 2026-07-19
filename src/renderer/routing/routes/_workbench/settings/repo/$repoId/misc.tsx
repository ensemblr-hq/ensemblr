import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';

import {
	getEnsemblrApi,
	invalidateWorkspaceListViews,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useRepoSettings } from '@/renderer/hooks/use-repo-settings';
import { useRepoSettingsWriter } from '@/renderer/hooks/use-repo-settings-writer';
import type { RepositoryPreviewUrl } from '@/shared/ipc/contracts/repository-settings';
import type { ResolvedSettingSnapshot } from '@/shared/ipc/contracts/settings-resolution';

/** Debounce window before a Misc field edit is persisted to SQLite. */
const SAVE_DEBOUNCE_MS = 500;

/** Reads the personal (SQLite) preview URL rows from a resolved snapshot. */
function personalPreviewUrls(
	resolved: ResolvedSettingSnapshot | undefined,
): RepositoryPreviewUrl[] {
	if (resolved?.source !== 'sqlite' || !Array.isArray(resolved.value)) {
		return [];
	}

	return resolved.value.filter(
		(entry): entry is RepositoryPreviewUrl =>
			typeof entry === 'object' && entry !== null,
	);
}

/** Reads the personal (SQLite) files-to-copy patterns as a newline string. */
function personalFilesToCopy(
	resolved: ResolvedSettingSnapshot | undefined,
): string {
	if (resolved?.source !== 'sqlite' || !Array.isArray(resolved.value)) {
		return '';
	}

	return resolved.value.filter((entry) => typeof entry === 'string').join('\n');
}

/** Route for a repository's Misc settings; renders the repo-scoped paths, preview URLs, and lifecycle panel keyed by the `repoId` path param. */
export const Route = createFileRoute('/_workbench/settings/repo/$repoId/misc')({
	component: RepoMiscSettings,
});

/** Repository-scoped Misc settings panel for root/workspace paths, preview URLs, files-to-copy globs, and repository removal. */
function RepoMiscSettings() {
	const { repoId } = Route.useParams();
	const { resolved, project } = useRepoSettings(repoId);
	const save = useRepoSettingsWriter(repoId, project);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [removeError, setRemoveError] = useState<string | null>(null);

	const remove = useMutation({
		mutationFn: () =>
			getEnsemblrApi().archiveRepository({ repositoryId: repoId }),
		onSuccess: async () => {
			await invalidateWorkspaceListViews(queryClient);
			navigate({ to: '/settings/general' });
		},
		onError: (error) =>
			setRemoveError(error instanceof Error ? error.message : String(error)),
	});

	const seededPreviewUrls = personalPreviewUrls(resolved('previewUrls'));
	const seededFilesToCopy = personalFilesToCopy(resolved('filesToCopy'));

	return (
		<SettingsSection
			description='Repository paths, preview URLs, files-to-copy patterns, and lifecycle.'
			title='Misc'
		>
			<SettingRow
				description='Do not move or delete this directory. Instead, remove the repository in Ensemblr.'
				label='Root path'
				stack
			>
				<code className='mt-2 block truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs'>
					{project?.pathLabel ?? '—'}
				</code>
			</SettingRow>

			<SettingRow
				description='Do not move or delete the workspace subdirectories. Instead, archive workspaces in Ensemblr.'
				label='Workspaces path'
				stack
			>
				<code className='mt-2 block truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs'>
					{project ? `${project.pathLabel} (workspaces)` : '—'}
				</code>
			</SettingRow>

			<PreviewUrlsSetting
				key={JSON.stringify(seededPreviewUrls)}
				onSave={(urls) => save({ previewUrls: urls })}
				seed={seededPreviewUrls}
			/>

			<FilesToCopySetting
				key={seededFilesToCopy}
				onSave={(patterns) => save({ filesToCopy: patterns })}
				seed={seededFilesToCopy}
			/>

			<div className='pt-6'>
				<Dialog>
					<DialogTrigger asChild>
						<Button size='sm' variant='destructive'>
							<Trash2Icon aria-hidden='true' className='size-4' />
							Remove repository
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Remove this repository?</DialogTitle>
							<DialogDescription>
								Removes the repository from Ensemblr. The on-disk directory at
								<code className='mx-1 font-mono text-xs'>
									{project?.pathLabel}
								</code>
								is not deleted; delete it manually if you want it gone.
							</DialogDescription>
						</DialogHeader>
						{removeError ? (
							<p className='text-status-danger text-xs'>{removeError}</p>
						) : null}
						<DialogFooter>
							<DialogClose asChild>
								<Button variant='ghost'>Cancel</Button>
							</DialogClose>
							<Button
								disabled={remove.isPending}
								onClick={() => remove.mutate()}
								variant='destructive'
							>
								{remove.isPending ? 'Removing…' : 'Remove'}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</SettingsSection>
	);
}

/**
 * Editable list of per-repo preview URLs persisted to SQLite. Each edit is
 * debounced; an empty list clears the personal override so the dock falls back
 * to auto-detected preview URLs.
 */
function PreviewUrlsSetting({
	onSave,
	seed,
}: {
	onSave: (urls: RepositoryPreviewUrl[] | null) => void;
	seed: RepositoryPreviewUrl[];
}) {
	const [rows, setRows] = useState<RepositoryPreviewUrl[]>(seed);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// previewUrls entries carry no persistent id, so track one stable key per row
	// locally so removing a middle row can't reassociate a controlled <Input>.
	// The parent remounts this component (via `key`) when the resolved seed
	// changes, so state is initialised from `seed` once per resolved value.
	const [rowIds, setRowIds] = useState<string[]>(() =>
		seed.map(() => crypto.randomUUID()),
	);

	const persist = (next: RepositoryPreviewUrl[]) => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			const cleaned = next.filter((entry) => entry.url.trim());
			onSave(cleaned.length === 0 ? null : cleaned);
		}, SAVE_DEBOUNCE_MS);
	};

	const displayRows = rows.length === 0 ? [{ name: '', url: '' }] : rows;

	return (
		<SettingRow
			description='Overrides the terminal panel’s Open button URL. Add more than one to switch between them from the Open button dropdown; the first is opened by default and the rest appear in the dropdown in order. Supports `$ENSEMBLR_WORKSPACE_NAME` and `$ENSEMBLR_PORT`. Leave blank to auto-detect from output logs.'
			label='Preview URLs'
			stack
		>
			<div className='mt-2 space-y-2'>
				{displayRows.map((entry, idx) => (
					<div className='flex gap-2' key={rowIds[idx] ?? 'seed'}>
						<Input
							aria-label='Preview URL name'
							className='h-8 w-32 text-xs'
							onChange={(e) => {
								const next = displayRows.map((row, i) =>
									i === idx ? { ...row, name: e.target.value } : row,
								);
								setRows(next);
								persist(next);
							}}
							placeholder='Name'
							value={entry.name}
						/>
						<Input
							aria-label='Preview URL template'
							className='h-8 flex-1 font-mono text-xs'
							onChange={(e) => {
								const next = displayRows.map((row, i) =>
									i === idx ? { ...row, url: e.target.value } : row,
								);
								setRows(next);
								persist(next);
							}}
							placeholder='https://localhost:$ENSEMBLR_PORT'
							value={entry.url}
						/>
						<Button
							onClick={() => {
								const next = displayRows.filter((_, i) => i !== idx);
								setRows(next);
								setRowIds((ids) => ids.filter((_, i) => i !== idx));
								persist(next);
							}}
							size='icon'
							variant='ghost'
						>
							<Trash2Icon aria-hidden='true' className='size-4' />
						</Button>
					</div>
				))}
				<Button
					onClick={() => {
						setRows([...displayRows, { name: '', url: '' }]);
						setRowIds((ids) => [...ids, crypto.randomUUID()]);
					}}
					size='sm'
					variant='outline'
				>
					+ Add preview URL
				</Button>
			</div>
		</SettingRow>
	);
}

/**
 * Files-to-copy globs persisted to SQLite. Debounced; an empty value clears the
 * personal override so the built-in `.env*` default applies.
 */
function FilesToCopySetting({
	onSave,
	seed,
}: {
	onSave: (patterns: string[] | null) => void;
	seed: string;
}) {
	// Uncontrolled: seeds from `seed` via defaultValue and persists on a debounce.
	// The parent remounts this component (via `key`) when the resolved value
	// changes, so defaultValue re-seeds without mirroring state.
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const onChange = (next: string) => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			const patterns = next
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			onSave(patterns.length === 0 ? null : patterns);
		}, SAVE_DEBOUNCE_MS);
	};

	return (
		<SettingRow
			description='Ensemblr will automatically copy these file paths into each new workspace. Supports gitignore-style globs.'
			label='Files to copy'
			stack
		>
			<Textarea
				aria-label='Files to copy'
				className='mt-2 min-h-18 font-mono text-xs'
				defaultValue={seed}
				onChange={(e) => onChange(e.target.value)}
				placeholder='.env*'
			/>
		</SettingRow>
	);
}
