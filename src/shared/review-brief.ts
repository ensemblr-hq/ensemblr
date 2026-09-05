/**
 * Public entrypoint for the review prompt both processes compose. Import from
 * here rather than from the `review-brief/` implementation files.
 *
 * The Review button composes this prompt in the renderer; the `startReview`
 * control op composes the same prompt in main for an agent that asked for a
 * review of its own workspace. Keeping the template, the context formatters, and
 * the size cap behind one entrypoint is what stops the agent-initiated review
 * from becoming a second, subtly different review.
 */

export {
	clampReviewContext,
	REVIEW_CONTEXT_CHAR_LIMIT,
} from './review-brief/review-context.ts';
export {
	composeReviewBrief,
	formatReviewChangedFiles,
	formatReviewPullRequest,
	REVIEW_BASE_PROMPT,
	type ReviewBriefChangedFile,
	type ReviewBriefInput,
	type ReviewBriefPullRequest,
} from './review-brief/review-prompt.ts';
