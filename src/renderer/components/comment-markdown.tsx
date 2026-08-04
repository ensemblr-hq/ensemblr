import { NO_DESCRIPTION_LABEL } from '@/renderer/lib/workbench/comment-body';
import { ChatMessageText } from './chat-message-text';

/**
 * Renders a review comment's body as markdown, standing in for it when there is
 * nothing to render. Bot comments are often all metadata and markup, which strips
 * down to nothing at all; the markdown renderer draws nothing for an empty string,
 * so without the stand-in such a comment reads as a rendering failure rather than
 * as a comment that says nothing.
 */
export function CommentMarkdown({
	body,
	className,
}: {
	body: string;
	className?: string;
}) {
	if (body.trim().length === 0) {
		return (
			<p className='text-muted-foreground text-xs italic'>
				{NO_DESCRIPTION_LABEL}
			</p>
		);
	}
	return <ChatMessageText className={className} text={body} />;
}
