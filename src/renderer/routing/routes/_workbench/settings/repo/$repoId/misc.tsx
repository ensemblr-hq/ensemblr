import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
import { useDebouncedSettingField } from '@/renderer/hooks/use-debounced-setting-field';
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

/** A preview-URL row paired with a stable local key for React reconciliation. */
type PreviewUrlRow = { id: string; name: string; url: string };

/** Builds a non-empty, lockstep row/key list from a persisted preview-URL seed, falling back to one blank row so the editor always has an input to render. */
function toPreviewRows(seed: RepositoryPreviewUrl[]): PreviewUrlRow[] {
	const source = seed.length > 0 ? seed : [{ name: '', url: '' }];
	return source.map((entry) => ({
		id: crypto.randomUUID(),
		name: entry.name,
		url: entry.url,
	}));
}

/** Structural equality on the persisted fields of two preview-URL lists, ignoring local row keys. */
function previewUrlsEqual(
	a: RepositoryPreviewUrl[],
	b: RepositoryPreviewUrl[],
): boolean {
	return (
		a.length === b.length &&
		a.every(
			(entry, idx) => entry.name === b[idx]?.name && entry.url === b[idx]?.url,
		)
	);
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
				modified={resolved('previewUrls')?.source === 'sqlite'}
				onSave={(urls) => save({ previewUrls: urls })}
				seed={seededPreviewUrls}
			/>

			<FilesToCopySetting
				modified={resolved('filesToCopy')?.source === 'sqlite'}
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
	modified,
	onSave,
	seed,
}: {
	modified: boolean;
	onSave: (urls: RepositoryPreviewUrl[] | null) => void;
	seed: RepositoryPreviewUrl[];
}) {
	const [rows, setRows] = useState<PreviewUrlRow[]>(() => toPreviewRows(seed));
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSavedRef = useRef<RepositoryPreviewUrl[]>(seed);

	useEffect(() => {
		if (previewUrlsEqual(seed, lastSavedRef.current)) {
			return;
		}
		lastSavedRef.current = seed;
		setRows(toPreviewRows(seed));
	}, [seed]);

	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, []);

	const persist = (next: PreviewUrlRow[]) => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			const cleaned = next.reduce<RepositoryPreviewUrl[]>((acc, entry) => {
				if (entry.url.trim()) {
					acc.push({ name: entry.name, url: entry.url });
				}
				return acc;
			}, []);
			lastSavedRef.current = cleaned;
			onSave(cleaned.length === 0 ? null : cleaned);
		}, SAVE_DEBOUNCE_MS);
	};

	const editRow = (idx: number, patch: Partial<RepositoryPreviewUrl>) => {
		const next = rows.map((row, i) => (i === idx ? { ...row, ...patch } : row));
		setRows(next);
		persist(next);
	};

	const deleteRow = (idx: number) => {
		const remaining = rows.filter((_, i) => i !== idx);
		const next = remaining.length > 0 ? remaining : toPreviewRows([]);
		setRows(next);
		persist(next);
	};

	const addRow = () => {
		setRows([...rows, { id: crypto.randomUUID(), name: '', url: '' }]);
	};

	return (
		<SettingRow
			description='Overrides the terminal panel’s Open button URL. Add more than one to switch between them from the Open button dropdown; the first is opened by default and the rest appear in the dropdown in order. Supports `$ENSEMBLR_WORKSPACE_NAME` and `$ENSEMBLR_PORT`. Leave blank to auto-detect from output logs.'
			label='Preview URLs'
			modified={modified}
			onReset={() => onSave(null)}
			stack
		>
			<div className='mt-2 space-y-2'>
				{rows.map((entry, idx) => (
					<div className='flex gap-2' key={entry.id}>
						<Input
							aria-label='Preview URL name'
							className='h-8 w-32 text-xs'
							onChange={(e) => editRow(idx, { name: e.target.value })}
							placeholder='Name'
							value={entry.name}
						/>
						<Input
							aria-label='Preview URL template'
							className='h-8 flex-1 font-mono text-xs'
							onChange={(e) => editRow(idx, { url: e.target.value })}
							placeholder='https://localhost:$ENSEMBLR_PORT'
							value={entry.url}
						/>
						<Button onClick={() => deleteRow(idx)} size='icon' variant='ghost'>
							<Trash2Icon aria-hidden='true' className='size-4' />
						</Button>
					</div>
				))}
				<Button onClick={addRow} size='sm' variant='outline'>
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
	modified,
	onSave,
	seed,
}: {
	modified: boolean;
	onSave: (patterns: string[] | null) => void;
	seed: string;
}) {
	const { onChange, value } = useDebouncedSettingField(
		seed,
		(next) => {
			const patterns = next
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			onSave(patterns.length === 0 ? null : patterns);
			return patterns.join('\n');
		},
		SAVE_DEBOUNCE_MS,
	);

	return (
		<SettingRow
			description='Ensemblr will automatically copy these file paths into each new workspace. Supports gitignore-style globs.'
			label='Files to copy'
			modified={modified}
			onReset={() => onSave(null)}
			stack
		>
			<Textarea
				aria-label='Files to copy'
				className='mt-2 min-h-18 font-mono text-xs'
				onChange={(e) => onChange(e.target.value)}
				placeholder='.env*'
				value={value}
			/>
		</SettingRow>
	);
}
