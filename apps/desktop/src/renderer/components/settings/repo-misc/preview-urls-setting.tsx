import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { SETTING_SAVE_DEBOUNCE_MS } from '@/renderer/hooks/use-debounced-setting-field';
import type { RepositoryPreviewUrl } from '@/shared/ipc/contracts/repository-settings';

/** A preview-URL row paired with a stable local key for React reconciliation. */
type PreviewUrlRow = { id: string; name: string; url: string };

/**
 * Editable list of per-repo preview URLs persisted to SQLite. Each edit is
 * debounced; an empty list clears the personal override so the dock falls back
 * to auto-detected preview URLs.
 */
export function PreviewUrlsSetting({
	modified,
	onSave,
	seed,
}: {
	modified: boolean;
	onSave: (urls: RepositoryPreviewUrl[] | null) => void;
	seed: RepositoryPreviewUrl[];
}) {
	const { t } = useTranslation();
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
		}, SETTING_SAVE_DEBOUNCE_MS);
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
			description={t(
				'settings:repo.preview-urls.description',
				'Overrides the terminal panel’s Open button URL. Add more than one to switch between them from the Open button dropdown; the first is opened by default and the rest appear in the dropdown in order. Supports `$ENSEMBLR_WORKSPACE_NAME` and `$ENSEMBLR_PORT`. Leave blank to auto-detect from output logs.',
			)}
			label={t('settings:repo.preview-urls.label', 'Preview URLs')}
			modified={modified}
			onReset={() => onSave(null)}
			stack
		>
			<div className='space-y-2'>
				{rows.map((entry, idx) => (
					<div className='flex items-center gap-2' key={entry.id}>
						<Input
							aria-label={t(
								'settings:repo.preview-urls.name-aria-label',
								'Preview URL name',
							)}
							className='h-7 w-32 text-xs'
							onChange={(e) => editRow(idx, { name: e.target.value })}
							placeholder={t(
								'settings:repo.preview-urls.name-placeholder',
								'Name',
							)}
							value={entry.name}
						/>
						<Input
							aria-label={t(
								'settings:repo.preview-urls.template-aria-label',
								'Preview URL template',
							)}
							className='h-7 flex-1 font-mono text-xs'
							onChange={(e) => editRow(idx, { url: e.target.value })}
							placeholder='https://localhost:$ENSEMBLR_PORT'
							value={entry.url}
						/>
						<Button
							aria-label={t(
								'settings:repo.preview-urls.delete-aria-label',
								'Delete preview URL',
							)}
							onClick={() => deleteRow(idx)}
							size='icon-sm'
							variant='ghost'
						>
							<Trash2Icon aria-hidden='true' className='size-3.5' />
						</Button>
					</div>
				))}
				<Button onClick={addRow} size='sm' variant='outline'>
					<PlusIcon aria-hidden='true' data-icon='inline-start' />
					{t('settings:repo.preview-urls.add', 'Add preview URL')}
				</Button>
			</div>
		</SettingRow>
	);
}

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
