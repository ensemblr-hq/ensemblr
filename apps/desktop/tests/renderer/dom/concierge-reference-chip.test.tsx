// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ChatUserPrompt } from '@/renderer/components/chat-user-prompt';
import { ConciergeReferenceProvider } from '@/renderer/components/concierge/concierge-reference-context';
import { MessageResponse } from '@/renderer/components/message';
import {
	type ConciergeReference,
	formatConciergeReferenceBlock,
	conciergeReferenceId as referenceId,
} from '@/shared/concierge-references';

const WORKSPACE: ConciergeReference = {
	cwd: '/Users/me/Ensemblr/workspaces/ensemblr/khachaturian',
	kind: 'workspace',
	label: 'khachaturian',
	project: 'ensemblr',
	projectId: 'repo-1',
	workspaceId: 'ws-1',
};

const PROJECT: ConciergeReference = {
	kind: 'project',
	label: 'ensemblr',
	projectId: 'repo-1',
};

/** Access stub resolving only the references it was handed. */
function stubAccess(references: readonly ConciergeReference[]) {
	return {
		openReference: vi.fn(),
		resolveReference: vi.fn(
			(kind: string, id: string) =>
				references.find(
					(reference) =>
						reference.kind === kind && referenceId(reference) === id,
				) ?? null,
		),
	};
}

describe('Concierge references in an answer', () => {
	test('renders a resolvable workspace link as a chip that focuses it', async () => {
		const access = stubAccess([WORKSPACE]);
		render(
			<ConciergeReferenceProvider value={access}>
				<MessageResponse>
					{'Look at [khachaturian](ensemblr:workspace/ws-1) when you can.'}
				</MessageResponse>
			</ConciergeReferenceProvider>,
		);

		const chip = await screen.findByRole('button', { name: /khachaturian/ });
		await userEvent.click(chip);
		expect(access.openReference).toHaveBeenCalledWith(WORKSPACE);
	});

	test('leaves a project chip inert, since a project has nothing to focus', async () => {
		render(
			<ConciergeReferenceProvider value={stubAccess([PROJECT])}>
				<MessageResponse>
					{'[ensemblr](ensemblr:project/repo-1)'}
				</MessageResponse>
			</ConciergeReferenceProvider>,
		);

		expect(await screen.findByText('ensemblr')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /ensemblr/ })).toBeNull();
	});

	test('falls back to the link text when the app no longer holds the target', async () => {
		render(
			<ConciergeReferenceProvider value={stubAccess([])}>
				<MessageResponse>
					{'[archived-thing](ensemblr:workspace/gone)'}
				</MessageResponse>
			</ConciergeReferenceProvider>,
		);

		expect(await screen.findByText('archived-thing')).toBeInTheDocument();
		expect(screen.queryByRole('link')).toBeNull();
	});

	test("leaves an ordinary link to Streamdown's own link treatment", async () => {
		render(
			<ConciergeReferenceProvider value={stubAccess([WORKSPACE])}>
				<MessageResponse>{'[docs](https://example.com/docs)'}</MessageResponse>
			</ConciergeReferenceProvider>,
		);

		// Streamdown renders a link as its own safety-checked control rather than a
		// bare anchor, which is exactly what rewriting the element — instead of
		// overriding the `a` component — leaves untouched.
		const link = await screen.findByText('docs');
		expect(link).toHaveAttribute('data-streamdown', 'link');
	});
});

describe('Concierge references in a sent prompt', () => {
	test('reads a reference block back as a chip in document order', async () => {
		const access = stubAccess([WORKSPACE]);
		const prompt = [
			'what changed in',
			formatConciergeReferenceBlock(WORKSPACE),
			'today?',
		].join('\n\n');

		render(
			<ConciergeReferenceProvider value={access}>
				<ChatUserPrompt prompt={prompt} />
			</ConciergeReferenceProvider>,
		);

		expect(screen.getByText('what changed in')).toBeInTheDocument();
		expect(screen.getByText('today?')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: /khachaturian/ }));
		expect(access.openReference).toHaveBeenCalledWith(WORKSPACE);
	});
});
