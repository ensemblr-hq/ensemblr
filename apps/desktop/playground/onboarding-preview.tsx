import { useEffect, useRef, useState } from 'react';

import { OnboardingWizard } from '@/renderer/components/onboarding';

import {
	buildOnboardingChecks,
	LINEAR_SCENARIOS,
	type LinearScenarioId,
	ONBOARDING_SCENARIOS,
	type OnboardingScenarioId,
} from './onboarding-fixtures.ts';
import {
	ControlGroup,
	SceneControls,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/** How long the simulated re-check spins before results land. */
const RECHECK_DURATION_MS = 1200;

/**
 * First-run onboarding without Electron. The wizard is presentational and takes
 * its probe results as a prop, so the scene drives every permutation from local
 * state rather than through the bridge — the real diagnostics query owns a poll
 * that would fight these toggles.
 */
export function OnboardingScene() {
	const [scenario, setScenario] = useState<OnboardingScenarioId>('nothing');
	const [linear, setLinear] = useState<LinearScenarioId>('disconnected');
	const [isRechecking, setIsRechecking] = useState(false);
	const recheckTimer = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (recheckTimer.current !== null) {
				window.clearTimeout(recheckTimer.current);
			}
		},
		[],
	);

	const simulateRecheck = () => {
		setIsRechecking(true);
		recheckTimer.current = window.setTimeout(
			() => setIsRechecking(false),
			RECHECK_DURATION_MS,
		);
	};

	return (
		<SceneSection
			label='First run · Onboarding'
			note='Three gates over one probe set. The agent-CLI step is satisfied by either CLI, so a Pi-only machine reads as ready and the runtime you skipped dims instead of turning red.'
		>
			<SceneControls>
				<ControlGroup label='machine'>
					{ONBOARDING_SCENARIOS.map((option) => (
						<SceneToggle
							isActive={option.id === scenario}
							key={option.id}
							label={option.label}
							onClick={() => setScenario(option.id)}
						/>
					))}
				</ControlGroup>
				<ControlGroup label='linear'>
					{LINEAR_SCENARIOS.map((option) => (
						<SceneToggle
							isActive={option.id === linear}
							key={option.id}
							label={option.label}
							onClick={() => setLinear(option.id)}
						/>
					))}
				</ControlGroup>
			</SceneControls>

			<div className='h-160 overflow-hidden rounded-md border border-border'>
				<OnboardingWizard
					checks={buildOnboardingChecks(scenario, linear)}
					isRechecking={isRechecking}
					onRecheck={simulateRecheck}
				/>
			</div>
		</SceneSection>
	);
}
