import type { TFunction } from 'i18next';
import { describe, expect, test } from 'vitest';

import { PROVIDER_DETAIL_TEXT } from '../../src/renderer/lib/provider-check-text/details';
import {
	providerCheckDetail,
	providerCheckLabel,
} from '../../src/renderer/lib/provider-check-text/index';
import { SETUP_DETAIL_TEXT } from '../../src/renderer/lib/setup-check-text/details';
import {
	piAgentDirectorySourceLabel,
	piExecutableSourceLabel,
	setupCheckDetail,
	setupCheckTitle,
	setupLogLabel,
	setupRemediationLabel,
} from '../../src/renderer/lib/setup-check-text/index';
import { SETUP_LOG_LABEL_TEXT } from '../../src/renderer/lib/setup-check-text/log-labels';
import { SETUP_REMEDIATION_LABEL } from '../../src/renderer/lib/setup-check-text/remediations';
import { SETUP_CHECK_TITLE } from '../../src/renderer/lib/setup-check-text/titles';
import type {
	AgentProviderDetailCode,
	AgentProviderDetailMessage,
} from '../../src/shared/ipc/contracts/agent-provider';
import type {
	SetupCheckId,
	SetupDetailCode,
	SetupLogLabelCode,
} from '../../src/shared/ipc/contracts/setup';

// Stands in for i18next without booting it: returns the call site's own English
// default with `{{placeholders}}` filled, so a test failure means the mapper is
// wrong rather than that a catalogue is missing a key.
const t = ((key: string, second?: unknown, third?: unknown): string => {
	const options = (typeof second === 'object' ? second : third) as
		| Record<string, unknown>
		| undefined;
	const fallback =
		typeof second === 'string'
			? second
			: ((options?.defaultValue_other ??
					options?.defaultValue_one ??
					key) as string);

	return fallback.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
		options && name in options ? String(options[name]) : whole,
	);
}) as unknown as TFunction;

/** Every value a mapper interpolates, so no placeholder is left unresolved. */
const PARAMS = {
	command: '/opt/homebrew/bin/claude',
	configured: 3,
	count: 2,
	cwd: '/tmp/smoke',
	frameType: 'ready',
	hostname: 'github.com',
	identity: 'ada@example.com',
	keys: 'repos, workspaces',
	kind: 'version',
	masked: 1,
	message: 'boom',
	modelCount: 9,
	organization: 'Acme',
	organizations: 'Acme, Client Co',
	path: '/opt/homebrew/bin/pi',
	plan: 'Max',
	probeDetail: 'pi 1.2.3',
	probeKind: 'version',
	provider: 'Pi',
	providerCount: 4,
	reserved: 2,
	schemaVersion: 12,
	seconds: 30,
	servers: 'ctx: failed',
	source: 'path',
	version: 'git 2.44.0',
};

/** Fails on an unresolved `{{placeholder}}` or an echoed catalogue key. */
function expectRendered(value: string, key: string) {
	expect(value.length).toBeGreaterThan(0);
	expect(value).not.toContain('{{');
	expect(value).not.toBe(key);
}

describe('setup check text', () => {
	test('every detail code renders with its placeholders filled', () => {
		const codes = Object.keys(SETUP_DETAIL_TEXT) as SetupDetailCode[];
		expect(codes.length).toBeGreaterThan(0);

		for (const code of codes) {
			expectRendered(
				setupCheckDetail(
					{ detail: 'EN', detailMessage: { code, params: PARAMS } },
					t,
				),
				code,
			);
		}
	});

	test('every check id renders a title', () => {
		for (const id of Object.keys(SETUP_CHECK_TITLE) as SetupCheckId[]) {
			expectRendered(setupCheckTitle(id, t), id);
		}
	});

	test('every log label code renders', () => {
		for (const code of Object.keys(
			SETUP_LOG_LABEL_TEXT,
		) as SetupLogLabelCode[]) {
			expectRendered(
				setupLogLabel(
					{ label: 'EN', labelMessage: { code, params: PARAMS } },
					t,
				),
				code,
			);
		}
	});

	test('every remediation id renders a label', () => {
		for (const id of Object.keys(SETUP_REMEDIATION_LABEL)) {
			expectRendered(
				setupRemediationLabel({ id, kind: 'retry', label: 'EN' }, t),
				id,
			);
		}
	});

	test('a detail with no message passes the English through untranslated', () => {
		expect(
			setupCheckDetail(
				{ detail: 'ENOENT: no such file', detailMessage: undefined },
				t,
			),
		).toBe('ENOENT: no such file');
	});

	test('a log with no label message passes its label through', () => {
		expect(setupLogLabel({ label: 'stderr', labelMessage: undefined }, t)).toBe(
			'stderr',
		);
	});

	test('an uncatalogued retry falls back to the generic label', () => {
		expect(
			setupRemediationLabel(
				{ id: 'retry-something-new', kind: 'retry', label: 'EN' },
				t,
			),
		).toBe('Retry check');
	});

	test('an uncatalogued non-retry keeps the English the check authored', () => {
		expect(
			setupRemediationLabel(
				{ id: 'open-something', kind: 'open-external', label: 'Open it' },
				t,
			),
		).toBe('Open it');
	});

	test('the pi executable source label names each source and falls back', () => {
		expect(piExecutableSourceLabel('path', t)).toBe('shell PATH');
		expect(piExecutableSourceLabel('sqlite', t)).toBe('user override');
		expect(piExecutableSourceLabel('nonsense', t)).toBe('unknown source');
		expect(piExecutableSourceLabel(undefined, t)).toBe('unknown source');
	});

	test('the pi agent-directory source label localizes default and keeps the env var', () => {
		expect(piAgentDirectorySourceLabel('environment', t)).toBe(
			'PI_CODING_AGENT_DIR',
		);
		expect(piAgentDirectorySourceLabel('default', t)).toBe(
			'Pi default location',
		);
	});

	test('the agent-directory detail does not leak the raw source enum', () => {
		const rendered = setupCheckDetail(
			{
				detail: 'EN',
				detailMessage: {
					code: 'pi-agent-directory-ready',
					params: { path: '~/.pi/agent', source: 'default' },
				},
			},
			t,
		);

		expect(rendered).toContain('Pi default location');
		expect(rendered).not.toContain('(default)');
	});
});

describe('provider check text', () => {
	test('every provider detail code renders with its placeholders filled', () => {
		const codes = Object.keys(
			PROVIDER_DETAIL_TEXT,
		) as AgentProviderDetailCode[];
		expect(codes.length).toBeGreaterThan(0);

		for (const code of codes) {
			const detailMessage: AgentProviderDetailMessage = {
				code,
				params: PARAMS,
			};
			expectRendered(
				providerCheckDetail({ detail: 'EN', detailMessage }, t) ?? '',
				code,
			);
		}
	});

	test('the provider agent-directory detail does not leak the raw source enum', () => {
		const rendered = providerCheckDetail(
			{
				detail: 'EN',
				detailMessage: {
					code: 'pi-agent-directory-resolved',
					params: { path: '~/.pi/agent', source: 'default' },
				},
			},
			t,
		);

		expect(rendered).toBe('~/.pi/agent (Pi default location).');
	});

	test('a detail with no message passes the probe text through', () => {
		expect(
			providerCheckDetail(
				{ detail: 'spawn ENOENT', detailMessage: undefined },
				t,
			),
		).toBe('spawn ENOENT');
		expect(
			providerCheckDetail({ detail: null, detailMessage: undefined }, t),
		).toBeNull();
	});

	test('check labels fold the runtime name in and fall back to the wire label', () => {
		expect(
			providerCheckLabel({ id: 'executable', label: 'EN' }, 'pi', t),
		).toContain('executable');
		expect(providerCheckLabel({ id: 'auth', label: 'EN' }, 'claude', t)).toBe(
			'Authentication',
		);
		expect(
			providerCheckLabel(
				{ id: 'brand-new-check', label: 'Brand new' },
				'pi',
				t,
			),
		).toBe('Brand new');
	});
});
