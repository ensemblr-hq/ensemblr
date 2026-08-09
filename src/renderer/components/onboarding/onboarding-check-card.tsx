import {
	CheckIcon,
	ClipboardIcon,
	ExternalLinkIcon,
	FolderIcon,
	LoaderCircleIcon,
	MinusIcon,
	RefreshCwIcon,
	SettingsIcon,
	XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import {
	setupCheckDetail,
	setupRemediationLabel,
} from '@/renderer/lib/setup-check-text';
import { cn } from '@/renderer/lib/utils';
import type {
	OnboardingCheckModel,
	OnboardingRemediation,
} from '@/renderer/types/onboarding';
import type { SetupRemediationActionKind } from '@/shared/ipc/contracts/setup';

import { OnboardingBrandTile } from './onboarding-brand-mark';

/**
 * How a card presents. `subdued` is the resolved-sibling case: on an either-or
 * step, the runtime the user did not install must not shout in red.
 */
type CardPresentation =
	| 'failure'
	| 'pending'
	| 'running'
	| 'subdued'
	| 'success'
	| 'warning';

/**
 * Glyph for the status pip that overlaps the brand tile. Kept to shapes that
 * survive being drawn at twelve pixels — anything with interior detail turns to
 * mush at this size. Pending and subdued carry none: an untouched check has
 * nothing to announce.
 */
const PIP_ICON = {
	failure: XIcon,
	pending: null,
	running: LoaderCircleIcon,
	subdued: null,
	success: CheckIcon,
	warning: MinusIcon,
} satisfies Record<CardPresentation, typeof XIcon | null>;

const PRESENTATION_TONE = {
	failure: 'danger',
	pending: 'muted',
	running: 'info',
	subdued: 'muted',
	success: 'ok',
	warning: 'warning',
} as const satisfies Record<
	CardPresentation,
	'danger' | 'info' | 'muted' | 'ok' | 'warning'
>;

const PRESENTATION_BORDER: Record<CardPresentation, string> = {
	failure: 'border-status-danger/30',
	pending: 'border-border',
	running: 'border-accent-strong/30',
	subdued: 'border-border',
	success: 'border-status-ok/30',
	warning: 'border-status-warning/30',
};

/**
 * Corner wash behind the card. Faint on purpose: it should register as warmth
 * or alarm before the reader consciously finds the badge.
 */
const PRESENTATION_WASH: Record<CardPresentation, string> = {
	failure: 'from-status-danger/6',
	pending: 'from-transparent',
	running: 'from-accent-strong/6',
	subdued: 'from-transparent',
	success: 'from-status-ok/6',
	warning: 'from-status-warning/6',
};

const PIP_TONE: Record<CardPresentation, string> = {
	failure: 'bg-status-danger text-white',
	pending: '',
	running: 'bg-accent-strong text-white',
	subdued: '',
	success: 'bg-status-ok text-white',
	warning: 'bg-status-warning text-white',
};

const REMEDIATION_ICON = {
	'open-external': ExternalLinkIcon,
	'open-settings': SettingsIcon,
	'run-command': ClipboardIcon,
	retry: RefreshCwIcon,
	'select-path': FolderIcon,
} satisfies Record<SetupRemediationActionKind, typeof RefreshCwIcon>;

/**
 * Left inset aligning the remediation row under the card title. Dropped on a
 * narrow card, where the indent alone can push a button past the card edge.
 */
const CONTENT_INDENT = '@xs/card:pl-13';

/**
 * The outcomes that earn a remediation row. A resolved check has nothing left to
 * fix, and its actions — an installer for something already installed, a picker,
 * a per-card retry the footer already offers — read as work the user still owes.
 * A probe still in flight is answering the same question those buttons would.
 */
const ACTIONABLE_PRESENTATIONS: readonly CardPresentation[] = [
	'failure',
	'warning',
];

/** How long the copy confirmation stays on a `run-command` button. */
const COPIED_RESET_MS = 1800;

/**
 * One probe rendered as a card. Roomier than the shipped `SetupCheckRow`, which
 * is tuned for a settings list of fifteen; a wizard step shows one or two.
 */
export function OnboardingCheckCard({
	check,
	isSubdued = false,
	onRemediation,
}: {
	check: OnboardingCheckModel;
	isSubdued?: boolean;
	onRemediation?: (remediation: OnboardingRemediation) => void;
}) {
	const { t } = useTranslation();
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const presentation: CardPresentation =
		isSubdued && check.status === 'failure' ? 'subdued' : check.status;
	const PipIcon = PIP_ICON[presentation];
	const isProbing = presentation === 'running';
	const remediations = ACTIONABLE_PRESENTATIONS.includes(presentation)
		? check.remediations
		: [];
	const presentationLabel: Record<CardPresentation, string> = {
		failure: t('onboarding:card.status.failure', 'Not found'),
		pending: t('onboarding:card.status.pending', 'Waiting'),
		running: t('onboarding:card.status.running', 'Checking'),
		subdued: t('onboarding:card.status.subdued', 'Not installed'),
		success: t('onboarding:card.status.success', 'Ready'),
		warning: t('onboarding:card.status.warning', 'Needs attention'),
	};

	const runRemediation = async (remediation: OnboardingRemediation) => {
		if (remediation.kind !== 'run-command' || !remediation.command) {
			onRemediation?.(remediation);
			return;
		}

		try {
			await navigator.clipboard.writeText(remediation.command);
			setCopiedId(remediation.id);
			window.setTimeout(() => setCopiedId(null), COPIED_RESET_MS);
		} catch (error) {
			console.error('Failed to copy command to clipboard:', error);
		}
	};

	return (
		<div
			className={cn(
				'@container/card relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border bg-card bg-gradient-to-br to-45% to-transparent p-4 transition-colors duration-300',
				PRESENTATION_BORDER[presentation],
				PRESENTATION_WASH[presentation],
				presentation === 'subdued' && 'opacity-65',
			)}
		>
			<div className='flex items-start gap-3'>
				<span className='relative shrink-0'>
					<OnboardingBrandTile
						checkId={check.id}
						isMuted={presentation === 'subdued'}
					/>
					{PipIcon ? (
						<span
							className={cn(
								'absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full ring-2 ring-card transition-colors duration-300',
								PIP_TONE[presentation],
							)}
						>
							<PipIcon
								aria-hidden='true'
								className={cn('size-2.5', isProbing && 'animate-spin')}
								strokeWidth={3.5}
							/>
						</span>
					) : null}
				</span>
				<div className='flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5'>
					<div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
						<p className='min-w-0 font-medium text-foreground text-sm leading-snug tracking-tight'>
							{check.title}
						</p>
						<StatusBadge
							className='shrink-0'
							tone={PRESENTATION_TONE[presentation]}
						>
							{presentationLabel[presentation]}
						</StatusBadge>
					</div>
					{isProbing ? (
						<>
							<span className='sr-only'>{setupCheckDetail(check, t)}</span>
							<span
								aria-hidden='true'
								className='h-3 w-3/5 animate-pulse rounded-full bg-muted'
							/>
						</>
					) : (
						<p className='text-muted-foreground text-xs leading-5'>
							{setupCheckDetail(check, t)}
						</p>
					)}
				</div>
			</div>

			{remediations.length ? (
				<div className={cn('flex flex-wrap gap-1.5', CONTENT_INDENT)}>
					{remediations.map((remediation) => {
						const copied = copiedId === remediation.id;
						const ActionIcon = copied
							? CheckIcon
							: REMEDIATION_ICON[remediation.kind];

						return (
							<Button
								className='max-w-full'
								key={remediation.id}
								onClick={() => {
									void runRemediation(remediation);
								}}
								size='xs'
								type='button'
								variant='outline'
							>
								<ActionIcon aria-hidden='true' data-icon='inline-start' />
								<span className='truncate'>
									{copied
										? t('common:actions.copied', 'Copied')
										: setupRemediationLabel(remediation, t)}
								</span>
							</Button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
