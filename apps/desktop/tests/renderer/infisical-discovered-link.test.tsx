// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { InfisicalDiscoveredNotice } from '@/renderer/components/settings/repo-infisical/infisical-discovered-notice';
import { InfisicalLinkSummary } from '@/renderer/components/settings/repo-infisical/infisical-link-summary';
import type { InfisicalLinkSnapshot } from '@/shared/ipc/contracts/infisical';

import { renderWithProviders } from './support/dom';

/** Builds a link snapshot, defaulting to one discovered in a `.infisical.json`. */
function link(
	overrides: Partial<InfisicalLinkSnapshot> = {},
): InfisicalLinkSnapshot {
	return {
		accountId: null,
		accountLabel: null,
		enabled: true,
		environmentSlug: 'dev',
		lastSyncedAt: null,
		origin: 'infisical-cli',
		projectId: 'proj-1',
		projectName: null,
		recursive: false,
		scope: 'repository',
		scopeId: 'repo-1',
		secretPath: '/',
		siteUrl: null,
		...overrides,
	};
}

/** Renders the summary strip with both of its actions stubbed out. */
function renderSummary(snapshot: InfisicalLinkSnapshot | null) {
	renderWithProviders(
		<InfisicalLinkSummary
			link={snapshot}
			onSync={() => {}}
			onUnlink={() => {}}
			syncing={false}
			unlinking={false}
		/>,
	);
}

describe('InfisicalDiscoveredNotice', () => {
	test('explains that nothing has been written to the committed config', () => {
		renderWithProviders(<InfisicalDiscoveredNotice link={link()} />);

		expect(screen.getByText(/\.infisical\.json/)).toBeInTheDocument();
		expect(
			screen.getByText(
				/Nothing has been written to \.ensemblr\/settings\.toml/,
			),
		).toBeInTheDocument();
	});

	test('asks for an environment when the CLI config named none', () => {
		renderWithProviders(
			<InfisicalDiscoveredNotice link={link({ environmentSlug: '' })} />,
		);

		expect(screen.getByText(/nothing resolves yet/)).toBeInTheDocument();
	});

	test('stays out of the way for a link Ensemblr saved itself', () => {
		renderWithProviders(
			<InfisicalDiscoveredNotice
				link={link({ accountId: 'acc-1', origin: 'local' })}
			/>,
		);

		expect(screen.queryByText(/\.infisical\.json/)).not.toBeInTheDocument();
	});

	test('stays out of the way when nothing is linked', () => {
		renderWithProviders(<InfisicalDiscoveredNotice link={null} />);

		expect(screen.queryByText(/\.infisical\.json/)).not.toBeInTheDocument();
	});
});

describe('InfisicalLinkSummary origins', () => {
	test('badges a discovered link as detected rather than as unsaved', () => {
		renderSummary(link());

		expect(screen.getByText('Detected')).toBeInTheDocument();
		expect(screen.queryByText('Not saved yet')).not.toBeInTheDocument();
	});

	test('offers no sync for a discovered link, which has no account to spend', () => {
		renderSummary(link());

		expect(
			screen.queryByRole('button', { name: /sync now/i }),
		).not.toBeInTheDocument();
	});

	test('still offers unlink for a discovered link, the only way to refuse it', () => {
		renderSummary(link());

		expect(screen.getByRole('button', { name: /unlink/i })).toBeInTheDocument();
	});

	test('keeps both actions for a link saved on this machine', () => {
		renderSummary(link({ accountId: 'acc-1', origin: 'local' }));

		expect(
			screen.getByRole('button', { name: /sync now/i }),
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /unlink/i })).toBeInTheDocument();
	});

	test('still reports a committed link with no local account as unsaved', () => {
		renderSummary(link({ origin: 'repository-config' }));

		expect(screen.getByText('Not saved yet')).toBeInTheDocument();
	});
});
