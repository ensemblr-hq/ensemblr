/**
 * The review prompt itself, and the one function that composes it.
 *
 * Two processes now produce this string. The Review button composes it in the
 * renderer through `composeActionPrompt`, which is generic over every agent
 * action; `startReview` composes it in main for an agent that asked for the same
 * review of its own workspace. The wording, the interpolations, the context
 * sections, and the order they appear in are therefore a cross-process contract
 * rather than renderer detail, and both callers read them from here.
 *
 * The renderer's `action-prompts.ts` keeps the generic composition — it still
 * owns the pull-request prompts, the branch-naming prompt, and their fields —
 * and takes only the review template and formatters from this module. A parity
 * test asserts the two paths render byte-identical output for the same inputs.
 */

import {
	interpolatePromptFields,
	USER_PREF_ADDON,
} from '../prompt-scaffolding.ts';
import { clampReviewContext } from './review-context.ts';

/**
 * One changed file as a review brief lists it. Deliberately narrower than either
 * process's own file model: the renderer holds a `ReviewFile` with selection and
 * conflict state, main holds a git porcelain row, and the brief needs neither.
 */
export interface ReviewBriefChangedFile {
	path: string;
	status: string;
	additions: number;
	deletions: number;
}

/** The open pull request a review brief names, when the branch has one. */
export interface ReviewBriefPullRequest {
	number: number;
	url?: string | null;
}

/** Everything the review prompt interpolates or lists. */
export interface ReviewBriefInput {
	/** Bare name of the branch under review. */
	branchName: string;
	/** Bare name of the branch it forks from, or null when the workspace has none. */
	baseBranch: string | null;
	/** The workspace's changed files, in the order the brief should list them. */
	changedFiles: readonly ReviewBriefChangedFile[];
	/** The open pull request, when one exists. */
	pullRequest: ReviewBriefPullRequest | null;
	/** The user's resolved per-action review preferences; empty when none. */
	preferences: string;
}

/** Stands in for the base branch when the workspace records none. */
const UNNAMED_BASE_BRANCH = 'the base branch';

/**
 * The built-in review base prompt, adapted from the `base-prompt-examples/`
 * reference prompts to Ensemblr's runtime: the MCP diff tools those examples
 * assume are replaced by the git-diff workflow they already document as a
 * fallback.
 *
 * It opens by deferring to the repository's or the user's own review skill,
 * which wins outright rather than merely taking precedence — a repository that
 * ships a review procedure gets that procedure, not Ensemblr's default worded
 * differently on top of it.
 */
export const REVIEW_BASE_PROMPT = `# Review guidelines

You are acting as a reviewer for a proposed code change made by another engineer.

## Check for the user's own review skill first

Before reviewing anything yourself, check whether a bespoke code-review skill, command, or documented review procedure is available here — one shipped by this repository or by the user's own agent configuration (a \`code-review\`-style skill, a review slash command, or a review workflow this repository's docs point at).

If one exists, invoke it and follow it alone. It replaces every guideline below, including how findings are worded and reported, and you run no second review on top of it. Tell it the branch under review is \${YOUR_BRANCH} and its base is origin/\${TARGET_BRANCH}, and report back whatever it produces.

Only when there is no such skill, review the change yourself using the default guidelines below.

## Default guidelines

Below are the default guidelines for deciding whether the original author would appreciate an issue being flagged. More specific guidelines you encounter elsewhere (in this repository's docs, a developer message, or a file) override these.

An issue should be flagged when:
- It meaningfully impacts the accuracy, performance, security, or maintainability of the code.
- The bug is discrete and actionable (not a general complaint about the codebase).
- Fixing it does not demand a level of rigor absent from the rest of the codebase.
- The bug was introduced in this change (pre-existing bugs should not be flagged).
- The author would likely fix it if they were made aware of it.
- It does not rely on unstated assumptions about the codebase or the author's intent — identify the parts of the code that are provably affected.
- It is clearly not an intentional change by the author.

When flagging a bug, provide an accompanying comment:
- Be clear about why the issue is a bug and communicate its severity accurately, without overstating it.
- Keep it brief (at most one paragraph) and avoid code chunks longer than three lines; wrap any code in inline code or a code block.
- State the scenarios, environments, or inputs necessary for the bug to arise.
- Keep the tone matter-of-fact — a helpful assistant suggestion, not an accusatory or flattering human reviewer. Avoid phrasing like "Great job…" or "Thanks for…".

How many findings to return: output every finding the author would want to fix. If there is no finding a person would clearly want to see and fix, prefer no findings. Do not stop at the first qualifying finding.

Getting the diff:
\`\`\`
MERGE_BASE=$(git merge-base origin/\${TARGET_BRANCH} HEAD)
git diff $MERGE_BASE HEAD   # committed changes on this branch
git diff HEAD               # uncommitted work in progress
\`\`\`
Review the combination of both outputs.

Ignore trivial style unless it obscures meaning or violates a documented standard. Use one finding per distinct issue, and keep each finding's location as short as possible. Write out a numbered list of findings, each with a short title, an explanation, and the file (and line range) it applies to.`;

/**
 * Lists the workspace's changed files for a review prompt, or the line that
 * tells the reviewer to work from the branch diff when nothing is uncommitted.
 * @param files - The workspace's changed files.
 * @returns The changed-files context section.
 */
export function formatReviewChangedFiles(
	files: readonly ReviewBriefChangedFile[],
): string {
	const listed = files
		.map(
			(file) =>
				`- ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`,
		)
		.join('\n');
	return listed
		? `Changed files:\n${listed}`
		: 'There are currently no uncommitted changes; work against the branch diff.';
}

/**
 * Names the open pull request for a review prompt.
 * @param pullRequest - The open pull request, or null when the branch has none.
 * @returns The pull-request context line, or null when there is nothing to name.
 */
export function formatReviewPullRequest(
	pullRequest: ReviewBriefPullRequest | null,
): string | null {
	if (!pullRequest) {
		return null;
	}
	return `Pull request: #${pullRequest.number}${
		pullRequest.url ? ` (${pullRequest.url})` : ''
	}`;
}

/**
 * Substitutes the branch fields the review base prompt references.
 * @param branchName - Bare name of the branch under review.
 * @param baseBranch - Bare name of its base branch, or null.
 * @returns The interpolated base prompt.
 */
function interpolateReviewBase(
	branchName: string,
	baseBranch: string | null,
): string {
	return interpolatePromptFields(REVIEW_BASE_PROMPT, {
		TARGET_BRANCH: baseBranch ?? UNNAMED_BASE_BRANCH,
		YOUR_BRANCH: branchName,
	});
}

/**
 * Composes the full review prompt: the interpolated base prompt, the workspace's
 * changed files and open pull request, and — only when the user configured them
 * — the addon header plus their per-action review preferences.
 *
 * Only the base prompt and the unbounded context are clamped. The preferences
 * are appended afterwards so a wide changed-files list can never truncate the
 * user's own instructions (or the header that gives them precedence) away.
 * @param input - Branch, base branch, changed files, pull request, preferences.
 * @returns The composed review prompt.
 */
export function composeReviewBrief(input: ReviewBriefInput): string {
	const sections = [
		interpolateReviewBase(input.branchName, input.baseBranch),
		formatReviewChangedFiles(input.changedFiles),
		formatReviewPullRequest(input.pullRequest),
	].filter((section): section is string => Boolean(section));
	const bounded = clampReviewContext(sections.join('\n\n'));
	const preferences = input.preferences.trim();
	return preferences
		? `${bounded}\n\n${USER_PREF_ADDON}\n\n${preferences}`
		: bounded;
}
