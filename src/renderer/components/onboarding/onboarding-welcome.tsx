import { ArrowRightIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { WelcomeWordmark } from '@/renderer/components/welcome/welcome-wordmark';
import type { OnboardingCheckId } from '@/renderer/types/onboarding';

import { OnboardingBrandSwatch } from './onboarding-brand-mark';
import { OnboardingLanguagePicker } from './onboarding-language-picker';

/**
 * The three things setup covers, previewed before the wizard starts. Each row
 * wears the marks of the tools it actually checks, so the agent-CLI row shows
 * both runtimes and reads as the either-or it is.
 */
const REQUIREMENTS = [
	{
		brands: ['pi-executable', 'claude-executable'],
		id: 'agent-cli',
	},
	{
		brands: ['gh-cli'],
		id: 'github',
	},
	{
		brands: ['linear-oauth'],
		id: 'linear',
	},
] as const satisfies readonly {
	brands: readonly OnboardingCheckId[];
	id: string;
}[];

/**
 * Opening moment: the wordmark, what setup will cover, and one way forward.
 * Deliberately carries no rail, progress bar, or footer — the wizard chrome
 * appears only once the user has opted into it.
 */
export function OnboardingWelcome({
	onSkip,
	onStart,
}: {
	onSkip?: () => void;
	onStart: () => void;
}) {
	const { t } = useTranslation();
	const prefersReducedMotion = useReducedMotion();
	const requirementCopy: Record<
		(typeof REQUIREMENTS)[number]['id'],
		{ detail: string; label: string }
	> = {
		'agent-cli': {
			detail: t(
				'onboarding:welcome.requirements.agent-cli.detail',
				'Pi or Claude Code',
			),
			label: t(
				'onboarding:welcome.requirements.agent-cli.label',
				'An agent CLI',
			),
		},
		github: {
			detail: t(
				'onboarding:welcome.requirements.github.detail',
				'Installed and signed in',
			),
			label: t('onboarding:welcome.requirements.github.label', 'GitHub CLI'),
		},
		linear: {
			detail: t('onboarding:welcome.requirements.linear.detail', 'Optional'),
			label: t('onboarding:welcome.requirements.linear.label', 'Linear'),
		},
	};

	return (
		<div className='flex size-full flex-col overflow-y-auto bg-canvas px-8 py-8'>
			<section className='m-auto flex w-full max-w-lg flex-col items-center gap-10 text-center'>
				<motion.div
					animate={{ opacity: 1, y: 0 }}
					initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
					transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
				>
					<WelcomeWordmark className='h-12 blur-[0.046875rem] sm:h-16' />
				</motion.div>

				<motion.div
					animate={{ opacity: 1, y: 0 }}
					className='flex flex-col gap-3'
					initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
					transition={{
						delay: 0.08,
						duration: 0.5,
						ease: [0.22, 1, 0.36, 1],
					}}
				>
					<h1 className='text-balance font-semibold text-2xl text-foreground tracking-tight'>
						{t('onboarding:welcome.title', "Let's get your machine ready")}
					</h1>
					<p className='text-pretty text-muted-foreground text-sm leading-6'>
						{t(
							'onboarding:welcome.lead',
							'Ensemblr runs coding agents and the GitHub CLI as local processes. A short check confirms they are there — it takes about a minute.',
						)}
					</p>
				</motion.div>

				<motion.ul
					animate={{ opacity: 1, y: 0 }}
					className='flex w-full flex-col gap-2'
					initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
					transition={{
						delay: 0.16,
						duration: 0.5,
						ease: [0.22, 1, 0.36, 1],
					}}
				>
					{REQUIREMENTS.map((requirement) => (
						<li
							className='flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left'
							key={requirement.id}
						>
							<span className='flex shrink-0 items-center -space-x-1.5'>
								{requirement.brands.map((brand) => (
									<OnboardingBrandSwatch checkId={brand} key={brand} />
								))}
							</span>
							<span className='min-w-0 flex-1 font-medium text-foreground text-sm'>
								{requirementCopy[requirement.id].label}
							</span>
							<span className='shrink-0 text-muted-foreground text-xs'>
								{requirementCopy[requirement.id].detail}
							</span>
						</li>
					))}
				</motion.ul>

				<motion.div
					animate={{ opacity: 1, y: 0 }}
					className='flex flex-col items-center gap-2'
					initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
					transition={{
						delay: 0.24,
						duration: 0.5,
						ease: [0.22, 1, 0.36, 1],
					}}
				>
					<Button onClick={onStart} size='lg' type='button'>
						{t('onboarding:welcome.start', 'Get started')}
						<ArrowRightIcon aria-hidden='true' data-icon='inline-end' />
					</Button>
					<Button onClick={onSkip} size='sm' type='button' variant='subtle'>
						{t('onboarding:welcome.skip', 'Skip setup')}
					</Button>
				</motion.div>
			</section>
			{/* Padded by more than the row needs: the language options float up out
			    of the trigger rather than pushing the wizard, so the gap above it is
			    what keeps them off the actions even on a window too short to centre
			    anything. */}
			<div className='flex shrink-0 justify-center pt-12'>
				<OnboardingLanguagePicker />
			</div>
		</div>
	);
}
