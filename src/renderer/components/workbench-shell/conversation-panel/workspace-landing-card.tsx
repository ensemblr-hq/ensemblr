import { FolderIcon, GitBranchIcon } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { LinkedIssueStatus } from '@/renderer/components/linear/linked-issue-status';
import type { WorkspaceLandingSummary } from '@/renderer/types/workbench';
import { bareBranchName } from '@/shared/branch-ref';

/**
 * Minimal workspace-landing surface shown when a freshly created workspace
 * has no chat history yet. Three lines:
 *  1. Pill — `You're in a new copy of {repo} called {workspace}`.
 *  2. Branch source — `On {branch}, compared against {baseBranch}`.
 *  3. File copy result — `Created {workspace}` plus workspace file count.
 *
 * Diagnostic state (setup readiness, composer not-ready reasons, setup-script
 * status) lives in the sidebar footer and the settings → diagnostics screen.
 * Keep this card free of any "Pi is not ready" UI; the chat tab is for chat.
 */
export function WorkspaceLandingCard({
	landingSummary,
}: {
	landingSummary: WorkspaceLandingSummary | null | undefined;
}) {
	const { t } = useTranslation();

	if (!landingSummary) {
		return null;
	}

	const { branchSource, copiedFiles, repositoryName, workspaceName } =
		landingSummary;
	const baseBranch = bareBranchName(branchSource.baseBranch);

	return (
		<section
			aria-label={t(
				'workbench:landing-card.aria-label',
				'Workspace landing summary',
			)}
			className='flex flex-col items-start gap-3 text-sm'
			data-landing-card-kind={landingSummary.kind}
		>
			<div className='rounded-md bg-muted/50 px-3 py-2 text-foreground'>
				<Trans
					components={{
						repo: <span className='font-mono' />,
						workspace: <span className='font-mono' />,
					}}
					defaults='You’re in a new copy of <repo>{{repositoryName}}</repo> called <workspace>{{workspaceName}}</workspace>'
					i18nKey='workbench:landing-card.headline'
					values={{ repositoryName, workspaceName }}
				/>
			</div>

			{landingSummary.linkedIssue ? (
				<LinkedIssueStatus linkedIssue={landingSummary.linkedIssue} />
			) : null}

			<p className='flex items-center gap-2 text-muted-foreground text-xs'>
				<GitBranchIcon aria-hidden='true' className='size-3.5 shrink-0' />
				<span>
					{baseBranch ? (
						<Trans
							components={{
								ref: <span className='font-mono text-foreground' />,
							}}
							defaults='On <ref>{{branchName}}</ref>, compared against <ref>{{baseBranch}}</ref>'
							i18nKey='workbench:landing-card.branch.with-base'
							values={{ baseBranch, branchName: branchSource.branchName }}
						/>
					) : (
						<Trans
							components={{
								ref: <span className='font-mono text-foreground' />,
							}}
							defaults='On <ref>{{branchName}}</ref>'
							i18nKey='workbench:landing-card.branch.plain'
							values={{ branchName: branchSource.branchName }}
						/>
					)}
				</span>
			</p>

			<p className='flex items-center gap-2 text-muted-foreground text-xs'>
				<FolderIcon aria-hidden='true' className='size-3.5 shrink-0' />
				<span>
					{copiedFiles.state === 'copied'
						? t('workbench:landing-card.created.copied', {
								count: copiedFiles.count,
								defaultValue_one:
									'Created {{workspaceName}} and copied {{count}} file',
								defaultValue_other:
									'Created {{workspaceName}} and copied {{count}} files',
								workspaceName,
							})
						: t(
								'workbench:landing-card.created.detail',
								'Created {{workspaceName}}. {{detail}}',
								{ detail: copiedFiles.detail, workspaceName },
							)}
				</span>
			</p>
		</section>
	);
}
