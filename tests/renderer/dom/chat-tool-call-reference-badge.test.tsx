// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ChatToolCall } from '../../../src/renderer/components/chat-tool-call';
import { ConciergeReferenceProvider } from '../../../src/renderer/components/concierge/concierge-reference-context';
import { findConciergeReference } from '../../../src/renderer/lib/concierge';
import type { ConciergeReference } from '../../../src/shared/concierge-references';
import { renderWithProviders } from '../support/dom';

const WORKSPACE: ConciergeReference = {
	cwd: '~/Ensemblr/workspaces/bruckner/beta-16',
	kind: 'workspace',
	label: 'beta-16',
	project: 'Bruckner',
	projectId: 'repo-1',
	workspaceId: 'ws-new',
};

const CHAT: ConciergeReference = {
	agentSessionId: 'session-1',
	chatTabId: 'tab-1',
	kind: 'chat',
	label: 'Smoke test',
	role: 'orchestrator',
	state: 'open',
	workspace: 'beta-16',
	workspaceId: 'ws-new',
};

/** A settled `ensemblr_create_workspace` call, as the Pi extension records it. */
function createWorkspaceCall(): DynamicToolUIPart {
	return {
		input: { name: 'beta-16', projectId: 'repo-1' },
		output: {
			details: { data: { name: 'beta-16', workspaceId: 'ws-new' }, ok: true },
			text: '{"name":"beta-16","workspaceId":"ws-new"}',
		},
		state: 'output-available',
		toolCallId: 'call-1',
		toolName: 'ensemblr_create_workspace',
		type: 'dynamic-tool',
	} as DynamicToolUIPart;
}

/** A settled `ensemblr_start_conversation` call, which reports the tab it opened. */
function startConversationCall(): DynamicToolUIPart {
	return {
		input: {
			prompt: 'run the smoke test',
			title: 'Smoke test',
			workspaceId: 'ws-new',
		},
		output: {
			details: {
				data: { agentSessionId: 'session-1', chatTabId: 'tab-1' },
				ok: true,
			},
			text: '{"agentSessionId":"session-1","chatTabId":"tab-1"}',
		},
		state: 'output-available',
		toolCallId: 'call-2',
		toolName: 'ensemblr_start_conversation',
		type: 'dynamic-tool',
	} as DynamicToolUIPart;
}

/** Mounts a row inside the Concierge, against the catalogue it is given. */
function renderInConcierge(
	part: DynamicToolUIPart,
	references: readonly ConciergeReference[] = [WORKSPACE, CHAT],
) {
	const openReference = vi.fn();
	const { container } = renderWithProviders(
		<ConciergeReferenceProvider
			// The real resolver, so a row is held to the same lookup the panel does —
			// including a chat answering to its agent session id.
			value={{
				openReference,
				resolveReference: (kind, id) =>
					findConciergeReference(references, kind, id),
			}}
		>
			<ChatToolCall part={part} />
		</ConciergeReferenceProvider>,
	);
	return { container, openReference };
}

/**
 * What the row's heading holds beside the disclosure button — the badge slot and
 * the preview chip. An unresolved chip must leave no slot behind: the heading is
 * a `gap-2` flex row, so an empty one is a hole after the title.
 */
const headingExtrasIn = (container: HTMLElement): number => {
	const heading = container.querySelector('[class~="group/collapsible"]');
	return (heading?.children.length ?? 0) - 1;
};

describe('a control row that named a workspace', () => {
	test('pins the workspace by its current name rather than its id', () => {
		const { container } = renderInConcierge(createWorkspaceCall());

		expect(screen.getByText('Created a workspace')).toBeInTheDocument();
		expect(screen.getByText('beta-16')).toBeInTheDocument();
		expect(screen.queryByText(/ws-new/)).not.toBeInTheDocument();
		expect(screen.queryByText(/repo-1/)).not.toBeInTheDocument();
		expect(headingExtrasIn(container)).toBe(1);
	});

	test('opens the workspace when the chip is clicked', () => {
		const { openReference } = renderInConcierge(createWorkspaceCall());

		fireEvent.click(screen.getByRole('button', { name: /beta-16/ }));

		expect(openReference).toHaveBeenCalledWith(WORKSPACE);
	});

	// An archived or deleted workspace resolves to nothing. The title already says
	// what happened, so a chip that opens onto nothing is worse than none.
	test('pins nothing when the catalogue no longer holds it', () => {
		const { container } = renderInConcierge(createWorkspaceCall(), []);

		expect(screen.getByText('Created a workspace')).toBeInTheDocument();
		expect(screen.queryByText('beta-16')).not.toBeInTheDocument();
		expect(headingExtrasIn(container)).toBe(0);
	});

	// Nothing outside the Concierge can resolve one of these, and a slot kept for
	// a chip that never arrives is a hole in a `gap-2` heading.
	test('leaves no badge slot behind on a workspace transcript', () => {
		const { container } = renderWithProviders(
			<ChatToolCall part={createWorkspaceCall()} />,
		);

		expect(screen.getByText('Created a workspace')).toBeInTheDocument();
		expect(headingExtrasIn(container)).toBe(0);
	});
});

describe('a spawn row', () => {
	// The subject of the row is the conversation it opened, not the workspace that
	// conversation happens to live in.
	test('pins the chat it opened, not its workspace', () => {
		const { openReference } = renderInConcierge(startConversationCall());

		fireEvent.click(screen.getByRole('button', { name: /Smoke test/ }));

		expect(openReference).toHaveBeenCalledWith(CHAT);
	});

	// A tab nobody has named yet is deliberately absent from the catalogue, and
	// that is the state a spawn row is written in — so the workspace stands in
	// rather than the row carrying no chip at all.
	test('falls back to the workspace while the tab is unnamed', () => {
		const { openReference } = renderInConcierge(startConversationCall(), [
			WORKSPACE,
		]);

		fireEvent.click(screen.getByRole('button', { name: /beta-16/ }));

		expect(openReference).toHaveBeenCalledWith(WORKSPACE);
	});

	// What the Concierge spawns is a root orchestrator in a workspace the user can
	// open and talk to, not a sub-agent reporting back to it. The chip carries the
	// title, so the row does not spell it out a second time.
	test('reads as a chat inside the Concierge', () => {
		renderInConcierge(startConversationCall());

		expect(screen.getByText('Started a chat')).toBeInTheDocument();
		expect(screen.queryByText(/Started a chat:/)).not.toBeInTheDocument();
	});

	// The chip may carry the title, but only if it resolves. A spawn into a
	// workspace the Concierge cut seconds ago races the very query the catalogue
	// is built from, and "Started a chat" alone names nothing at all.
	test('spells the title out when neither chip resolves', () => {
		const { container } = renderInConcierge(startConversationCall(), []);

		expect(screen.getByText('Started a chat: Smoke test')).toBeInTheDocument();
		expect(headingExtrasIn(container)).toBe(0);
	});

	test('reads as a sub-agent inside a workspace chat', () => {
		renderWithProviders(<ChatToolCall part={startConversationCall()} />);

		expect(
			screen.getByText('Started a sub-agent: Smoke test'),
		).toBeInTheDocument();
	});
});

describe('a row that acted on a chat by its session', () => {
	/** A settled call addressed the way every steer-and-read op is: by session. */
	const sessionCall = (toolName: string): DynamicToolUIPart =>
		({
			input: { agentSessionId: 'session-1' },
			output: { details: { data: {}, ok: true }, text: '{}' },
			state: 'output-available',
			toolCallId: 'call-3',
			toolName,
			type: 'dynamic-tool',
		}) as DynamicToolUIPart;

	// "Checked a chat" with nothing beside it does not say which chat, and the
	// session id it was called with is not something the catalogue is keyed on.
	test.each([
		['ensemblr_get_conversation_status', 'Checked a chat'],
		['ensemblr_get_last_message', "Read a chat's report"],
		['ensemblr_read_conversation', "Read a chat's transcript"],
		['ensemblr_send_follow_up', 'Steered a chat'],
	])('%s names the chat it acted on', (toolName, title) => {
		const { openReference } = renderInConcierge(sessionCall(toolName));

		expect(screen.getByText(title)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /Smoke test/ }));

		expect(openReference).toHaveBeenCalledWith(CHAT);
	});
});
