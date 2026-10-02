// @vitest-environment happy-dom

/**
 * The MCP panel is an audit surface: it lists what the runtime resolved and gets
 * out of the way. Scope tiers and an unhealthy-count badge were noise, and the
 * roster has to scroll rather than spill past the popover.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { getRosterHeight } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/mcp-roster-height';
import { McpServersPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/mcp-servers-panel';
import { useProvideDockTerminal } from '../../src/renderer/state/workspace/terminal-requests';
import type { AgentProviderMcpServerWire } from '../../src/shared/ipc/contracts/agent-provider';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const SERVERS: readonly AgentProviderMcpServerWire[] = [
	{ error: null, name: 'obsidian', status: 'connected' },
	{ error: null, name: 'claude.ai Linear', status: 'needs-auth' },
	{ error: 'connection refused', name: 'fallow', status: 'failed' },
];

/** Stands in for a workspace dock, registering itself for terminal requests. */
function DockStub({
	open,
	workspaceId,
}: {
	open: (request: { command: string; title: string }) => void;
	workspaceId: string;
}) {
	useProvideDockTerminal(workspaceId, open);
	return null;
}

/** Renders the panel over a stub bridge and opens its popover. */
async function openPanel(
	servers: readonly AgentProviderMcpServerWire[] = SERVERS,
	dock?: { open: (request: { command: string; title: string }) => void },
) {
	installEnsemblrApi({
		getAgentProviderExecutablePath: vi.fn(async () => ({
			resolvedPath: '/opt/homebrew/bin/claude',
		})),
		listAgentProviderMcpServers: vi.fn(async () => ({ error: null, servers })),
	});
	renderWithProviders(
		<>
			{dock ? <DockStub open={dock.open} workspaceId='w1' /> : null}
			<McpServersPanel cwd='/workspaces/demo' workspaceId='w1' />
		</>,
	);

	await userEvent.click(screen.getByLabelText('MCP servers'));
	await waitFor(() => expect(screen.getByText('obsidian')).toBeInTheDocument());
}

afterEach(() => {
	clearEnsemblrApi();
});

// Authorising is the one thing the panel hands off rather than reports: it runs
// the runtime's own `/mcp` prompt in the workspace's dock, quoted so a path with
// spaces survives.
test('authorising runs the runtime`s own MCP prompt in this workspace`s dock', async () => {
	const open = vi.fn();
	await openPanel(SERVERS, { open });

	await userEvent.click(screen.getByLabelText('Authorise claude.ai Linear'));

	expect(open).toHaveBeenCalledWith({
		command: "'/opt/homebrew/bin/claude' /mcp",
		title: 'Claude Code /mcp',
	});
});

test('server rows carry no scope tier', async () => {
	await openPanel();

	expect(screen.queryByText('user')).not.toBeInTheDocument();
	expect(screen.queryByText('claudeai')).not.toBeInTheDocument();
});

test('a status label is the last thing in its row, so labels line up right', async () => {
	await openPanel();

	const authRow = screen.getByLabelText('Authorise claude.ai Linear');

	expect(authRow.lastElementChild).toHaveTextContent('Needs auth');
});

test('the whole needs-auth row is the button, not just its label', async () => {
	await openPanel();

	const authRow = screen.getByLabelText('Authorise claude.ai Linear');

	expect(authRow.tagName).toBe('BUTTON');
	expect(authRow).toHaveTextContent('claude.ai Linear');
	expect(authRow.querySelector('button')).toBeNull();
});

// The two row kinds are laid out by one class string, so an authorise row cannot
// drift from a plain one on height, padding, or gap.
test('an authorise row shares its geometry with a plain row', async () => {
	await openPanel();

	const authRow = screen.getByLabelText('Authorise claude.ai Linear');
	const plainRow = screen.getByText('obsidian').parentElement;
	const geometry = (element: Element) =>
		Array.from(element.classList).filter((token) =>
			/^(flex|w-full|items-|gap-|rounded-|px-|py-|text-left)/.test(token),
		);

	expect(geometry(authRow)).toEqual([
		'flex',
		'w-full',
		'items-center',
		'gap-2',
		'rounded-md',
		'px-1',
		'py-1',
		'text-left',
	]);
	expect(geometry(plainRow as Element)).toEqual(geometry(authRow));
});

test('the trigger stays plain, with no unhealthy count', async () => {
	await openPanel();

	expect(screen.getByLabelText('MCP servers')).not.toHaveTextContent(/\d/);
});

// Radix's ScrollArea viewport is `height: 100%`, which collapses to auto against
// a `max-height`-only parent — the roster then spills out of the popover with no
// scrollbar. The height has to be a definite length for the viewport to scroll.
test('the roster height is a definite length, not a max', () => {
	expect(getRosterHeight(SERVERS.length)).toBe(
		'min(4.5rem, 18rem, calc(var(--radix-popover-content-available-height, 100vh) - 2.75rem))',
	);
});

test('the roster stops growing once it would outgrow the popover', () => {
	expect(getRosterHeight(40).startsWith('min(60rem, 18rem,')).toBe(true);
});
