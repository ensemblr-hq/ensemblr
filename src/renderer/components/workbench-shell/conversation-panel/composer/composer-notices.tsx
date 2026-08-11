import { useTranslation } from 'react-i18next';
import type { ComposerStateApi } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import { LinkedDirectoryChip } from './linked-directory-chip';

/**
 * The strip above the composer editor: the directories this chat has been given
 * access to, the attachment error, and the blocked-follow-up notice. Split out
 * of `ComposerPanel` so the panel stays a layout shell and each notice's render
 * condition lives next to the thing it describes. Renders nothing when there is
 * nothing to say.
 *
 * Attachment chips are not here — they live inline in the draft, at the position
 * the user put them. A linked directory is not part of any one message: it stays
 * granted across sends, so it stays above the text where it cannot be mistaken
 * for something the next send carries.
 */
export function ComposerNotices({ state }: { state: ComposerStateApi }) {
	const { t } = useTranslation();
	const pendingPaths = new Set(
		state.pendingLinkedDirectories.map((directory) => directory.path),
	);
	return (
		<>
			{state.linkedDirectories.length > 0 ? (
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
