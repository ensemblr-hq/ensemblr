import { SparklesIcon } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { useComposerAttachmentDispatcher } from '@/renderer/state/composer';
import type { ClosedChatTabEntryWire } from '@/shared/ipc/contracts/chat-tab';

/**
 * Empty-state shown above the composer when a workspace has prior chats /
 * transcripts in `.context/` but no active agent session in the current tab.
 * Lists each transcript as a chip the user can attach to the new chat.
 */
export function NewChatEmptyState({
	activeChatTabId,
	transcripts,
	workspaceCwd,
	workspaceName,
}: {
	activeChatTabId: string;
	transcripts: readonly ClosedChatTabEntryWire[];
	workspaceCwd: string;
	workspaceName: string;
}) {
	const { t } = useTranslation();
	return (
		<section
			aria-label={t('workbench:new-chat.aria-label', 'New chat empty state')}
			className='flex flex-col items-start gap-4 text-sm'
			data-new-chat-state='empty'
		>
			<p className='text-muted-foreground'>
				<Trans
					components={{ path: <span className='font-mono' /> }}
					defaults='New chat in <path>/{{workspaceName}}</path>.'
					i18nKey='workbench:new-chat.headline'
					values={{ workspaceName }}
				/>
			</p>

			{transcripts.length > 0 ? (
				<div className='flex flex-col items-start gap-2'>
					<p className='text-muted-foreground text-xs'>
						{t('workbench:new-chat.transcripts-label', 'Add chat transcripts:')}
					</p>
					<ul className='flex flex-wrap gap-2'>
						{transcripts.map((entry) => (
							<li key={entry.tab.id}>
								<TranscriptChip
									activeChatTabId={activeChatTabId}
									entry={entry}
									workspaceCwd={workspaceCwd}
								/>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}

/** Renders a closed-chat transcript as a chip that can be attached to the composer. */
function TranscriptChip({
	activeChatTabId,
	entry,
	workspaceCwd,
}: {
	activeChatTabId: string;
	entry: ClosedChatTabEntryWire;
	workspaceCwd: string;
}) {
	const { t } = useTranslation();
	// Mirror the open tab label — the short chat-title set on the tab itself
	// is the user's anchor. The LLM-derived summary title is verbose and
	// inconsistent so it is only used as a last-resort fallback.
	const label =
		entry.tab.title ||
		entry.summaryTitle ||
		t('workbench:new-chat.untitled-transcript', 'Untitled transcript');
	const dispatch = useComposerAttachmentDispatcher();

	const handleAttach = () => {
		// The composer's mention payload reader rejects absolute paths, so
		// strip the workspaceCwd prefix before dispatching. Falls back to the
		// raw path when the prefix does not match — the read will then error
		// visibly instead of silently attaching the wrong file.
		const relativePath = toWorkspaceRelative(workspaceCwd, entry.summaryPath);
		dispatch(activeChatTabId, {
			id: `transcript:${entry.tab.id}`,
			kind: 'workspace-file',
			label,
			path: relativePath,
		});
	};

	return (
		<Button
			className='h-auto gap-1.5 rounded-md bg-pane px-2.5 py-1 text-xs hover:border-foreground/30 hover:bg-muted/40'
			data-transcript-id={entry.tab.id}
			onClick={handleAttach}
			size='xs'
			title={entry.summaryPath}
			type='button'
			variant='outline'
		>
			<SparklesIcon
				aria-hidden='true'
				className='size-3.5 text-muted-foreground'
			/>
			<span className='truncate'>{label}</span>
		</Button>
	);
}

/** Strips the workspace cwd prefix from an absolute path. */
function toWorkspaceRelative(
	workspaceCwd: string,
	absolutePath: string,
): string {
	if (workspaceCwd.length === 0) {
		return absolutePath;
	}
	const cwd = workspaceCwd.endsWith('/') ? workspaceCwd : `${workspaceCwd}/`;
	if (absolutePath.startsWith(cwd)) {
		return absolutePath.slice(cwd.length);
	}
	if (absolutePath === workspaceCwd) {
		return '';
	}
	return absolutePath;
}
