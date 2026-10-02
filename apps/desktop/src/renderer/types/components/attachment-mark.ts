import type { ProviderMarkKind } from './checks-panel';

/**
 * What an attachment chip stands for, when its path does not say it.
 *
 * A chip is drawn three times over one message's life — in the composer, in a
 * queued follow-up row, and in the sent bubble — and the last of those has only
 * the persisted prompt to read. The mark is what crosses that gap: the composer
 * writes it into the `<attached_file>` block and the timeline reads it back, so
 * the three chips cannot disagree about which glyph a thing wears.
 *
 * A plain workspace file and a directory carry no mark. Their own basename picks
 * a VSCode file glyph, which is both correct and free.
 */
export type AttachmentMark =
	| 'chat-transcript'
	| 'file-diff'
	| 'subagent-chat'
	| 'subagent-transcript'
	| `issue-${'github' | 'linear'}`
	| `review-comment-${ProviderMarkKind}`;
