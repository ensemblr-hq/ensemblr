// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { OnboardingCheckCard } from '@/renderer/components/onboarding/onboarding-check-card';
import type { OnboardingCheckModel } from '@/renderer/types/onboarding';

import { renderWithProviders } from '../support/dom';

/**
 * Builds a wizard card model; the caller overrides only the fields under test.
 * @param overrides - Fields to replace on the baseline model.
 * @returns The model to render.
 */
function makeCheck(
	overrides: Partial<OnboardingCheckModel> = {},
): OnboardingCheckModel {
	return {
		detail: 'Linear is not connected.',
		id: 'linear-oauth',
		remediations: [],
		status: 'warning',
		title: 'Linear account',
		...overrides,
	};
}

describe('OnboardingCheckCard', () => {
	test('labels the Linear remediation for the OAuth the wizard runs in place', () => {
		renderWithProviders(
			<OnboardingCheckCard
				check={makeCheck({
					remediations: [
						{
							id: 'open-linear-settings',
							kind: 'open-settings',
							label: 'Open integration settings',
							target: 'linear',
						},
					],
				})}
			/>,
		);

		expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /integration settings/ }),
		).not.toBeInTheDocument();
	});

	test('leaves an unoverridden remediation on its shared diagnostics label', () => {
		renderWithProviders(
			<OnboardingCheckCard
				check={makeCheck({
					remediations: [
						{ id: 'retry-linear', kind: 'retry', label: 'Retry Linear check' },
					],
				})}
			/>,
		);

		expect(
			screen.getByRole('button', { name: /Retry Linear check/ }),
		).toBeInTheDocument();
	});
});
