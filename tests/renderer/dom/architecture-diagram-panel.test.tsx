// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
			await screen.findByRole('application', {
				name: /Architecture diagram of uematsu/,
			}),
		).toBeInTheDocument();
		// Every node is selectable, which is what the body click now does; a node
		// with a source carries a second control that leaves the diagram.
		expect(
			screen.getByRole('button', {
				name: /storage — src\/main — show what it connects to/,
			}),
		).toBeInTheDocument();
		expect(screen.getByText('Main process')).toBeInTheDocument();
	});

	it('draws a grid document’s boundary as a rectangle', async () => {
		installBridge({ current: snapshot(), previous: null });
		const { container } = renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		await screen.findByText('Main process');
		expect(
			container.querySelectorAll('svg rect[stroke-dasharray]'),
		).not.toHaveLength(0);
	});

	it('draws an organic document’s boundary as a closed curve', async () => {
		installBridge({
			current: snapshot({
				ir: ir({
					boundaries: [
						{
							kind: 'region',
							label: 'Main process',
							wraps: ['storage', 'ipc'],
						},
					],
					components: [
						{
							id: 'storage',
							label: 'storage',
							sublabel: 'src/main',
							type: 'database',
						},
						{
							id: 'ipc',
							label: 'ipc',
							sublabel: 'src/main',
							type: 'messagebus',
						},
					],
					layout: { mode: 'organic' },
				}),
			}),
			previous: null,
		});
		const { container } = renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		await screen.findByText('Main process');
		const outline = container.querySelector('svg path[stroke-dasharray]');
		expect(outline?.getAttribute('d')).toMatch(/^M .* Z$/);
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
		// A slow retry loop is still a retry loop: advance far past anything a
		// re-render or a refetch interval could schedule.
		vi.useFakeTimers();
		try {
			await act(async () => {
				await vi.advanceTimersByTimeAsync(5 * 60_000);
			});
		} finally {
			vi.useRealTimers();
		}
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
	// and cannot be previewed" for one — so the open control reveals it in the
	// file tree instead.
	it('reveals a node’s directory from its open control', async () => {
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
			await screen.findByRole('button', { name: 'Open src/main/storage' }),
		);
		expect(revealDirectory).toHaveBeenCalledWith('src/main/storage');
		expect(openFilePreview).not.toHaveBeenCalled();
	});

	// The whole point of the body click: a diagram of fifty boxes is unreadable
	// until one of them can say what it talks to, so selecting dims the rest.
	it('dims everything outside a selected node’s neighbourhood', async () => {
		installBridge({
			current: snapshot({
				ir: ir({
					boundaries: [],
					components: [
						...ir().components,
						{
							col: 2,
							id: 'unrelated',
							label: 'unrelated',
							row: 0,
							sublabel: 'src/other',
							type: 'frontend',
						},
					],
				}),
			}),
			previous: null,
		});
		const { container } = renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		expect(container.querySelectorAll('[data-dimmed="true"]')).toHaveLength(0);
		await userEvent.click(
			await screen.findByRole('button', {
				name: /storage — src\/main — show what it connects to/,
			}),
		);

		expect(
			container.querySelectorAll('[data-dimmed="true"]').length,
		).toBeGreaterThan(0);
		expect(revealDirectory).not.toHaveBeenCalled();
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
			await screen.findByRole('button', {
				name: 'Open src/main/storage/database.ts',
			}),
		);
		expect(openFilePreview).toHaveBeenCalledWith(
			'src/main/storage/database.ts',
		);
		expect(revealDirectory).not.toHaveBeenCalled();
	});

	it('gives a node with no source no open control', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		expect(
			await screen.findByRole('button', {
				name: /^ipc — src\/main — show what it connects to$/,
			}),
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /^Open src\/main$/ }),
		).not.toBeInTheDocument();
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

		await screen.findByRole('application', { name: /Architecture diagram/ });
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

		await screen.findByRole('application', { name: /Architecture diagram/ });
		expect(
			container.querySelector('[data-node-id][data-delta="added"]'),
		).not.toBeNull();
	});

	// Every node carrying its own tab stop meant a two-hundred-node diagram took
	// four hundred Tab presses to cross. One node holds the stop; N and P move it.
	it('gives the node group a single tab stop', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		const storage = await screen.findByRole('button', {
			name: /storage — src\/main — show what it connects to/,
		});
		const ipc = screen.getByRole('button', {
			name: /^ipc — src\/main — show what it connects to$/,
		});
		expect(storage).toHaveAttribute('tabindex', '0');
		expect(ipc).toHaveAttribute('tabindex', '-1');
	});

	it('steps the tab stop between nodes on N and P', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		const canvas = await screen.findByRole('application', {
			name: /Architecture diagram of uematsu/,
		});
		const ipc = screen.getByRole('button', {
			name: /^ipc — src\/main — show what it connects to$/,
		});
		canvas.focus();
		await userEvent.keyboard('{n}');

		expect(ipc).toHaveAttribute('tabindex', '0');
		expect(
			screen.getByRole('button', {
				name: /storage — src\/main — show what it connects to/,
			}),
		).toHaveAttribute('tabindex', '-1');

		await userEvent.keyboard('{p}');
		expect(
			screen.getByRole('button', {
				name: /storage — src\/main — show what it connects to/,
			}),
		).toHaveAttribute('tabindex', '0');
	});

	// The svg is the pan surface and the first keyboard stop, so it has to say so
	// when it takes focus rather than starting to pan against a blank screen.
	it('shows a focus ring on the canvas itself', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		const canvas = await screen.findByRole('application', {
			name: /Architecture diagram of uematsu/,
		});
		expect(canvas).toHaveAttribute('tabindex', '0');
		expect(canvas.getAttribute('class')).toContain(
			'focus-visible:outline-ring',
		);
	});

	// The gestures were the only thing the description named, so arrow-key
	// panning, fit, zoom, stepping, and Escape were all undiscoverable.
	it('names every key the canvas answers to', async () => {
		installBridge({ current: snapshot(), previous: null });
		const { container } = renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		const canvas = await screen.findByRole('application', {
			name: /Architecture diagram of uematsu/,
		});
		const hintId = canvas.getAttribute('aria-describedby');
		const hint = container.querySelector(`#${hintId}`)?.textContent ?? '';
		expect(hint).toContain('arrow keys');
		expect(hint).toContain('0');
		expect(hint).toContain('N and P');
		expect(hint).toContain('Escape');
	});

	// Panning the background ends in a click on it. Clearing the selection there
	// would undo the very thing the drag was serving.
	it('keeps the selection when a background click ends a drag', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		const storage = await screen.findByRole('button', {
			name: /storage — src\/main — show what it connects to/,
		});
		await userEvent.click(storage);
		expect(storage).toHaveAttribute('aria-pressed', 'true');

		const canvas = screen.getByRole('application', {
			name: /Architecture diagram of uematsu/,
		});
		fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10 });
		fireEvent.click(canvas, { clientX: 90, clientY: 60 });

		expect(storage).toHaveAttribute('aria-pressed', 'true');
	});

	it('clears the selection when the background is clicked without a drag', async () => {
		installBridge({ current: snapshot(), previous: null });
		renderWithProviders(
			<ArchitectureDiagramPanel
				onDirectoryReveal={revealDirectory}
				workspaceId='ws-1'
			/>,
		);

		const storage = await screen.findByRole('button', {
			name: /storage — src\/main — show what it connects to/,
		});
		await userEvent.click(storage);
		const canvas = screen.getByRole('application', {
			name: /Architecture diagram of uematsu/,
		});
		fireEvent.pointerDown(canvas, { button: 0, clientX: 40, clientY: 40 });
		fireEvent.click(canvas, { clientX: 41, clientY: 40 });

		expect(storage).toHaveAttribute('aria-pressed', 'false');
	});

	// `Dockerfile` has no extension, and the old classifier read it as a folder —
	// which handed it to a directory reveal that could match nothing.
	it('opens an extensionless file in the preview rather than revealing it', async () => {
		installBridge({
			current: snapshot({
				ir: ir({
					boundaries: [],
					components: [
						{
							col: 0,
							id: 'image',
							label: 'Dockerfile',
							row: 0,
							sources: [{ path: 'Dockerfile' }],
							type: 'cloud',
						},
					],
					connections: [],
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
			await screen.findByRole('button', { name: 'Open Dockerfile' }),
		);
		expect(openFilePreview).toHaveBeenCalledWith('Dockerfile');
		expect(revealDirectory).not.toHaveBeenCalled();
	});
});
