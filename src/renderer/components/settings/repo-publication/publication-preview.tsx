import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import type {
	SettingsPublicationPreview,
	SettingsPublicationSourceStatus,
} from '@/shared/ipc/contracts/settings-publication';

/**
 * Describes the root clone's copy in words, since `sourceStatus` is the only
 * thing that tells the user why a file they never edited here is pending.
 * @param t - Translator bound to the active language.
 * @param status - Root checkout state the backend reported.
 * @returns The localized description of the root copy.
 */
function sourceStatusLabel(
	t: TFunction,
	status: SettingsPublicationSourceStatus,
): string {
	switch (status) {
		case 'deleted':
			return t(
				'settings:repo.publication.source-status.deleted',
				'Deleted since the last commit',
			);
		case 'missing':
			return t(
				'settings:repo.publication.source-status.missing',
				'Not present',
			);
		case 'modified':
			return t(
				'settings:repo.publication.source-status.modified',
				'Edited since the last commit',
			);
		default:
			return t(
				'settings:repo.publication.source-status.untracked',
				'Never committed',
			);
	}
}

/** The merged file itself, capped in height so a long settings file cannot push the actions off screen. */
function MergedFileBlock({ text }: { text: string }) {
	const { t } = useTranslation();

	return (
		<section
			aria-label={t('settings:repo.publication.merged.label', 'Merged file')}
			className='max-h-80 overflow-auto rounded-lg bg-muted/40'
		>
			<pre className='px-3 py-2 font-mono text-foreground text-xs leading-relaxed'>
				{text}
			</pre>
		</section>
	);
}

/**
 * The pending publication as the backend prepared it: where the root copy
 * stands, what the workspace's file becomes, and — only for a clean merge — the
 * action that writes it. A conflict is reported rather than offered, because
 * both copies are still intact and only the user can say which one is right.
 */
export function PublicationPreview({
	onApply,
	pending,
	preview,
}: {
	/** Publishes the preview the backend already holds under its token. */
	onApply: () => void;
	/** True while the apply call is in flight. */
	pending: boolean;
	preview: SettingsPublicationPreview;
}) {
	const { t } = useTranslation();
	const isConflict = preview.status === 'conflict';

	return (
		<>
			<SettingRow
				control={
					<Badge variant='secondary'>
						{sourceStatusLabel(t, preview.sourceStatus)}
					</Badge>
				}
				description={t(
					'settings:repo.publication.source.description',
					'The state of .ensemblr/settings.toml in the repository’s root clone, which is where these edits were stranded.',
				)}
				label={t('settings:repo.publication.source.label', 'Root clone')}
			/>

			{preview.hasLegacyScripts ? (
				<SettingRow
					description={t(
						'settings:repo.publication.legacy-scripts.description',
						'Retained script settings from an older Ensemblr version are folded into the merged file.',
					)}
					label={t(
						'settings:repo.publication.legacy-scripts.label',
						'Older script settings included',
					)}
				/>
			) : null}

			<SettingRow
				description={
					isConflict
						? t(
								'settings:repo.publication.merged.conflict-description',
								'Git could not merge the two copies, so the block below carries its conflict markers.',
							)
						: t(
								'settings:repo.publication.merged.clean-description',
								'This is what the workspace’s .ensemblr/settings.toml becomes.',
							)
				}
				label={t('settings:repo.publication.merged.label', 'Merged file')}
				stack
			>
				<MergedFileBlock text={preview.mergedText} />
			</SettingRow>

			{isConflict ? (
				<SettingRow
					description={t(
						'settings:repo.publication.conflict.description',
						'Nothing has been changed and both files are still intact. Edit either the root clone’s file or the workspace’s file by hand to settle the difference, then check again.',
					)}
					label={t(
						'settings:repo.publication.conflict.label',
						'Publishing is unavailable',
					)}
				/>
			) : (
				<SettingRow
					control={
						<Button disabled={pending} onClick={onApply} size='sm'>
							{pending
								? t('settings:repo.publication.applying', 'Publishing…')
								: t(
										'settings:repo.publication.apply.action',
										'Publish to workspace',
									)}
						</Button>
					}
					description={t(
						'settings:repo.publication.apply.description',
						'Writes the merged file on the workspace’s branch. The root clone keeps its own copy until you remove it.',
					)}
					label={t('settings:repo.publication.apply.label', 'Publish')}
				/>
			)}
		</>
	);
}
