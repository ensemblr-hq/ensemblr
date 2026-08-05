import { describe, expect, test } from 'vitest';

import { selectActiveRunScript } from '@/renderer/lib/terminal';
import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';
import type { RunScriptDefinition } from '@/shared/scripts';

function definition(
	overrides: Partial<RunScriptDefinition> & { name: string },
): RunScriptDefinition {
	return {
		availableIn: null,
		command: `npm run ${overrides.name}`,
		icon: 'play',
		isDefault: false,
		...overrides,
	};
}

const DEV = definition({ isDefault: true, name: 'dev' });
const CHECKS = definition({ name: 'checks' });
const TEST = definition({ name: 'test' });
const SCRIPTS = [DEV, CHECKS, TEST];

const NOT_RUN: WorkspaceScriptSummary = { status: 'not-run' };

function running(scriptName: string | null): WorkspaceScriptSummary {
	return { scriptName, status: 'running' };
}

describe('selectActiveRunScript', () => {
	test('returns null when the repository configures none', () => {
		expect(
			selectActiveRunScript({
				rememberedName: 'dev',
				runScripts: [],
				runSummary: NOT_RUN,
			}),
		).toBeNull();
	});

	test('falls back to the default when nothing is running or remembered', () => {
		expect(
			selectActiveRunScript({
				rememberedName: null,
				runScripts: SCRIPTS,
				runSummary: NOT_RUN,
			}),
		).toBe(DEV);
	});

	test('prefers the remembered script over the default', () => {
		expect(
			selectActiveRunScript({
				rememberedName: 'checks',
				runScripts: SCRIPTS,
				runSummary: NOT_RUN,
			}),
		).toBe(CHECKS);
	});

	test('prefers the running script over the remembered one', () => {
		expect(
			selectActiveRunScript({
				rememberedName: 'checks',
				runScripts: SCRIPTS,
				runSummary: running('test'),
			}),
		).toBe(TEST);
	});

	test('ignores a remembered script the repository no longer configures', () => {
		expect(
			selectActiveRunScript({
				rememberedName: 'deleted',
				runScripts: SCRIPTS,
				runSummary: NOT_RUN,
			}),
		).toBe(DEV);
	});

	test('ignores a running session whose script was renamed away', () => {
		expect(
			selectActiveRunScript({
				rememberedName: 'checks',
				runScripts: SCRIPTS,
				runSummary: running('renamed'),
			}),
		).toBe(CHECKS);
	});

	test('ignores a running session that carries no script name', () => {
		expect(
			selectActiveRunScript({
				rememberedName: 'checks',
				runScripts: SCRIPTS,
				runSummary: running(null),
			}),
		).toBe(CHECKS);
	});

	test('falls back to the first script when none is flagged default', () => {
		expect(
			selectActiveRunScript({
				rememberedName: null,
				runScripts: [CHECKS, TEST],
				runSummary: NOT_RUN,
			}),
		).toBe(CHECKS);
	});
});
