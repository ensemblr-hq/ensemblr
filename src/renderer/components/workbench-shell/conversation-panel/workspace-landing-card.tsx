import {
	CircleAlertIcon,
	CircleDashedIcon,
	FilesIcon,
	GitBranchIcon,
	type LucideIcon,
	SettingsIcon,
	SparklesIcon,
	TagIcon,
} from 'lucide-react';

import { StatusBadge } from '@/renderer/components/status-badge';
import { cn } from '@/renderer/lib/utils';
import type {
	ComposerShellState,
	WorkspaceLandingKind,
	WorkspaceLandingSetupState,
	WorkspaceLandingSummary,
} from '@/renderer/types/workbench';

/**
 * Workspace-landing summary card shown above the chat thread for new
 * workspaces. Surfaces branch source, copied-file count, setup-script
 * guidance, and any linked Linear/GitHub issue metadata. When the composer is
 * disabled, a separate notice explains why so the empty chat surface is never
 * silent.
 *
 * Dismissal contract: render-time visibility is driven purely by
 * `landingSummary`. The card hides itself when the prop is `null`/`undefined`,
 * so the upstream store/mapper is responsible for clearing the summary once
 * the workspace transitions out of its new state (e.g. first agent turn).
 */
export function WorkspaceLandingCard({
	composer,
	landingSummary,
	name,
	pathLabel,
}: {
	composer: ComposerShellState;
	landingSummary: WorkspaceLandingSummary | null | undefined;
	name: string;
	pathLabel: string;
}) {
	if (!landingSummary) {
		return null;
	}

	return (
		<section
			aria-label='Workspace landing summary'
			className='flex flex-col gap-4 rounded-md border border-border bg-pane p-4'
			data-landing-card-kind={landingSummary.kind}
		>
			<header className='flex items-start gap-3'>
				<div className='mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/15 text-primary'>
					<SparklesIcon aria-hidden='true' className='size-4' />
				</div>
				<div className='min-w-0 flex-1'>
					<h2 className='font-semibold text-foreground text-sm'>
						{landingSummary.headline}
					</h2>
					<p className='mt-1 text-muted-foreground text-xs leading-5'>
						{name}
						<span aria-hidden='true' className='px-1.5'>
							·
						</span>
						<span className='font-mono text-[0.6875rem]'>{pathLabel}</span>
					</p>
				</div>
				<StatusBadge tone='muted'>
					{LANDING_KIND_LABEL[landingSummary.kind]}
				</StatusBadge>
			</header>

			<dl className='grid gap-3 sm:grid-cols-2'>
				<LandingRow
					detail={landingSummary.branchSource.detail}
					icon={GitBranchIcon}
					title='Branch'
				>
					<code className='rounded-sm bg-muted/45 px-1.5 py-0.5 font-mono text-[0.6875rem]'>
						{landingSummary.branchSource.branchName}
					</code>
					{landingSummary.branchSource.baseBranch ? (
						<span className='text-muted-foreground text-xs'>
							{' '}
							from{' '}
							<code className='rounded-sm bg-muted/45 px-1.5 py-0.5 font-mono text-[0.6875rem]'>
								{landingSummary.branchSource.baseBranch}
							</code>
						</span>
					) : null}
				</LandingRow>

				<LandingRow
					detail={landingSummary.copiedFiles.detail}
					icon={FilesIcon}
					title='Copied files'
				>
					<span
						className={cn(
							'font-semibold text-foreground text-sm',
							landingSummary.copiedFiles.state === 'unavailable' &&
								'text-muted-foreground',
						)}
					>
						{landingSummary.copiedFiles.count}
					</span>
					<span className='ml-1 text-muted-foreground text-xs'>
						{COPY_STATE_LABEL[landingSummary.copiedFiles.state]}
					</span>
				</LandingRow>

				<LandingRow
					detail={landingSummary.setupGuidance.detail}
					icon={SettingsIcon}
					title='Setup script'
				>
					<SetupStateBadge state={landingSummary.setupGuidance.state} />
					{landingSummary.setupGuidance.command ? (
						<code className='ml-2 rounded-sm bg-muted/45 px-1.5 py-0.5 font-mono text-[0.6875rem]'>
							{landingSummary.setupGuidance.command}
						</code>
					) : null}
				</LandingRow>

				{landingSummary.linkedIssue ? (
					<LandingRow
						detail={landingSummary.linkedIssue.subtitle ?? ''}
						icon={TagIcon}
						title='Linked issue'
					>
						<span className='font-medium text-foreground text-xs'>
							{landingSummary.linkedIssue.reference}
						</span>
						<span className='text-muted-foreground text-xs'>
							{' '}
							· {landingSummary.linkedIssue.provider}
						</span>
						<p className='mt-1 truncate text-foreground text-xs'>
							{landingSummary.linkedIssue.title}
						</p>
					</LandingRow>
				) : null}
			</dl>

			{composer.disabled ? (
				<div
					className='flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3'
					data-landing-composer-state='disabled'
				>
					<CircleAlertIcon
						aria-hidden='true'
						className='mt-0.5 size-4 shrink-0 text-status-warning'
					/>
					<div className='min-w-0'>
						<p className='font-medium text-foreground text-xs'>
							Pi composer not ready
						</p>
						<p className='mt-0.5 text-muted-foreground text-xs leading-5'>
							{composer.disabledReason ??
								'The composer becomes available once Pi runtime is ready.'}
						</p>
					</div>
				</div>
			) : (
				<div
					className='flex items-start gap-2 rounded-md border border-border bg-background p-3'
					data-landing-composer-state='ready'
				>
					<CircleDashedIcon
						aria-hidden='true'
						className='mt-0.5 size-4 shrink-0 text-muted-foreground'
					/>
					<p className='text-muted-foreground text-xs leading-5'>
						Send the first prompt below to start a Pi session in this workspace.
					</p>
				</div>
			)}
		</section>
	);
}

const LANDING_KIND_LABEL: Record<WorkspaceLandingKind, string> = {
	'cloned-repo': 'Just cloned',
	'linked-issue': 'From issue',
	'local-branch': 'New workspace',
};

const COPY_STATE_LABEL: Record<
	WorkspaceLandingSummary['copiedFiles']['state'],
	string
> = {
	copied: 'files copied',
	skipped: 'files skipped',
	unavailable: 'files unavailable',
};

const SETUP_STATE_CONFIG: Record<
	WorkspaceLandingSetupState,
	{ label: string; tone: 'muted' | 'ok' | 'warning' }
> = {
	configured: { label: 'Configured', tone: 'muted' },
	missing: { label: 'Add a setup script', tone: 'warning' },
	pending: { label: 'Not run yet', tone: 'muted' },
	succeeded: { label: 'Ready', tone: 'ok' },
};

function LandingRow({
	children,
	detail,
	icon: Icon,
	title,
}: {
	children: React.ReactNode;
	detail: string;
	icon: LucideIcon;
	title: string;
}) {
	return (
		<div className='flex min-w-0 gap-2 rounded-sm border border-border/60 bg-background p-2.5'>
			<Icon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 text-muted-foreground'
			/>
			<div className='min-w-0 flex-1'>
				<dt className='font-medium text-foreground text-xs uppercase tracking-wide'>
					{title}
				</dt>
				<dd className='mt-1 min-w-0 text-foreground text-xs'>{children}</dd>
				{detail ? (
					<p className='mt-1 text-muted-foreground text-xs leading-5'>
						{detail}
					</p>
				) : null}
			</div>
		</div>
	);
}

function SetupStateBadge({ state }: { state: WorkspaceLandingSetupState }) {
	const { label, tone } = SETUP_STATE_CONFIG[state];

	return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
