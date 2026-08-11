import { useTranslation } from 'react-i18next';
import type { ComposerStateApi } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import type { ComposerAttachment } from '@/renderer/types/workbench';
import { AttachmentChip } from './attachment-chip';
import { LinkedDirectoryChip } from './linked-directory-chip';
import { PastedTextChip } from './pasted-text-chip';

/**
 * Renders one attachment as the chip its kind calls for: a pasted block shows a
 * preview card, since its filename says nothing about which paste it is.
 */
function ComposerChip({
	attachment,
	onRemove,
}: {
	attachment: ComposerAttachment;
	onRemove: () => void;
}) {
	if (attachment.kind === 'pasted-text') {
		return (
			<PastedTextChip
				lineCount={attachment.lineCount}
				onRemove={onRemove}
				preview={attachment.preview}
			/>
		);
	}
	return <AttachmentChip attachment={attachment} onRemove={onRemove} />;
}

/**
 * The strip above the composer textarea: attachment chips, the attachment
 * error, and the blocked-follow-up notice. Split out of `ComposerPanel` so the
 * panel stays a layout shell and each notice's render condition lives next to
 * the thing it describes. Renders nothing when there is nothing to say.
 */
export function ComposerNotices({ state }: { state: ComposerStateApi }) {
	const { t } = useTranslation();
	const pendingPaths = new Set(
		state.pendingLinkedDirectories.map((directory) => directory.path),
	);
	return (
		<>
			{state.hasChips || state.linkedDirectories.length > 0 ? (
				<div className='flex flex-wrap items-end gap-1.5'>
					{state.linkedDirectories.map((directory) => (
						<LinkedDirectoryChip
							key={directory.path}
							name={directory.name}
							onRemove={() => state.unlinkDirectory(directory.path)}
							path={directory.path}
							pending={pendingPaths.has(directory.path)}
						/>
					))}
					{state.attachments.map((attachment) => (
						<ComposerChip
							attachment={attachment}
							key={attachment.id}
							onRemove={() => state.removeAttachment(attachment.id)}
						/>
					))}
				</div>
			) : null}
			{state.pendingLinkedDirectories.length > 0 ? (
				<output className='text-muted-foreground text-xs'>
					{t('workbench:composer.linked-directory-pending', {
						count: state.pendingLinkedDirectories.length,
						defaultValue_one:
							'The agent reads a newly linked directory from the next session — reopen this chat to give it access.',
						defaultValue_other:
							'The agent reads newly linked directories from the next session — reopen this chat to give it access.',
					})}
				</output>
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
