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

test('a symlink chip carries no counts and opens nothing', async () => {
	installEnsemblrApi({
		getWorkspaceGitStatus: async () => ({
			files: [
				{
					additions: 0,
					deletions: 0,
					path: 'hello2',
					status: 'untracked',
					symlinkTargetKind: 'file',
				},
			],
			summary: { additions: 0, deletions: 0, files: 1 },
		}),
	});
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

	const chip = await screen.findByText('hello2');
	// A link's content is the path it points at, so `+0 -0` would be a lie.
	expect(screen.queryByText('+0')).not.toBeInTheDocument();
	expect(screen.queryByText('-0')).not.toBeInTheDocument();

	await userEvent.click(chip);
	expect(onOpenTurnFile).not.toHaveBeenCalled();
});

test('the timing cluster cannot wrap away from the chips beside it', async () => {
	installEnsemblrApi({ getWorkspaceGitStatus: async () => statusResult() });

	const { container } = renderWithProviders(
		<ChatTurnFooter
			answerText=''
			durationMs={197_100}
			endedAtMs={new Date('2026-09-13T16:53:00').getTime()}
			onOpenTurnFile={() => undefined}
			turnScope={{ fromRef: FROM_REF, kind: 'turn' }}
			workspaceCwd='/tmp/ws'
		/>,
	);

	await screen.findByText('AGENTS.md');
	// `3m, 17.1s` broke across two lines once the chips started wrapping, so the
	// cluster holding it is unshrinkable and each part is nowrap.
	const timing = screen.getByText('3m, 17.1s');
	expect(timing).toHaveClass('whitespace-nowrap');
	expect(timing.parentElement).toHaveClass('shrink-0');
	expect(container.querySelector('[data-role="turn-footer"]')).toHaveClass(
		'items-start',
	);
});
