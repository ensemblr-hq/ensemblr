import { describe, expect, it, vi } from 'vitest';

import {
	createAgentControlPorts,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';
import type {
	ArchitectureReadResult,
	ArchitectureService,
} from '../../src/main/architecture/index.ts';
import { ArchitectureServiceError } from '../../src/main/architecture/index.ts';
import { MAX_AGENT_PAYLOAD_CHARS } from '../../src/shared/agent-control.ts';
import type {
	ArchitectureComponent,
	ArchitectureIR,
} from '../../src/shared/architecture-diagram.ts';

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
				ir: diagram,
				relativePath: '.ensemblr/architecture.json',
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
		readDiagram,
		storeRefinedIr,
	};
}

/** The stored read a workspace with a diagram answers with. */
const stored = (ir: ArchitectureIR = diagram): ArchitectureReadResult => ({
	current: {
		generatedAt: '2026-09-04T00:00:00.000Z',
		ir,
		relativePath: '.ensemblr/architecture.json',
	},
	previous: null,
});

/**
 * Builds a component whose fields are padded to a known width, so a document can
 * be pushed past the payload budget by count rather than by a magic blob.
 * @param index - Which component this is
 * @param padding - Characters of filler on each text field
 * @returns The component
 */
const fatComponent = (
	index: number,
	padding: number,
): ArchitectureComponent => ({
	id: `c${index}`,
	label: `l${index}`.padEnd(padding, 'x'),
	sources: [
		{ path: `src/a${index}`.padEnd(padding, 'y') },
		{ path: `src/b${index}`.padEnd(padding, 'z') },
	],
	sublabel: `s${index}`.padEnd(padding, 'w'),
	type: 'backend',
});

/**
 * Builds a diagram whose serialized size is far past the payload budget.
 * @param components - How many components to draw
 * @param padding - Characters of filler on each text field
 * @returns The oversized document
 */
const oversized = (components: number, padding: number): ArchitectureIR => ({
	boundaries: [
		{
			kind: 'region',
			label: 'everything',
			wraps: Array.from({ length: components }, (_, index) => `c${index}`),
		},
	],
	cards: [{ dot: 'cyan', items: ['a'.repeat(200)], title: 'notes' }],
	components: Array.from({ length: components }, (_, index) =>
		fatComponent(index, padding),
	),
	connections: Array.from({ length: components - 1 }, (_, index) => ({
		from: `c${index}`,
		id: `e${index}`,
		label: `edge${index}`.padEnd(padding, 'e'),
		to: `c${index + 1}`,
	})),
	meta: { title: 'oversized' },
	schemaVersion: 1,
});

/**
 * Reads a diagram and asserts the read succeeded, narrowing the outcome.
 * @param port - The port under test
 * @returns The successful result
 */
async function readOk(port: ReturnType<typeof makePort>['port']) {
	const outcome = await port?.readDiagram({ origin });
	if (!outcome?.ok) {
		throw new Error(`expected a successful read, got ${outcome?.reason}`);
	}
	return outcome.result;
}

describe('architecture control port: reading', () => {
	// Nothing derives a diagram, so "there is none" is an ordinary answer the
	// agent acts on by authoring one — not a failure it should retry.
	it('answers that a workspace nobody has drawn has no diagram', async () => {
		const { port } = makePort({
			readDiagram: async () => ({ current: null, previous: null }),
		});

		const result = await readOk(port);

		expect(result.diagram).toBeNull();
		expect(result.componentCount).toBe(0);
		expect(result.connectionCount).toBe(0);
		expect(result.message).toMatch(/does not exist/);
	});

	it('names the file the diagram would live at, so the agent can find it', async () => {
		const { port } = makePort({
			readDiagram: async () => ({ current: null, previous: null }),
		});

		expect((await readOk(port)).message).toContain(
			'.ensemblr/architecture.json',
		);
	});

	// The file is tracked, so a document this build cannot parse is somebody's
	// work. Writing a replacement over it is what would make an update disappear.
	it('refuses an unreadable document instead of writing over it', async () => {
		const { port } = makePort({
			readDiagram: async () => ({
				current: null,
				error: {
					code: 'diagram-unreadable',
					message: '.ensemblr/architecture.json could not be read: bad json',
				},
				previous: null,
			}),
		});

		const outcome = await port?.readDiagram({ origin });

		expect(outcome).toMatchObject({ ok: false, reason: 'unreadable' });
		expect(outcome?.ok === false && outcome.message).toMatch(
			/could not be read/,
		);
	});

	it('answers rather than throwing when the service itself throws', async () => {
		const { port } = makePort({
			readDiagram: async () => {
				throw Object.assign(
					new Error('EACCES: permission denied, open /Users/p/x'),
					{
						code: 'EACCES',
					},
				);
			},
		});

		const outcome = await port?.readDiagram({ origin });

		expect(outcome).toMatchObject({ ok: false, reason: 'unavailable' });
		expect(outcome?.ok === false && outcome.message).not.toContain('/Users/p');
	});
});

describe('architecture control port: payload budget', () => {
	it('returns an ordinary diagram whole, with nothing said about a cut', async () => {
		const { port } = makePort({ readDiagram: async () => stored() });

		const result = await readOk(port);

		expect(result.diagram).toEqual(diagram);
		expect(result.message).not.toMatch(/shortened/);
	});

	it('fits an oversized document into the agent payload budget', async () => {
		const { port } = makePort({
			readDiagram: async () => stored(oversized(60, 900)),
		});

		const result = await readOk(port);

		expect(JSON.stringify(result.diagram).length).toBeLessThanOrEqual(
			MAX_AGENT_PAYLOAD_CHARS,
		);
	});

	// Annotation and evidence go before topology: the nodes and how they group are
	// what an agent redraws, and the paths are the fattest optional field on the
	// longest array.
	it('sheds the cards and the source paths before it touches the topology', async () => {
		const { port } = makePort({
			readDiagram: async () => stored(oversized(12, 800)),
		});

		const result = await readOk(port);
		const fitted = result.diagram as ArchitectureIR;

		expect(fitted.cards).toBeUndefined();
		expect(fitted.components.every((component) => !component.sources)).toBe(
			true,
		);
		expect(fitted.components).toHaveLength(12);
		expect(fitted.connections).toHaveLength(11);
		expect(result.message).toContain('annotation cards were dropped');
		expect(result.message).toContain('`sources` paths were dropped');
	});

	it('drops a tail of connections once shedding detail is not enough', async () => {
		const { port } = makePort({
			readDiagram: async () => stored(oversized(60, 900)),
		});

		const result = await readOk(port);
		const fitted = result.diagram as ArchitectureIR;

		expect(fitted.connections?.length ?? 0).toBeLessThan(59);
		expect(result.message).toMatch(/\d+ connection\(s\) were dropped/);
	});

	// A shortened copy submitted back would store the cut as the whole document,
	// deleting what was dropped out of a tracked file.
	it('warns against submitting a shortened copy back', async () => {
		const { port } = makePort({
			readDiagram: async () => stored(oversized(60, 900)),
		});

		const result = await readOk(port);

		expect(result.message).toContain('Do not submit this copy back');
	});

	it('counts what it returned rather than what it read', async () => {
		const { port } = makePort({
			readDiagram: async () => stored(oversized(400, 400)),
		});

		const result = await readOk(port);
		const fitted = result.diagram as ArchitectureIR;

		expect(result.componentCount).toBe(fitted.components.length);
		expect(result.connectionCount).toBe(fitted.connections?.length ?? 0);
		expect(result.componentCount).toBeLessThan(400);
		expect(result.message).toMatch(/\d+ component\(s\) were dropped/);
	});
});

describe('architecture control port: writing', () => {
	it('stores a submitted document and refreshes the open tab', async () => {
		const { broadcastArchitectureChanged, port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		const outcome = await port?.updateDiagram({ diagram, origin });

		expect(storeRefinedIr).toHaveBeenCalledWith({
			ir: expect.objectContaining({ meta: { title: 'uematsu' } }),
			workspaceId: 'ws-1',
		});
		expect(broadcastArchitectureChanged).toHaveBeenCalledWith({
			workspaceId: 'ws-1',
		});
		expect(outcome).toMatchObject({ ok: true });
		expect(outcome?.ok === true && outcome.result.componentCount).toBe(2);
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

	// Every rule the shared schema grows reaches the agent through this one
	// message, so the port passes the parser's field paths through rather than
	// flattening them into "that document is invalid".
	it('passes a schema rule the port knows nothing about through by field path', async () => {
		const { port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		const outcome = await port?.updateDiagram({
			diagram: {
				...diagram,
				components: [
					{
						...diagram.components[0],
						sources: [{ path: '../../../etc/passwd' }],
					},
					diagram.components[1],
				],
			},
			origin,
		});

		expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
		const message = outcome?.ok === false ? outcome.message : '';
		expect(message).toMatch(/components\.0\.sources\.0\.path/);
		expect(message).toMatch(/workspace-relative/);
		expect(storeRefinedIr).not.toHaveBeenCalled();
	});

	it('names the fields that failed rather than only refusing', async () => {
		const { port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		const outcome = await port?.updateDiagram({
			diagram: {
				...diagram,
				components: [{ ...diagram.components[0], type: 'not-a-type' }],
			},
			origin,
		});

		expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
		expect(outcome?.ok === false && outcome.message).toMatch(
			/components\.0\.type/,
		);
		expect(storeRefinedIr).not.toHaveBeenCalled();
	});

	it('reports the undocumented source cap by name when it is exceeded', async () => {
		const { port } = makePort({ readDiagram: async () => stored() });

		const outcome = await port?.updateDiagram({
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
		});

		expect(outcome?.ok === false && outcome.message).toMatch(
			/components\.0\.sources/,
		);
	});

	it('refuses more components than the documented cap', async () => {
		const { port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		const outcome = await port?.updateDiagram({
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
		});

		expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
		expect(outcome?.ok === false && outcome.message).toMatch(
			/too large to read/,
		);
		expect(storeRefinedIr).not.toHaveBeenCalled();
	});

	it('refuses more connections than the documented cap', async () => {
		const { port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		const outcome = await port?.updateDiagram({
			diagram: {
				...diagram,
				boundaries: [],
				connections: Array.from({ length: 161 }, (_, index) => ({
					from: 'ipc',
					id: `e${index}`,
					to: 'storage',
				})),
			},
			origin,
		});

		expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
		expect(outcome?.ok === false && outcome.message).toMatch(/160 connections/);
		expect(storeRefinedIr).not.toHaveBeenCalled();
	});

	it('refuses more boundaries than the documented cap', async () => {
		const { port, storeRefinedIr } = makePort({
			readDiagram: async () => stored(),
		});

		const outcome = await port?.updateDiagram({
			diagram: {
				...diagram,
				boundaries: Array.from({ length: 25 }, (_, index) => ({
					kind: 'region' as const,
					label: `b${index}`,
					wraps: ['storage'],
				})),
			},
			origin,
		});

		expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
		expect(outcome?.ok === false && outcome.message).toMatch(/24 boundaries/);
		expect(storeRefinedIr).not.toHaveBeenCalled();
	});

	// A read-only mount is not the caller's mistake, and the error text names the
	// absolute path of the user's checkout — neither belongs in an agent's context
	// behind an instruction to fix the fields and resubmit.
	it('reports a failed write without blaming the document or leaking the path', async () => {
		const { port } = makePort({
			readDiagram: async () => stored(),
			storeRefinedIr: async () => {
				throw Object.assign(
					new Error(
						"EACCES: permission denied, open '/Users/p/ws/.ensemblr/architecture.json'",
					),
					{ code: 'EACCES' },
				);
			},
		});

		const outcome = await port?.updateDiagram({ diagram, origin });

		expect(outcome).toMatchObject({ ok: false, reason: 'store-failed' });
		const message = outcome?.ok === false ? outcome.message : '';
		expect(message).toContain('EACCES');
		expect(message).not.toContain('/Users/p');
		expect(message).toMatch(/valid and nothing is wrong with it/);
	});

	// `store-failed` says "your document was fine, the directory refused it, do
	// not retry". Answering a conflicted file with that sends the agent to report
	// a full disk instead of the conflict markers in the user's working tree.
	it('names the stored document rather than the write when the service refuses to start one', async () => {
		const { port } = makePort({
			readDiagram: async () => stored(),
			storeRefinedIr: async () => {
				throw new ArchitectureServiceError({
					code: 'diagram-unreadable',
					message:
						'.ensemblr/architecture.json could not be read: Unexpected token <',
				});
			},
		});

		const outcome = await port?.updateDiagram({ diagram, origin });

		expect(outcome).toMatchObject({ ok: false, reason: 'unreadable' });
		const message = outcome?.ok === false ? outcome.message : '';
		expect(message).toMatch(/Repair or delete that file/);
		expect(message).not.toMatch(/valid and nothing is wrong with it/);
	});

	it('reports a workspace that has gone as unavailable rather than a failed write', async () => {
		const { port } = makePort({
			readDiagram: async () => stored(),
			storeRefinedIr: async () => {
				throw new ArchitectureServiceError({
					code: 'workspace-missing',
					message: 'Workspace ws-1 is no longer on disk at /Users/p/ws.',
				});
			},
		});

		const outcome = await port?.updateDiagram({ diagram, origin });

		expect(outcome).toMatchObject({ ok: false, reason: 'unavailable' });
		expect(outcome?.ok === false && outcome.message).not.toContain('/Users/p');
	});
});
