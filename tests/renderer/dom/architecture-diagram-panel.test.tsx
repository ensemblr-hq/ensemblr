// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchitectureDiagramPanel } from '@/renderer/components/workbench-shell/conversation-panel/architecture-diagram';
import { FilePreviewOpenerProvider } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import type { ArchitectureIR } from '@/shared/architecture-diagram';
import type { ArchitectureDiagramWire } from '@/shared/ipc/contracts/architecture';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

const ir = (patch: Partial<ArchitectureIR> = {}): ArchitectureIR => ({
	boundaries: [{ kind: 'region', label: 'Main process', wraps: ['storage'] }],
	components: [
		{
			col: 0,
			id: 'storage',
			label: 'storage',
			row: 0,
			sources: [{ path: 'src/main/storage' }],
			sublabel: 'src/main',
			type: 'database',
		},
		{
			col: 1,
			id: 'ipc',
			label: 'ipc',
			row: 0,
			sublabel: 'src/main',
			type: 'messagebus',
		},
	],
	connections: [{ from: 'ipc', id: 'e-1', to: 'storage' }],
	layout: { cols: 4, mode: 'grid' },
	meta: { title: 'uematsu' },
	schemaVersion: 1,
	...patch,
});

const snapshot = (
	patch: Partial<ArchitectureDiagramWire> = {},
): ArchitectureDiagramWire => ({
	generatedAt: new Date(Date.now() - 60_000).toISOString(),
	graphFingerprint: 'abc',
	ir: ir(),
	relativePath: '.ensemblr/architecture.json',
	source: 'scan',
	...patch,
});

const revealDirectory = vi.fn();

const installBridge = (result: unknown) => {
	const scanArchitectureSnapshot = vi.fn(async () => result);
	installEnsemblrApi({
		getArchitectureSnapshot: vi.fn(async () => result),
		onArchitectureSnapshotChanged: vi.fn(() => () => undefined),
		scanArchitectureSnapshot,
	});
	return { scanArchitectureSnapshot };
};

afterEach(() => {
	clearEnsemblrApi();
	revealDirectory.mockClear();
});

describe('ArchitectureDiagramPanel', () => {
	it('renders a stored snapshot as nodes and boundaries', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		expect(
			await screen.findByRole('img', {
				name: /Architecture diagram of uematsu/,
			}),
		).toBeInTheDocument();
		// A node with a source is interactive whatever the file-preview context:
		// a directory reveal is always available, so the click has somewhere to go.
		expect(
			screen.getByRole('button', { name: /storage — src\/main/ }),
		).toBeInTheDocument();
		expect(screen.getByText('Main process')).toBeInTheDocument();
	});

	// A workspace created before the seed scan moved onto the creation path
	// arrives here with nothing stored. There is no button to offer — the scan is
	// not a thing the user runs — so the panel asks for the seed itself.
	it('seeds a workspace that arrives with no diagram', async () => {
		const { scanArchitectureSnapshot } = installBridge({
			current: null,
			previous: null,
		});
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		await waitFor(() => {
			expect(scanArchitectureSnapshot).toHaveBeenCalledWith({
				workspaceId: 'ws-1',
			});
		});
	});

	it('attempts the seed once, so a repository with no modules cannot loop', async () => {
		const { scanArchitectureSnapshot } = installBridge({
			current: null,
			previous: null,
		});
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		await waitFor(() => {
			expect(scanArchitectureSnapshot).toHaveBeenCalledTimes(1);
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(scanArchitectureSnapshot).toHaveBeenCalledTimes(1);
	});

	it('does not scan when the read already failed', async () => {
		const { scanArchitectureSnapshot } = installBridge({
			current: null,
			error: { code: 'workspace-missing', message: 'gone' },
			previous: null,
		});
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		// `workspace-missing` is one of the codes `failure-text` authors, so the
		// panel shows the translated headline rather than main's own message.
		await screen.findByText('That workspace no longer exists.');
		expect(scanArchitectureSnapshot).not.toHaveBeenCalled();
	});

	// A stored document this build cannot parse is somebody's work, so the panel
	// says so and stops. Scanning a replacement over it is what used to make a
	// refinement disappear without a word.
	it('reports an unreadable stored diagram instead of scanning over it', async () => {
		const { scanArchitectureSnapshot } = installBridge({
			current: null,
			error: {
				code: 'diagram-unreadable',
				message: '.ensemblr/architecture.json could not be read',
			},
			previous: null,
		});
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		await screen.findByText(
			'The stored architecture diagram cannot be read. Repair or delete the file, and a new one will be drawn.',
		);
		expect(scanArchitectureSnapshot).not.toHaveBeenCalled();
	});

	// A node stands for a directory, and the file preview answers "is a directory
	// and cannot be previewed" for one — so a click reveals it in the file tree.
	it('reveals a node’s directory in the file tree when it is clicked', async () => {
		installBridge({ current: snapshot(), previous: null });
		const openFilePreview = vi.fn();
		renderWithProviders(
			<FilePreviewOpenerProvider value={openFilePreview}>
				<ArchitectureDiagramPanel
					onDirectoryReveal={revealDirectory}
					workspaceId='ws-1'
				/>
			</FilePreviewOpenerProvider>,
		);

		await userEvent.click(
			await screen.findByRole('button', { name: /storage — src\/main/ }),
		);
		expect(revealDirectory).toHaveBeenCalledWith('src/main/storage');
		expect(openFilePreview).not.toHaveBeenCalled();
	});

	it('opens a node’s source in the file preview when it names a file', async () => {
		installBridge({
			current: snapshot({
				ir: ir({
					components: [
						{
							col: 0,
							id: 'storage',
							label: 'database.ts',
							row: 0,
							sources: [{ path: 'src/main/storage/database.ts' }],
							sublabel: 'src/main/storage',
							type: 'database',
						},
					],
					connections: [],
					boundaries: [],
				}),
			}),
			previous: null,
		});
		const openFilePreview = vi.fn();
		renderWithProviders(
			<FilePreviewOpenerProvider value={openFilePreview}>
				<ArchitectureDiagramPanel
					onDirectoryReveal={revealDirectory}
					workspaceId='ws-1'
				/>
			</FilePreviewOpenerProvider>,
		);

		await userEvent.click(
			await screen.findByRole('button', { name: /database\.ts/ }),
		);
		expect(openFilePreview).toHaveBeenCalledWith(
			'src/main/storage/database.ts',
		);
		expect(revealDirectory).not.toHaveBeenCalled();
	});

	it('leaves a node with no source non-interactive', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		expect(
			await screen.findByRole('img', { name: /^ipc — src\/main$/ }),
		).toBeInTheDocument();
	});

	// The scan is not a thing the user runs: the seed happens once at creation
	// and everything after it is an agent's refinement, so a control that re-ran
	// the scanner would overwrite that work on a click.
	it('offers no rescan control', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		await screen.findByRole('img', { name: /Architecture diagram/ });
		expect(
			screen.queryByRole('button', { name: /Rescan/i }),
		).not.toBeInTheDocument();
	});

	it('rings a node the last write added', async () => {
		const previous = ir({
			boundaries: [],
			components: [ir().components[0] as never],
			connections: [],
		});
		installBridge({ current: snapshot(), previous });
		const { container } = renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		await screen.findByRole('img', { name: /Architecture diagram/ });
		expect(container.querySelector('.stroke-emerald-500')).not.toBeNull();
	});
});
