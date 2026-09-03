import { BotIcon, FileDiffIcon, SparklesIcon } from 'lucide-react';
import { ProviderMark } from '@/renderer/components/workbench-shell/checks-panel/provider-mark';
import {
	GithubLogo,
	LinearLogo,
} from '@/renderer/components/workbench-shell/source-provider-logo';
import type {
	AttachmentMark,
	ProviderMarkKind,
} from '@/renderer/types/components';

/** Shared glyph box, so every mark occupies the same square in a chip's flow. */
const GLYPH_CLASS = 'size-3.5 shrink-0';

/**
 * The provider each review-comment mark draws its brand mark for. Spelled out
 * rather than sliced off the token so a new {@link ProviderMarkKind} is a
 * compile error here instead of an unmarked chip at runtime.
 */
const REVIEW_COMMENT_PROVIDERS: Record<
	`review-comment-${ProviderMarkKind}`,
	ProviderMarkKind
> = {
	'review-comment-github': 'github',
	'review-comment-github-actions': 'github-actions',
	'review-comment-linear': 'linear',
	'review-comment-local': 'local',
	'review-comment-netlify': 'netlify',
	'review-comment-unknown': 'unknown',
	'review-comment-vercel': 'vercel',
};

/**
 * The glyph for one attachment mark.
 *
 * The same chip is drawn from a live `ComposerAttachment` while a message is
 * being typed and from a parsed prompt once it has been sent, by two components
 * that share no props. Both resolve their glyph here, which is what stops a
 * transcript from picking up a sparkle in the composer and a markdown file icon
 * in the bubble — the bug this component exists to close.
 */
export function AttachmentGlyph({ mark }: { mark: AttachmentMark }) {
	if (mark === 'subagent-transcript' || mark === 'subagent-chat') {
		return <BotIcon aria-hidden='true' className={GLYPH_CLASS} />;
	}
	if (mark === 'chat-transcript') {
		return <SparklesIcon aria-hidden='true' className={GLYPH_CLASS} />;
	}
	if (mark === 'file-diff') {
		return (
			<FileDiffIcon
				aria-hidden='true'
				className={`${GLYPH_CLASS} text-muted-foreground`}
			/>
		);
	}
	if (mark === 'issue-linear') {
		return <LinearLogo className={GLYPH_CLASS} />;
	}
	if (mark === 'issue-github') {
		return <GithubLogo className={GLYPH_CLASS} />;
	}
	return <ProviderMark provider={REVIEW_COMMENT_PROVIDERS[mark]} />;
}
