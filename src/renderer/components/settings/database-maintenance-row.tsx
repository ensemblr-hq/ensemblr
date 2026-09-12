import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { compactDatabase, healthQuery } from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';

/**
 * Decimal, not binary — matches Finder/Explorer and interpolates cleanly into
 * translated copy via `Intl.NumberFormat`'s `unit` style.
 */
const BYTE_UNIT_STEP = 1000;
const BYTE_UNITS = [
	'byte',
	'kilobyte',
	'megabyte',
	'gigabyte',
	'terabyte',
] as const;

/**
 * Renders a byte count as a short size in the user's own language.
 * @param bytes - Size in bytes, or null when unknown.
 * @param language - Active i18next language tag.
 * @returns The formatted size, or null when there is no number to show.
 */
function formatByteSize(bytes: number | null, language: string): string | null {
	if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
		return null;
	}

	let value = bytes;
	let unitIndex = 0;
	while (value >= BYTE_UNIT_STEP && unitIndex < BYTE_UNITS.length - 1) {
		value /= BYTE_UNIT_STEP;
		unitIndex += 1;
	}

	const unit = BYTE_UNITS[unitIndex] ?? 'byte';
	try {
		return new Intl.NumberFormat(language, {
			maximumFractionDigits: unitIndex === 0 ? 0 : 1,
			style: 'unit',
			unit,
			unitDisplay: 'short',
		}).format(value);
	} catch {
		return `${Math.round(value)} ${unit}`;
	}
}

/**
 * Reports the local database's on-disk size and offers to compact it.
 *
 * Retention prunes old agent history on every launch, but SQLite only frees
 * those pages onto its own internal freelist — the file on disk never shrinks
 * without a `VACUUM`, which is what the button runs. `VACUUM` rewrites the
 * whole file on the single synchronous database connection this app holds, so
 * it blocks every other database-backed IPC call for its duration; the button
 * is gated behind a second confirming click (arm-in-place, the same
 * interaction `ConfirmDestructiveButton` uses for irreversible actions) since
 * this operation is slow rather than destructive, and disabled while it runs
 * so it cannot be started twice.
 */
export function DatabaseMaintenanceRow() {
	const { t, i18n } = useTranslation();
	const queryClient = useQueryClient();
	const { data: health } = useQuery(healthQuery);
	const [armed, setArmed] = useState(false);

	const compact = useMutation({
		mutationFn: compactDatabase,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: healthQuery.queryKey });
		},
	});

	const sizeLabel = formatByteSize(
		health?.database.sizeBytes ?? null,
		i18n.language,
	);
	const reclaimed =
		compact.data &&
		compact.data.sizeBytesBefore !== null &&
		compact.data.sizeBytesAfter !== null
			? formatByteSize(
					compact.data.sizeBytesBefore - compact.data.sizeBytesAfter,
					i18n.language,
				)
			: null;

	return (
		<SettingRow
			control={
				<Button
					disabled={compact.isPending}
					onBlur={() => setArmed(false)}
					onClick={() => {
						if (!armed) {
							setArmed(true);
							return;
						}
						setArmed(false);
						compact.mutate();
					}}
					size='sm'
					variant='secondary'
				>
					{compact.isPending ? (
						<Spinner className='size-4' />
					) : (
						<DatabaseIcon aria-hidden='true' className='size-4' />
					)}
					{compact.isPending
						? t('settings:diagnostics.database.compacting', 'Compacting…')
						: armed
							? t(
									'settings:diagnostics.database.compact-confirm',
									'Click again to confirm',
								)
							: t('settings:diagnostics.database.compact', 'Compact database')}
				</Button>
			}
			description={t(
				'settings:diagnostics.database.description',
				'Ensemblr prunes old agent history automatically, but SQLite does not shrink the file on disk by itself. Compacting rewrites the whole file to reclaim that space, and blocks other database activity while it runs.',
			)}
			label={t('settings:diagnostics.database.label', 'Database')}
			stack
		>
			<p className='text-muted-foreground text-xs'>
				{sizeLabel
					? t('settings:diagnostics.database.size', '{{size}} on disk', {
							size: sizeLabel,
						})
					: null}
			</p>
			{reclaimed ? (
				<p className='text-status-ok text-xs'>
					{t('settings:diagnostics.database.result', 'Reclaimed {{size}}.', {
						size: reclaimed,
					})}
				</p>
			) : null}
			{compact.isError ? (
				<p className='text-status-danger text-xs'>
					{t(
						'settings:diagnostics.database.failed',
						'Could not compact the database: {{error}}.',
						{
							error:
								compact.error instanceof Error
									? compact.error.message
									: String(compact.error),
						},
					)}
				</p>
			) : null}
		</SettingRow>
	);
}
