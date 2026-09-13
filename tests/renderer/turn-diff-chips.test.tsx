// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { ChatTurnFooter } from '@/renderer/components/chat-turn-footer';
import type { GetWorkspaceGitStatusResult } from '@/shared/ipc/contracts/workspace-git';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installImmediateIntersectionObserver,
	renderWithProviders,
} from './support/dom';

const FROM_REF = 'a'.repeat(40);
const TO_REF = 'b'.repeat(40);

/** A status payload naming the files a turn changed. */
function statusResult(): GetWorkspaceGitStatusResult {
	return {
		files: [
			{ additions: 1, deletions: 1, path: 'AGENTS.md', status: 'modified' },
			{ additions: 4, deletions: 0, path: 'src/app.ts', status: 'added' },
		],
		summary: { additions: 5, deletions: 1, files: 2 },
	};
}

beforeEach(() => {
	clearEnsemblrApi();
	const restore = installImmediateIntersectionObserver();
	return restore;
});

test('the footer shows one chip per file the turn changed, with its counts', async () => {
	const getWorkspaceGitStatus = vi.fn(async () => statusResult());
	installEnsemblrApi({ getWorkspaceGitStatus });

	renderWithProviders(
		<ChatTurnFooter
			answerText=''
			durationMs={14_000}
			onOpenTurnFile={() => undefined}
			turnScope={{ fromRef: FROM_REF, kind: 'turn', toRef: TO_REF }}
			workspaceCwd='/tmp/ws'
		/>,
	);

	expect(await screen.findByText('AGENTS.md')).toBeInTheDocument();
	expect(screen.getByText('app.ts')).toBeInTheDocument();
	expect(screen.getByText('+1')).toBeInTheDocument();
	expect(screen.getByText('-1')).toBeInTheDocument();
	expect(screen.getByText('+4')).toBeInTheDocument();

	expect(getWorkspaceGitStatus).toHaveBeenCalledWith({
		scope: { fromRef: FROM_REF, kind: 'turn', toRef: TO_REF },
		workspaceCwd: '/tmp/ws',
	});
});

test('clicking a chip opens that file at the turn it belongs to', async () => {
	installEnsemblrApi({ getWorkspaceGitStatus: async () => statusResult() });
	const onOpenTurnFile = vi.fn();

	renderWithProviders(
		<ChatTurnFooter
			answerText=''
			durationMs={null}
			onOpenTurnFile={onOpenTurnFile}
			turnScope={{ fromRef: FROM_REF, kind: 'turn' }}
			workspaceCwd='/tmp/ws'
		/>,
	);

	await userEvent.click(await screen.findByText('AGENTS.md'));

	expect(onOpenTurnFile).toHaveBeenCalledWith('AGENTS.md');
});

test('a turn with no checkpoint renders no chips and reads no git status', async () => {
	const getWorkspaceGitStatus = vi.fn(async () => statusResult());
	installEnsemblrApi({ getWorkspaceGitStatus });

	renderWithProviders(
		<ChatTurnFooter
			answerText=''
			durationMs={14_000}
			onOpenTurnFile={() => undefined}
			turnScope={null}
			workspaceCwd='/tmp/ws'
		/>,
	);

	await waitFor(() => {
		expect(screen.getByText('14.0s')).toBeInTheDocument();
	});
	expect(screen.queryByText('AGENTS.md')).not.toBeInTheDocument();
	expect(getWorkspaceGitStatus).not.toHaveBeenCalled();
});

test('the footer prints the wall-clock time the turn ended beside its duration', () => {
	renderWithProviders(
		<ChatTurnFooter
			answerText=''
			durationMs={14_000}
			endedAtMs={new Date('2026-09-13T15:48:00').getTime()}
		/>,
	);

	expect(screen.getByText('14.0s')).toBeInTheDocument();
	expect(screen.getByText(/3:48|15:48/)).toBeInTheDocument();
});
