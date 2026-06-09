import { FolderIcon, GitBranchIcon } from 'lucide-react';

import type { WorkspaceLandingSummary } from '@/renderer/types/workbench';

/**
 * Minimal workspace-landing surface shown when a freshly created workspace
 * has no chat history yet. Three lines:
 *  1. Pill — `You're in a new copy of {repo} called {workspace}`.
 *  2. Branch source — `Branched {branch} from {baseBranch}`.
 *  3. File copy result — `Created {workspace} and copied {n} files`.
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
	if (!landingSummary) {
		return null;
	}

	const { branchSource, copiedFiles, repositoryName, workspaceName } =
		landingSummary;

	return (
		<section
			aria-label='Workspace landing summary'
			className='flex flex-col items-start gap-3 text-sm'
			data-landing-card-kind={landingSummary.kind}
		>
			<div className='rounded-md bg-muted/50 px-3 py-2 text-foreground'>
				You’re in a new copy of{' '}
				<span className='font-mono'>{repositoryName}</span> called{' '}
				<span className='font-mono'>{workspaceName}</span>
			</div>

			<p className='flex items-center gap-2 text-muted-foreground text-xs'>
				<GitBranchIcon aria-hidden='true' className='size-3.5 shrink-0' />
				<span>
					Branched{' '}
					<span className='font-mono text-foreground'>
						{branchSource.branchName}
					</span>
					{branchSource.baseBranch ? (
						<>
							{' '}
							from{' '}
							<span className='font-mono text-foreground'>
								{branchSource.baseBranch}
							</span>
						</>
					) : null}
				</span>
			</p>

			<p className='flex items-center gap-2 text-muted-foreground text-xs'>
				<FolderIcon aria-hidden='true' className='size-3.5 shrink-0' />
				<span>
					Created{' '}
					<span className='rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-foreground'>
						{workspaceName}
					</span>{' '}
					and copied{' '}
					<span className='font-mono text-foreground'>
						{copiedFiles.count}
					</span>{' '}
					files
				</span>
			</p>
		</section>
	);
}
