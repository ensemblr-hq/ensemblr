import type { RunScriptDefinition } from '@/shared/scripts';

import type { DemoTerminal } from '../scenario.ts';

import {
	DEV_SERVER_OUTPUT,
	SETUP_SCRIPT_OUTPUT,
	SHELL_OUTPUT,
} from './terminal-output.ts';

/**
 * The run scripts the demo repository declares, matching the shape a real
 * `.ensemblr/settings.toml` produces.
 */
export const DEMO_RUN_SCRIPTS: readonly RunScriptDefinition[] = [
	{
		availableIn: ['local'],
		command: 'npm run dev',
		icon: 'play',
		isDefault: true,
		name: 'dev',
	},
	{
		availableIn: ['local'],
		command: 'npm run test',
		icon: 'test-tube',
		isDefault: false,
		name: 'test',
	},
	{
		availableIn: ['local'],
		command: 'npm run check && npm run typecheck',
		icon: 'list-checks',
		isDefault: false,
		name: 'checks',
	},
];

/**
 * The dock a workspace shot inherits when the dock is not itself the subject.
 *
 * Every workspace scenario carries it, because an empty dock renders the "Add
 * setup script" upsell — a third of the frame spent telling the reader the
 * workspace is not set up yet, which is the one thing a screenshot of a
 * configured project must not say.
 */
export const DEMO_TERMINALS: readonly DemoTerminal[] = [
	{
		id: 'terminal-run',
		kind: 'run-script',
		output: DEV_SERVER_OUTPUT,
		scriptName: 'dev',
		title: 'dev',
	},
	{
		id: 'terminal-setup',
		kind: 'setup-script',
		output: SETUP_SCRIPT_OUTPUT,
		title: 'setup',
	},
	{
		id: 'terminal-shell',
		kind: 'terminal',
		output: SHELL_OUTPUT,
		title: 'zsh',
	},
];
