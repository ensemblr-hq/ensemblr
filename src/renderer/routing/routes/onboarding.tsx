import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	ensemblrQueryKeys,
	setupDiagnosticsQuery,
	startLinearLogin,
	updateAppSettings,
} from '@/renderer/api/ensemblr';
import { OnboardingWizard } from '@/renderer/components/onboarding';
import { useGenericRemediation } from '@/renderer/hooks/setup-diagnostics/use-remediation';
import { toOnboardingChecks } from '@/renderer/lib/onboarding';
import type {
	OnboardingCheckId,
	OnboardingRemediation,
} from '@/renderer/types/onboarding';
import type { SetupCheckSnapshot } from '@/shared/ipc/contracts/setup';

/** First-run setup route, rendered outside the workbench shell so it loads none of its data. */
export const Route = createFileRoute('/onboarding')({
	component: OnboardingRoute,
});

/**
 * Drives {@link OnboardingWizard} with the real setup-diagnostics probe, and
 * records the wizard's exit so it claims the window only once. Both ways out —
 * finishing and skipping — count as done; anything still unresolved is listed on
 * the wizard's last screen and lives on in Settings → Diagnostics.
 */
function OnboardingRoute() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: snapshot } = useQuery(setupDiagnosticsQuery);
	const [isRechecking, setIsRechecking] = useState(false);
	const handleRemediation = useOnboardingRemediation(snapshot?.checks ?? []);

	const checkTitles: Record<OnboardingCheckId, string> = {
		'claude-executable': t(
			'onboarding:checks.claude-executable',
			'Claude Code',
		),
		'gh-auth': t('onboarding:checks.gh-auth', 'GitHub CLI signed in'),
		'gh-cli': t('onboarding:checks.gh-cli', 'GitHub CLI installed'),
		'linear-oauth': t('onboarding:checks.linear-oauth', 'Linear account'),
		'pi-executable': t('onboarding:checks.pi-executable', 'Pi'),
	};

	const recheck = async () => {
		setIsRechecking(true);
		try {
			await queryClient.refetchQueries({
				queryKey: ensemblrQueryKeys.setupDiagnostics(),
			});
		} finally {
			setIsRechecking(false);
		}
	};

	// The write has to land before the navigation: `_shell`'s guard reads the
	// settings back, so seeding the cache with the persisted result is what stops
	// it bouncing straight back here.
	const finish = async () => {
		try {
			const settings = await updateAppSettings({
				onboarding: { completedAt: new Date().toISOString() },
			});
			queryClient.setQueryData(
				ensemblrQueryKeys.onboardingStatus(),
				settings.onboarding,
			);
		} catch (error) {
			// Seed the stamp the write failed to persist: it lets this session past
			// the guard rather than stranding the user on a dead button, and the
			// wizard reappears next launch, which is the honest outcome.
			console.error('Failed to record onboarding completion:', error);
			queryClient.setQueryData(ensemblrQueryKeys.onboardingStatus(), {
				completedAt: new Date().toISOString(),
			});
		}

		await navigate({ to: '/' });
	};

	return (
		<div className='relative h-(--ensemblr-shell-height) w-full'>
			<span
				aria-hidden='true'
				className='window-drag-region absolute inset-x-0 top-0 z-10 h-12'
			/>
			<OnboardingWizard
				checks={toOnboardingChecks(snapshot, checkTitles)}
				isRechecking={isRechecking}
				onFinish={() => {
					void finish();
				}}
				onRecheck={() => {
					void recheck();
				}}
				onRemediation={handleRemediation}
			/>
		</div>
	);
}

/**
 * Runs a wizard card's remediation. Everything reuses the shared diagnostics
 * handler except connecting Linear, which starts OAuth in place: the shared
 * handler navigates to Settings → Integrations, and leaving would discard the
 * wizard's deferred steps and current screen.
 * @param checks - The snapshot's checks, used to recover the check an action came from.
 * @returns The handler the wizard calls per remediation.
 */
function useOnboardingRemediation(
	checks: readonly SetupCheckSnapshot[],
): (remediation: OnboardingRemediation) => void {
	const queryClient = useQueryClient();
	const { handle } = useGenericRemediation({
		/** Re-runs the probe once a remediation has changed something. */
		onRetry: () => {
			void queryClient.refetchQueries({
				queryKey: ensemblrQueryKeys.setupDiagnostics(),
			});
		},
	});

	return (remediation) => {
		if (
			remediation.kind === 'open-settings' &&
			remediation.target === 'linear'
		) {
			void startLinearLogin().then(() =>
				queryClient.refetchQueries({
					queryKey: ensemblrQueryKeys.setupDiagnostics(),
				}),
			);
			return;
		}

		const check = checks.find((candidate) =>
			candidate.remediationActions.some(
				(action) => action.id === remediation.id,
			),
		);

		if (check) {
			void handle(remediation, check);
		}
	};
}
