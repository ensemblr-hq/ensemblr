import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { AttachmentGlyph } from '@/renderer/components/attachment-glyph';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import { isSubAgentTab } from '@/renderer/lib/workbench/sub-agent-tab';
import { useComposerAttachmentDispatcher } from '@/renderer/state/composer';
import type { ChatTabSummaryEntryWire } from '@/shared/ipc/contracts/chat-tab';

/**
 * Empty-state shown above the composer when a workspace has prior chats /
 * transcripts in `.context/` but no active agent session in the current tab.
 * Lists each transcript as a chip the user can attach to the new chat — a
 * sibling chat still open counts, since its summary is rewritten at every turn
 * boundary.
 */
export function NewChatEmptyState({
	activeChatTabId,
	transcripts,
	workspaceCwd,
	workspaceName,
}: {
	activeChatTabId: string;
	transcripts: readonly ChatTabSummaryEntryWire[];
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

/** Renders a chat's transcript as a chip that can be attached to the composer. */
function TranscriptChip({
	activeChatTabId,
	entry,
	workspaceCwd,
}: {
	activeChatTabId: string;
	entry: ChatTabSummaryEntryWire;
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
	const isSubAgent = isSubAgentTab(entry.tab);
	// A chat closed before its summary reached disk, or whose file has since
	// gone, is listed but cannot be attached. Dropping it instead would read as
	// a workspace that never had the chat. An open tab in that state is not
	// listed at all — it is already in the tab strip, so there is no gap to explain.
	const isAttachable = entry.summaryPath.length > 0;

	const handleAttach = () => {
		if (!isAttachable) {
			return;
		}
		// The composer's mention payload reader rejects absolute paths, so
		// strip the workspaceCwd prefix before dispatching. Falls back to the
		// raw path when the prefix does not match — the read will then error
		// visibly instead of silently attaching the wrong file.
		const relativePath = toWorkspaceRelative(workspaceCwd, entry.summaryPath);
		dispatch(
			{ chatTabId: activeChatTabId },
			{
				id: `transcript:${entry.tab.id}`,
				isSubAgent,
				kind: 'chat-transcript',
				label,
				path: relativePath,
			},
		);
	};

	return (
		// `aria-disabled` rather than `disabled`: the button base class carries
		// `disabled:pointer-events-none`, which stops the hover that would raise
		// the title tooltip and drops the chip out of the tab order — so the one
		// surface explaining why it cannot be attached would reach nobody.
		<Button
			aria-disabled={isAttachable ? undefined : true}
			aria-label={transcriptChipLabel({ isAttachable, isSubAgent, label, t })}
			className={cn(
				'h-auto gap-1.5 rounded-md bg-pane px-2.5 py-1 text-xs',
				isAttachable
					? 'hover:border-foreground/30 hover:bg-muted/40'
					: 'cursor-not-allowed opacity-50',
			)}
			data-transcript-id={entry.tab.id}
			onClick={handleAttach}
			size='xs'
			title={
				isAttachable
					? entry.summaryPath
					: t(
							'workbench:new-chat.transcript-unavailable',
							'No transcript was saved for this chat, so it cannot be attached.',
						)
			}
			type='button'
			variant='outline'
		>
			<span className='text-muted-foreground'>
				<AttachmentGlyph
					mark={isSubAgent ? 'subagent-transcript' : 'chat-transcript'}
				/>
			</span>
			<span className='truncate'>{label}</span>
		</Button>
	);
}

/**
 * The accessible name for one transcript chip, which the visible label alone
 * cannot carry: both the robot glyph and the disabled state are silent to a
 * screen reader, so each earns a sentence here or reaches nobody.
 * @param input - The chip's state, its visible label, and the translator.
 * @returns The `aria-label`, or undefined when the label already says it all.
 */
function transcriptChipLabel({
	isAttachable,
	isSubAgent,
	label,
	t,
}: {
	isAttachable: boolean;
	isSubAgent: boolean;
	label: string;
	t: TFunction;
}): string | undefined {
	if (!isAttachable) {
		return t(
			'workbench:new-chat.transcript-unavailable-aria',
			'{{title}} — no transcript was saved for this chat, so it cannot be attached.',
			{ title: label },
		);
	}
	return isSubAgent
		? t(
				'workbench:new-chat.subagent-transcript-aria',
				'{{title}} — transcript of a sub-agent chat',
				{ title: label },
			)
		: undefined;
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
