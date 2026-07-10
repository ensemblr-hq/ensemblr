import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { clampReviewContext } from './review-context';

/** Agent-assisted review actions resolved from settings templates (ENS-059). */
export type AgentActionKind =
	| 'branch-naming'
	| 'create-pr'
	| 'fix-check-errors'
	| 'general'
	| 'resolve-conflicts'
	| 'review';

/** Settings key for each action template (personal SQLite or .ensemblr/settings.toml). */
export const AGENT_ACTION_SETTING_KEYS: Record<AgentActionKind, string> = {
	'branch-naming': 'piActions.branchNaming',
	'create-pr': 'piActions.createPr',
	'fix-check-errors': 'piActions.fixCheckErrors',
	general: 'piActions.general',
	'resolve-conflicts': 'piActions.resolveConflicts',
	review: 'piActions.review',
};

const DEFAULT_TEMPLATES: Record<AgentActionKind, string> = {
	'branch-naming':
		'Suggest a short kebab-case git branch name for the work in this workspace. Reply with the name only.',
	'create-pr':
		'Draft a pull request title and description for the current workspace changes. Summarize what changed and why, and include a short test plan.',
	'fix-check-errors':
		'The following PR checks are failing. Investigate the failures in this workspace and fix them.',
	general: '',
	'resolve-conflicts':
		'This branch has merge conflicts with its base branch. Resolve the conflicts, keeping the intent of both sides, and explain each resolution.',
	review:
		'Review the current workspace changes like a thorough code reviewer. Flag bugs, risky patterns, and missing tests. Be specific with file and line references.',
};

/** An agent-action prompt template together with where it was resolved from. */
export interface ResolvedAgentTemplate {
	/** Where the template came from, for source diagnostics in the UI. */
	source: string;
	template: string;
}

/**
 * Resolves the effective template for an action: explicit setting value when
 * configured, built-in default otherwise.
 */
export function resolveAgentActionTemplate({
	action,
	settingSource,
	settingValue,
}: {
	action: AgentActionKind;
	settingSource?: string;
	settingValue?: unknown;
}): ResolvedAgentTemplate {
	if (typeof settingValue === 'string' && settingValue.trim()) {
		return {
			source: settingSource ?? 'settings',
			template: settingValue.trim(),
		};
	}
	return { source: 'built-in default', template: DEFAULT_TEMPLATES[action] };
}

/**
 * Builds the composer prompt for an agent-assisted action: resolved template
 * followed by workspace/PR/check context. The prompt is inserted into the
 * composer (never auto-submitted) so the user can inspect or edit it first.
 */
export function buildAgentActionPrompt({
	action,
	template,
	workspace,
}: {
	action: AgentActionKind;
	template: string;
	workspace: WorkspaceShellModel;
}): string {
	const sections = [template];
	const { pullRequest } = workspace;

	if (action === 'review' || action === 'create-pr') {
		const files = workspace.reviewFiles
			.map(
				(file) =>
					`- ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`,
			)
			.join('\n');
		sections.push(
			files
				? `Changed files:\n${files}`
				: 'There are currently no uncommitted changes; review the branch diff against its base.',
		);
	}

	if (action === 'fix-check-errors') {
		const failing = pullRequest.checks.filter(
			(check) => check.status === 'blocked',
		);
		sections.push(
			failing.length
				? `Failing checks:\n${failing
						.map(
							(check) =>
								`- ${check.label}${check.url ? ` (${check.url})` : ''}`,
						)
						.join('\n')}`
				: 'No failing checks are currently reported; re-check the PR status first.',
		);
	}

	if (action === 'resolve-conflicts') {
		sections.push(
			`Branch: ${workspace.branchName}${
				workspace.landingSummary?.branchSource.baseBranch
					? ` (base: ${workspace.landingSummary.branchSource.baseBranch})`
					: ''
			}`,
		);
	}

	if (pullRequest.number) {
		sections.push(
			`Pull request: #${pullRequest.number}${
				pullRequest.url ? ` (${pullRequest.url})` : ''
			}`,
		);
	}

	return clampReviewContext(sections.filter(Boolean).join('\n\n'));
}
