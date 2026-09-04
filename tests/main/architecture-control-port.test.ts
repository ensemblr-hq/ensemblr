import { describe, expect, it, vi } from 'vitest';

import {
	createAgentControlPorts,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';
import type {
	ArchitectureReadResult,
	ArchitectureScanOutcome,
	ArchitectureService,
} from '../../src/main/architecture/index.ts';
import type { ArchitectureIR } from '../../src/shared/architecture-diagram.ts';

const origin = { workspaceId: 'ws-1' } as never;

const diagram: ArchitectureIR = {
	boundaries: [{ kind: 'region', label: 'Main process', wraps: ['storage'] }],
	components: [
		{
			col: 0,
			id: 'storage',
			label: 'storage',
			row: 0,
			sources: [{ path: 'src/main/storage' }],
			type: 'database',
		},
		{ col: 1, id: 'ipc', label: 'ipc', row: 0, type: 'messagebus' },
	],
	connections: [{ from: 'ipc', id: 'e-1', to: 'storage' }],
	meta: { title: 'uematsu' },
	schemaVersion: 1,
};

/**
 * Builds the architecture port over a stubbed service.
 * @param service - Partial service behaviour under test
 * @returns The port and the spies behind it
 */
function makePort(service: Partial<ArchitectureService>) {
	const storeRefinedIr = vi.fn(
		service.storeRefinedIr ??
			(async () => ({
				generatedAt: '',
				graphFingerprint: '',
				ir: diagram,
				relativePath: '.ensemblr/architecture.json',
				source: 'agent' as const,
			})),
	);
	const scanIfMissing = vi.fn(
		service.scanIfMissing ??
			(async (): Promise<ArchitectureScanOutcome> => ({
				reason: 'already-stored',
				rebuilt: false,
			})),
	);
	const readDiagram = vi.fn(
		service.readDiagram ??
			(async (): Promise<ArchitectureReadResult> => ({
				current: null,
				previous: null,
			})),
	);
	const broadcastArchitectureChanged = vi.fn();
	const architectureService = {
		readDiagram,
		scanIfMissing,
		storeRefinedIr,
	} as unknown as ArchitectureService;
	const ports = createAgentControlPorts({
		architectureService,
		broadcastArchitectureChanged,
		databaseService: { getConnection: () => ({ database: {} }) },
		chatTabService: {},
		agentSessionService: {},
		terminalService: {},
		scriptLifecycleService: {},
		harnessDetectionService: {},
		piExecutableService: {},
		getPermissionMode: () => 'workspace-trusted',
		broadcastFocus: vi.fn(),
		broadcastTabsChanged: vi.fn(),
		broadcastBoardStatus: vi.fn(),
		broadcastPlanMode: vi.fn(),
		ask: { ask: vi.fn(), releaseSession: vi.fn() },
		confirm: { confirm: vi.fn() },
	} as unknown as PortAdapterDeps);
	return {
		broadcastArchitectureChanged,
		port: ports.architecture,
		scanIfMissing,
		storeRefinedIr,
	};
}

/** The stored read a workspace with a diagram answers with. */
const stored = (): ArchitectureReadResult => ({
	current: {
		generatedAt: '2026-09-04T00:00:00.000Z',
		graphFingerprint: 'abc',
		ir: diagram,
		relativePath: '.ensemblr/architecture.json',
		source: 'scan',
	},
	previous: null,
});

describe('architecture control port: reading', () => {
	it('seeds a workspace that has none rather than reporting one missing', async () => {
		const { port, scanIfMissing } = makePort({
			readDiagram: async () => ({ current: null, previous: null }),
			scanIfMissing: async () => ({
				diagram: stored().current as never,
				rebuilt: true,
			}),
		});

		const result = await port?.readDiagram({ origin });

		expect(scanIfMissing).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
		expect(result?.source).toBe('scan');
		expect(result?.componentCount).toBe(2);
	});

	// The file is tracked, so a document this build cannot parse is somebody's
	// work. Scanning a replacement over it is what used to make a refinement
	// disappear with the read still answering `source: "scan"`.
	it('refuses an unreadable document instead of scanning over it', async () => {
		const { port, scanIfMissing } = makePort({
			readDiagram: async () => ({
				current: null,
				error: {
					code: 'diagram-unreadable',
					message: '.ensemblr/architecture.json could not be read: bad json',
				},
				previous: null,
			}),
		});

		await expect(port?.readDiagram({ origin })).rejects.toThrow(
			/could not be read/,
		);
		expect(scanIfMissing).not.toHaveBeenCalled();
	});
});

describe('architecture control port: writing', () => {
	it('stores a submitted document and refreshes the open tab', async () => {
		const { broadcastArchitectureChanged, port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		const result = await port?.updateDiagram({ diagram, origin });

		expect(storeRefinedIr).toHaveBeenCalledWith({
			ir: expect.objectContaining({ meta: { title: 'uematsu' } }),
			workspaceId: 'ws-1',
		});
		expect(broadcastArchitectureChanged).toHaveBeenCalledWith({
			workspaceId: 'ws-1',
		});
		expect(result?.componentCount).toBe(2);
	});

	// A bridge that could not see the argument's shape sends the whole document
	// as JSON text. The content is right, so blaming the model for the encoding
	// sends it rewriting a document that was never the problem.
	it('accepts a document submitted as a JSON string', async () => {
		const { port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		await port?.updateDiagram({ diagram: JSON.stringify(diagram), origin });

		expect(storeRefinedIr).toHaveBeenCalledWith({
			ir: expect.objectContaining({ meta: { title: 'uematsu' } }),
			workspaceId: 'ws-1',
		});
	});

	it('names the fields that failed rather than only refusing', async () => {
		const { port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		await expect(
			port?.updateDiagram({
				diagram: {
					...diagram,
					components: [{ ...diagram.components[0], type: 'not-a-type' }],
				},
				origin,
			}),
		).rejects.toThrow(/components\.0\.type/);
		expect(storeRefinedIr).not.toHaveBeenCalled();
	});

	it('reports the undocumented source cap by name when it is exceeded', async () => {
		const { port } = makePort({ readDiagram: async () => stored() });

		await expect(
			port?.updateDiagram({
				diagram: {
					...diagram,
					components: [
						{
							...diagram.components[0],
							sources: [
								{ path: 'a' },
								{ path: 'b' },
								{ path: 'c' },
								{ path: 'd' },
							],
						},
					],
				},
				origin,
			}),
		).rejects.toThrow(/components\.0\.sources/);
	});

	it('refuses a document too large to read', async () => {
		const { port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		await expect(
			port?.updateDiagram({
				diagram: {
					...diagram,
					boundaries: [],
					components: Array.from({ length: 65 }, (_, index) => ({
						col: index % 4,
						id: `c${index}`,
						label: `c${index}`,
						row: Math.floor(index / 4),
						type: 'backend' as const,
					})),
					connections: [],
				},
				origin,
			}),
		).rejects.toThrow(/too large to read/);
		expect(storeRefinedIr).not.toHaveBeenCalled();
	});
});
