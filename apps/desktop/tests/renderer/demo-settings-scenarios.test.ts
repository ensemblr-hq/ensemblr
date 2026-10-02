import { describe, expect, test } from 'vitest';

import repoActions from '../../demo/scenarios/repo-settings-actions';
import repoEnvironment from '../../demo/scenarios/repo-settings-environment';
import repoGit from '../../demo/scenarios/repo-settings-git';
import repoMisc from '../../demo/scenarios/repo-settings-misc';
import repoScripts from '../../demo/scenarios/repo-settings-scripts';
import repoSecrets from '../../demo/scenarios/repo-settings-secrets';
import repoSecurity from '../../demo/scenarios/repo-settings-security';
import settingsAppearance from '../../demo/scenarios/settings-appearance';
import settingsDiagnostics from '../../demo/scenarios/settings-diagnostics';
import settingsEnvironment from '../../demo/scenarios/settings-environment';
import settingsExperimental from '../../demo/scenarios/settings-experimental';
import settingsGeneral from '../../demo/scenarios/settings-general';
import settingsGit from '../../demo/scenarios/settings-git';
import settingsIntegrations from '../../demo/scenarios/settings-integrations';
import settingsModels from '../../demo/scenarios/settings-models';
import settingsProviders from '../../demo/scenarios/settings-providers';
import settingsShortcuts from '../../demo/scenarios/settings-shortcuts';

const scenarios = [
	settingsAppearance,
	settingsDiagnostics,
	settingsEnvironment,
	settingsExperimental,
	settingsGeneral,
	settingsGit,
	settingsIntegrations,
	settingsModels,
	settingsProviders,
	settingsShortcuts,
	repoActions,
	repoEnvironment,
	repoGit,
	repoMisc,
	repoScripts,
	repoSecrets,
	repoSecurity,
];

const EXPECTED_ROUTES = [
	'/settings/appearance',
	'/settings/diagnostics',
	'/settings/environment',
	'/settings/experimental',
	'/settings/general',
	'/settings/git',
	'/settings/integrations',
	'/settings/models',
	'/settings/providers',
	'/settings/shortcuts',
	'/settings/repo/repo-ensemblr/actions',
	'/settings/repo/repo-ensemblr/environment',
	'/settings/repo/repo-ensemblr/git',
	'/settings/repo/repo-ensemblr/misc',
	'/settings/repo/repo-ensemblr/scripts',
	'/settings/repo/repo-ensemblr/secrets',
	'/settings/repo/repo-ensemblr/security',
];

describe('demo settings scenarios', () => {
	test('covers every user and repository settings screen', () => {
		expect(scenarios.map((scenario) => scenario.route).sort()).toEqual(
			EXPECTED_ROUTES.sort(),
		);
	});

	test('provides populated data for data-backed settings screens', () => {
		expect(settingsEnvironment.environment?.variables.length).toBeGreaterThan(
			0,
		);
		expect(settingsEnvironment.envFiles?.paths.length).toBeGreaterThan(0);
		expect(settingsIntegrations.linear?.metadata.teams.length).toBeGreaterThan(
			0,
		);
		expect(repoEnvironment.environment?.variables.length).toBeGreaterThan(0);
		expect(repoScripts.runScripts.length).toBeGreaterThan(0);
		for (const scenario of [
			repoActions,
			repoGit,
			repoMisc,
			repoScripts,
			repoSecrets,
			repoSecurity,
		]) {
			expect(scenario.repositorySettings?.settings.length).toBeGreaterThan(0);
		}
	});

	test('shows cross-runtime policy and current model role assignments', () => {
		expect(
			settingsModels.appSettings?.models?.allowCrossRuntimeDelegation,
		).toBe(true);
		expect(settingsModels.appSettings?.models?.delegationInitiative).toBe(
			'on-request',
		);
		expect(settingsModels.appSettings?.models?.roleAssignments).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					runtime: 'claude',
					roles: ['sage', 'coder'],
				}),
				expect.objectContaining({
					runtime: 'pi',
					roles: ['builder', 'explorer'],
				}),
			]),
		);
		expect(settingsModels.interactions).toContainEqual({
			kind: 'scroll-into-view',
			selector: 'div',
			text: 'Builder',
		});
	});
});
