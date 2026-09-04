import { describe, expect, it } from 'vitest';

import type {
	ArchitectureComponent,
	ArchitectureIR,
} from '../../src/shared/architecture-diagram';
import {
	diffArchitectureIr,
	toDeltaStatusMap,
} from '../../src/shared/architecture-diagram';

const alpha: ArchitectureComponent = {
	col: 0,
	id: 'alpha',
	label: 'Alpha',
	row: 0,
	type: 'backend',
};
const beta: ArchitectureComponent = {
	col: 1,
	id: 'beta',
	label: 'Beta',
	row: 0,
	type: 'backend',
};
const gamma: ArchitectureComponent = {
	col: 2,
	id: 'gamma',
	label: 'Gamma',
	row: 0,
	type: 'backend',
};

const base = (): ArchitectureIR => ({
	boundaries: [{ kind: 'region', label: 'Core', wraps: ['alpha'] }],
	components: [alpha, beta],
	connections: [{ from: 'alpha', id: 'e-1', to: 'beta' }],
	meta: { title: 'fixture' },
	schemaVersion: 1,
});

const statusOf = (
	entries: ReturnType<typeof diffArchitectureIr>['components'],
	id: string,
) => toDeltaStatusMap(entries).get(id) ?? null;

describe('diffArchitectureIr', () => {
	it('reports nothing against a workspace that has no previous snapshot', () => {
		expect(diffArchitectureIr(null, base())).toEqual({
			boundaries: [],
			components: [],
			connections: [],
		});
	});

	it('reports nothing for two identical snapshots', () => {
		const delta = diffArchitectureIr(base(), base());
		expect(delta.components).toEqual([]);
		expect(delta.connections).toEqual([]);
		expect(delta.boundaries).toEqual([]);
	});

	it('calls a re-layout moved rather than changed', () => {
		const after = base();
		const delta = diffArchitectureIr(base(), {
			...after,
			components: [{ ...alpha, row: 3 }, beta],
		});
		expect(statusOf(delta.components, 'alpha')).toBe('moved');
	});

	it('calls a renamed node changed', () => {
		const after = base();
		const delta = diffArchitectureIr(base(), {
			...after,
			components: [{ ...alpha, label: 'Renamed' }, beta],
		});
		expect(statusOf(delta.components, 'alpha')).toBe('changed');
	});

	it('separates evidence changes from semantic ones', () => {
		const after = base();
		const delta = diffArchitectureIr(base(), {
			...after,
			components: [{ ...alpha, sources: [{ path: 'src/alpha.ts' }] }, beta],
		});
		expect(statusOf(delta.components, 'alpha')).toBe('evidence-changed');
	});

	it('reports an added and a removed node', () => {
		const after = base();
		const delta = diffArchitectureIr(base(), {
			...after,
			components: [alpha, gamma],
		});
		expect(statusOf(delta.components, 'beta')).toBe('removed');
		expect(statusOf(delta.components, 'gamma')).toBe('added');
	});

	it('calls a re-sided edge rerouted and a re-targeted one changed', () => {
		const after = base();
		expect(
			statusOf(
				diffArchitectureIr(base(), {
					...after,
					connections: [
						{ from: 'alpha', fromSide: 'top', id: 'e-1', to: 'beta' },
					],
				}).connections,
				'e-1',
			),
		).toBe('rerouted');
		expect(
			statusOf(
				diffArchitectureIr(base(), {
					...after,
					components: [alpha, beta, gamma],
					connections: [{ from: 'alpha', id: 'e-1', to: 'gamma' }],
				}).connections,
				'e-1',
			),
		).toBe('changed');
	});

	it('matches boundaries on kind and label, and reports a scope change', () => {
		const after = base();
		const delta = diffArchitectureIr(base(), {
			...after,
			boundaries: [{ kind: 'region', label: 'Core', wraps: ['alpha', 'beta'] }],
		});
		expect(statusOf(delta.boundaries, 'region:Core')).toBe('changed');
	});
});
