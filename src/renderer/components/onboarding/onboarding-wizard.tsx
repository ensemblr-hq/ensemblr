import { ArrowRightIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { Progress } from '@/renderer/components/ui/progress';
import {
	buildOnboardingSteps,
	ONBOARDING_SCREEN_ORDER,
	summarizeOnboarding,
} from '@/renderer/lib/onboarding';
import { cn } from '@/renderer/lib/utils';
import type {
	OnboardingCheckId,
	OnboardingCheckModel,
	OnboardingRemediation,
	OnboardingScreenId,
	OnboardingStepId,
	OnboardingStepModel,
	OnboardingSummary,
} from '@/renderer/types/onboarding';

import { OnboardingBrandGlyph } from './onboarding-brand-mark';
import { OnboardingCheckCard } from './onboarding-check-card';
import {
	type OnboardingRailNode,
	OnboardingStepRail,
	OnboardingStepStrip,
} from './onboarding-step-rail';
import { OnboardingWelcome } from './onboarding-welcome';

/** The mark that stands for a whole step, for its empty state. */
const STEP_BRAND: Record<OnboardingStepId, OnboardingCheckId> = {
	'agent-cli': 'pi-executable',
	github: 'gh-cli',
	linear: 'linear-oauth',
};

/** How many placeholder cards a step shows before its results arrive. */
const STEP_CHECK_COUNT: Record<OnboardingStepId, number> = {
	'agent-cli': 2,
	github: 2,
	linear: 1,
};

/** Stagger between check cards entering a step. */
const CARD_STAGGER_S = 0.05;

/** Shared easing for every stage and card transition. */
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Per-screen copy: the stage heading, its lead, the button while the gate is unmet, and the compiled-out empty state. */
interface OnboardingScreenCopy {
	blockedCta: string;
	empty: string;
	lead: string;
	title: string;
}

/**
 * Every string keyed by screen, resolved through static `t()` calls so
 * `i18n:extract` can see them. A template-literal key would extract to nothing
 * and type-check against nothing.
 * @returns The short rail labels and the per-screen copy.
 */
function useOnboardingCopy(): {
	railLabels: Record<OnboardingScreenId, string>;
	screens: Record<OnboardingStepId, OnboardingScreenCopy>;
} {
	const { t } = useTranslation();

	return {
		railLabels: {
			'agent-cli': t('onboarding:steps.agent-cli', 'Agent CLI'),
			github: t('onboarding:steps.github', 'GitHub'),
			linear: t('onboarding:steps.linear', 'Linear'),
			ready: t('onboarding:steps.ready', 'Ready'),
			welcome: t('onboarding:steps.welcome', 'Welcome'),
		},
		screens: {
			'agent-cli': {
				blockedCta: t(
					'onboarding:screens.agent-cli.blocked-cta',
					'Install an agent CLI',
				),
				empty: t(
					'onboarding:screens.agent-cli.empty',
					'No agent runtime is compiled into this build, so there is nothing to install.',
				),
				lead: t(
					'onboarding:screens.agent-cli.lead',
					"Ensemblr drives Pi and Claude Code as local processes on this machine. Install either one — you don't need both.",
				),
				title: t('onboarding:screens.agent-cli.title', 'Install an agent CLI'),
			},
			github: {
				blockedCta: t('onboarding:screens.github.blocked-cta', 'Sign in to gh'),
				empty: t(
					'onboarding:screens.github.empty',
					'The GitHub CLI is not wired into this build, so there is nothing to connect.',
				),
				lead: t(
					'onboarding:screens.github.lead',
					'Branch, pull request, review, and merge workflows shell out to gh. It needs to be installed and signed in.',
				),
				title: t('onboarding:screens.github.title', 'Connect the GitHub CLI'),
			},
			linear: {
				blockedCta: t('onboarding:screens.linear.blocked-cta', 'Skip for now'),
				empty: t(
					'onboarding:screens.linear.empty',
					'Linear is not configured for this build, so there is nothing to connect.',
				),
				lead: t(
					'onboarding:screens.linear.lead',
					'Browse issues and open workspaces straight from them. Ensemblr works fine without it.',
				),
				title: t('onboarding:screens.linear.title', 'Connect Linear'),
			},
		},
	};
}

/**
 * First-run setup wizard: a welcome moment, one gate per screen, and a soft
 * gate that always leaves a way forward. Presentational by design — the caller
 * owns the probes, so the playground and the real app drive the same component.
 *
 * Never advances on its own. A satisfied gate unlocks the primary button and
 * waits: a screen that moves while the user is still reading it steals the one
 * moment they had to see what was actually checked.
 */
export function OnboardingWizard({
	checks,
	isRechecking = false,
	onFinish,
	onRecheck,
	onRemediation,
}: {
	checks: OnboardingCheckModel[] | null;
	isRechecking?: boolean;
	onFinish?: () => void;
	onRecheck?: () => void;
	onRemediation?: (remediation: OnboardingRemediation) => void;
}) {
	const copy = useOnboardingCopy();
	const prefersReducedMotion = useReducedMotion();
	const [screenId, setScreenId] = useState<OnboardingScreenId>('welcome');
	const [direction, setDirection] = useState(1);
	const [skipped, setSkipped] = useState<ReadonlySet<OnboardingStepId>>(
		new Set(),
	);

	const steps = buildOnboardingSteps(checks, skipped);
	const summary = summarizeOnboarding(steps);
	const activeStep = steps.find((step) => step.id === screenId) ?? null;

	const goTo = (next: OnboardingScreenId) => {
		setDirection(
			ONBOARDING_SCREEN_ORDER.indexOf(next) >=
				ONBOARDING_SCREEN_ORDER.indexOf(screenId)
				? 1
				: -1,
		);
		setScreenId(next);
	};

	const advance = () => {
		const next =
			ONBOARDING_SCREEN_ORDER[ONBOARDING_SCREEN_ORDER.indexOf(screenId) + 1];

		if (next) {
			goTo(next);
		}
	};

	const deferStep = (id: OnboardingStepId) => {
		setSkipped((current) => new Set(current).add(id));
		advance();
	};

	if (screenId === 'welcome') {
		return <OnboardingWelcome onSkip={onFinish} onStart={advance} />;
	}

	const railNodes = buildRailNodes(steps, summary.isReady, copy.railLabels);

	return (
		<div className='@container/wizard flex size-full flex-col overflow-y-auto bg-canvas'>
			<div className='mx-auto flex w-full max-w-4xl flex-1 flex-col @3xl/wizard:gap-9 gap-7 @3xl/wizard:px-10 px-6 @3xl/wizard:pt-11 pt-9'>
				<WizardHeader
					activeId={screenId}
					nodes={railNodes}
					onSelect={goTo}
					summary={summary}
				/>

				<div className='flex min-h-0 gap-9'>
					<div className='@3xl/wizard:block hidden'>
						<OnboardingStepRail
							activeId={screenId}
							nodes={railNodes}
							onSelect={goTo}
						/>
					</div>

					<div className='@container/stage min-w-0 flex-1'>
						<AnimatePresence custom={direction} initial={false} mode='wait'>
							<motion.div
								animate={{ opacity: 1, y: 0 }}
								custom={direction}
								exit={{
									opacity: 0,
									y: prefersReducedMotion ? 0 : direction * -8,
								}}
								initial={{
									opacity: 0,
									y: prefersReducedMotion ? 0 : direction * 8,
								}}
								key={screenId}
								transition={{ duration: 0.22, ease: EASE_OUT }}
							>
								{activeStep ? (
									<StepScreen
										copy={copy.screens[activeStep.id]}
										isLoading={checks === null}
										onRemediation={onRemediation}
										step={activeStep}
									/>
								) : (
									<ReadyScreen
										outstanding={summary.outstanding}
										railLabels={copy.railLabels}
									/>
								)}
							</motion.div>
						</AnimatePresence>
					</div>
				</div>

				<WizardFooter
					activeStep={activeStep}
					blockedCta={activeStep ? copy.screens[activeStep.id].blockedCta : ''}
					isRechecking={isRechecking}
					onDefer={deferStep}
					onFinish={onFinish}
					onNext={advance}
					onRecheck={onRecheck}
				/>
			</div>
		</div>
	);
}

/**
 * Eyebrow, progress bar, and the required-step count — plus the compact step
 * strip that stands in for the rail once the rail no longer fits.
 */
function WizardHeader({
	activeId,
	nodes,
	onSelect,
	summary,
}: {
	activeId: OnboardingScreenId;
	nodes: readonly OnboardingRailNode[];
	onSelect: (id: OnboardingScreenId) => void;
	summary: OnboardingSummary;
}) {
	const { t } = useTranslation();

	return (
		<header className='flex flex-col gap-3'>
			<div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
				<p className='font-medium text-muted-foreground text-xxs uppercase tracking-widest'>
					{t('onboarding:header.eyebrow', 'Ensemblr Setup')}
				</p>
				<span className='shrink-0 text-muted-foreground text-xxs tabular-nums'>
					{t(
						'onboarding:header.progress',
						'{{satisfied}} of {{total}} required',
						{
							satisfied: summary.satisfiedCount,
							total: summary.totalCount,
						},
					)}
				</span>
			</div>
			<Progress
				className='h-px bg-border'
				value={
					summary.totalCount
						? (summary.satisfiedCount / summary.totalCount) * 100
						: 0
				}
			/>
			<div className='@3xl/wizard:hidden pt-1'>
				<OnboardingStepStrip
					activeId={activeId}
					nodes={nodes}
					onSelect={onSelect}
				/>
			</div>
		</header>
	);
}

/** Title, lead paragraph, and the step's check cards. */
function StepScreen({
	copy,
	isLoading,
	onRemediation,
	step,
}: {
	copy: OnboardingScreenCopy;
	isLoading: boolean;
	onRemediation?: (remediation: OnboardingRemediation) => void;
	step: OnboardingStepModel;
}) {
	const prefersReducedMotion = useReducedMotion();
	const isEitherOr = step.gate === 'any';
	const isResolved = step.status === 'satisfied';

	return (
		<section className='flex flex-col gap-6'>
			<div className='flex flex-col gap-2'>
				<h1 className='text-balance font-semibold text-2xl text-foreground tracking-tight'>
					{copy.title}
				</h1>
				<p className='max-w-prose text-pretty text-muted-foreground text-sm leading-6'>
					{copy.lead}
				</p>
			</div>

			{step.checks.length ? (
				<div className='flex flex-col gap-3'>
					{step.checks.map((check, index) => (
						<motion.div
							animate={{ opacity: 1, y: 0 }}
							className='min-w-0'
							initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 6 }}
							key={check.id}
							transition={{
								delay: index * CARD_STAGGER_S,
								duration: 0.28,
								ease: EASE_OUT,
							}}
						>
							<OnboardingCheckCard
								check={check}
								isSubdued={
									isEitherOr && isResolved && check.status !== 'success'
								}
								onRemediation={onRemediation}
							/>
						</motion.div>
					))}
				</div>
			) : isLoading ? (
				<StepSkeleton stepId={step.id} />
			) : (
				<div className='flex flex-col items-center gap-3 rounded-xl border border-border border-dashed px-4 py-7 text-center'>
					<span className='flex size-10 items-center justify-center rounded-xl bg-pane-strong text-muted-foreground'>
						<OnboardingBrandGlyph
							checkId={STEP_BRAND[step.id]}
							className='size-5'
						/>
					</span>
					<p className='text-pretty text-muted-foreground text-xs'>
						{copy.empty}
					</p>
				</div>
			)}
		</section>
	);
}

/**
 * Placeholder cards for the window before the first probe result lands. Sized
 * to the real card so the stage does not jump when results replace it.
 */
function StepSkeleton({ stepId }: { stepId: OnboardingStepId }) {
	return (
		<div className='flex flex-col gap-3'>
			{Array.from({ length: STEP_CHECK_COUNT[stepId] }, (_, index) => (
				<div
					className='flex animate-pulse items-start gap-3 rounded-xl border border-border bg-card p-4'
					key={`${stepId}-skeleton-${index}`}
				>
					<span className='size-10 shrink-0 rounded-xl bg-pane-strong' />
					<div className='flex min-w-0 flex-1 flex-col gap-2.5 pt-1'>
						<span className='block h-3 w-2/5 rounded-full bg-pane-strong' />
						<span className='block h-3 w-4/5 rounded-full bg-muted' />
					</div>
				</div>
			))}
		</div>
	);
}

/** Terminal screen. Reports outstanding work rather than claiming success. */
function ReadyScreen({
	outstanding,
	railLabels,
}: {
	outstanding: readonly OnboardingStepModel[];
	railLabels: Record<OnboardingScreenId, string>;
}) {
	const { t } = useTranslation();
	const isReady = outstanding.length === 0;

	return (
		<section className='flex flex-col gap-6'>
			<span
				className={cn(
					'flex size-11 items-center justify-center rounded-xl ring-1',
					isReady
						? 'bg-status-ok/10 text-status-ok ring-status-ok/20'
						: 'bg-status-warning/10 text-status-warning ring-status-warning/20',
				)}
			>
				<SparklesIcon aria-hidden='true' className='size-5' />
			</span>
			<div className='flex flex-col gap-2'>
				<h1 className='text-balance font-semibold text-2xl text-foreground tracking-tight'>
					{isReady
						? t('onboarding:ready.title', "You're all set")
						: t('onboarding:ready.partial-title', 'Almost there')}
				</h1>
				<p className='max-w-prose text-pretty text-muted-foreground text-sm leading-6'>
					{isReady
						? t(
								'onboarding:ready.lead',
								'Ensemblr is ready to open its first workspace.',
							)
						: t(
								'onboarding:ready.partial-lead',
								'You can start now, but some things will not work until these are done. Settings → Diagnostics has them whenever you are ready.',
							)}
				</p>
			</div>

			{isReady ? null : (
				<ul className='flex flex-col gap-2'>
					{outstanding.map((step) => (
						<li
							className='flex items-center gap-2.5 rounded-lg border border-status-warning/25 bg-status-warning/5 px-3 py-2.5 text-status-warning text-xs'
							key={step.id}
						>
							<span className='size-1.5 shrink-0 rounded-full bg-status-warning' />
							{t(
								'onboarding:ready.outstanding',
								'{{step}} is still unresolved',
								{
									step: railLabels[step.id],
								},
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** Re-check on the left, the soft gate and the primary action on the right. */
function WizardFooter({
	activeStep,
	blockedCta,
	isRechecking,
	onDefer,
	onFinish,
	onNext,
	onRecheck,
}: {
	activeStep: OnboardingStepModel | null;
	blockedCta: string;
	isRechecking: boolean;
	onDefer: (id: OnboardingStepId) => void;
	onFinish?: () => void;
	onNext: () => void;
	onRecheck?: () => void;
}) {
	const { t } = useTranslation();
	const isSatisfied = activeStep?.status === 'satisfied';
	const isDeferred = activeStep?.status === 'skipped';
	const canDefer = Boolean(activeStep?.required) && !isSatisfied && !isDeferred;

	return (
		<footer className='sticky bottom-0 mt-auto flex @xl/wizard:flex-row flex-col-reverse @xl/wizard:items-center @xl/wizard:justify-between gap-3 border-border border-t bg-canvas pt-6 @3xl/wizard:pb-12 pb-10'>
			<span
				aria-hidden='true'
				className='pointer-events-none absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-canvas to-transparent'
			/>
			<Button
				className='self-start'
				disabled={isRechecking}
				onClick={onRecheck}
				size='sm'
				type='button'
				variant='subtle'
			>
				<RefreshCwIcon
					aria-hidden='true'
					className={cn(isRechecking && 'animate-spin')}
					data-icon='inline-start'
				/>
				{isRechecking
					? t('onboarding:footer.rechecking', 'Checking…')
					: t('onboarding:footer.recheck', 'Check again')}
			</Button>

			<div className='flex flex-wrap items-center justify-end gap-1'>
				{canDefer && activeStep ? (
					<Button
						onClick={() => onDefer(activeStep.id)}
						size='sm'
						type='button'
						variant='subtle'
					>
						{t('onboarding:footer.defer', "I'll do this later")}
					</Button>
				) : null}

				{activeStep ? (
					<Button
						disabled={activeStep.required && !isSatisfied && !isDeferred}
						onClick={onNext}
						size='sm'
						type='button'
					>
						{isSatisfied
							? t('onboarding:footer.continue', 'Continue')
							: blockedCta}
						<ArrowRightIcon aria-hidden='true' data-icon='inline-end' />
					</Button>
				) : (
					<Button onClick={onFinish} size='sm' type='button'>
						{t('onboarding:footer.finish', 'Open Ensemblr')}
						<ArrowRightIcon aria-hidden='true' data-icon='inline-end' />
					</Button>
				)}
			</div>
		</footer>
	);
}

/**
 * Builds the rail from the gated steps plus the terminal stop.
 * @param steps - The three gated step models.
 * @param isReady - Whether every required step is satisfied.
 * @param railLabels - Translated short label per rail stop.
 * @returns Rail nodes in screen order.
 */
function buildRailNodes(
	steps: readonly OnboardingStepModel[],
	isReady: boolean,
	railLabels: Record<OnboardingScreenId, string>,
): OnboardingRailNode[] {
	return [
		...steps.map((step) => ({
			id: step.id,
			label: railLabels[step.id],
			required: step.required,
			status: step.status,
		})),
		{
			id: 'ready' as const,
			label: railLabels.ready,
			required: true,
			status: isReady ? ('satisfied' as const) : ('unmet' as const),
		},
	];
}
