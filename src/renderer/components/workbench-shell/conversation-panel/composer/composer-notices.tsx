import { useTranslation } from 'react-i18next';
import type { ComposerStateApi } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import { AttachmentChip } from './attachment-chip';

/**
 * The strip above the composer textarea: attachment chips, the attachment
 * error, and the blocked-follow-up notice. Split out of `ComposerPanel` so the
 * panel stays a layout shell and each notice's render condition lives next to
 * the thing it describes. Renders nothing when there is nothing to say.
 */
export function ComposerNotices({ state }: { state: ComposerStateApi }) {
	const { t } = useTranslation();
	return (
		<>
			{state.hasChips ? (
				<div className='flex flex-wrap gap-1.5'>
					{state.mentionAttachments.map((entry) => (
						<AttachmentChip
							file={entry}
							key={`mention:${entry.path}`}
							onRemove={() => state.removeMention(entry.path)}
						/>
					))}
					{state.uploadAttachments.map((file, index) => (
						<AttachmentChip
							file={{ kind: 'upload', name: file.name }}
							key={`upload:${file.name}:${file.size}:${file.lastModified}`}
							onRemove={() => state.removeUpload(index)}
						/>
					))}
					{state.externalAttachments.map((external) => (
						<AttachmentChip
							file={{ kind: 'external', name: external.name }}
							key={`external:${external.absolutePath}`}
							onRemove={() => state.removeExternal(external.absolutePath)}
						/>
					))}
				</div>
			) : null}
			{state.attachmentError ? (
				<div className='text-destructive text-xs' role='alert'>
					{state.attachmentError}
				</div>
			) : null}
			{state.blockedNotice ? (
				<output className='text-muted-foreground text-xs'>
					{t(
						'workbench:composer.blocked-follow-up',
						'Follow-ups are blocked while the agent is working — stop the turn or wait for it to finish.',
					)}
				</output>
			) : null}
		</>
	);
}
