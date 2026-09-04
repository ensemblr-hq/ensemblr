import { describe, expect, it } from 'vitest';

import { parseArchitectureIr } from '../../src/shared/architecture-diagram';

const minimal = () => ({
	components: [{ id: 'alpha', label: 'Alpha', type: 'backend' }],
	meta: { title: 'fixture' },
	schemaVersion: 1,
});

describe('parseArchitectureIr', () => {
	it('rejects a document with no title', () => {
		expect(parseArchitectureIr({ ...minimal(), meta: {} })).toBeNull();
	});

	it('rejects a component whose id is not identifier-like', () => {
		expect(
			parseArchitectureIr({
				...minimal(),
				components: [{ id: '9-lives', label: 'Alpha', type: 'backend' }],
			}),
		).toBeNull();
	});

	it('rejects a component type outside the legend', () => {
		expect(
			parseArchitectureIr({
				...minimal(),
				components: [{ id: 'alpha', label: 'Alpha', type: 'quantum' }],
			}),
		).toBeNull();
	});

	it('accepts an archify document and drops the fields this app has no use for', () => {
		const parsed = parseArchitectureIr({
			...minimal(),
			meta: {
				quality_profile: 'showcase',
				title: 'fixture',
				views: [{ id: 'a', label: 'A' }],
			},
			components: [
				{ brand: 'aws', id: 'alpha', label: 'Alpha', type: 'backend' },
			],
		});
		expect(parsed?.meta).toEqual({ title: 'fixture' });
		expect(parsed?.components[0]).toEqual({
			id: 'alpha',
			label: 'Alpha',
			type: 'backend',
		});
	});

	it('reads archify’s snake_case schema_version and source end_line', () => {
		const parsed = parseArchitectureIr({
			components: [
				{
					id: 'alpha',
					label: 'Alpha',
					sources: [{ end_line: 40, line: 10, path: 'src/alpha.ts' }],
					type: 'backend',
				},
			],
			meta: { title: 'fixture' },
			schema_version: 1,
		});
		expect(parsed?.schemaVersion).toBe(1);
		expect(parsed?.components[0]?.sources?.[0]).toEqual({
			endLine: 40,
			line: 10,
			path: 'src/alpha.ts',
		});
	});

	it('derives an id for a connection that carries none, stably from its endpoints', () => {
		const document = {
			...minimal(),
			components: [
				{ id: 'alpha', label: 'Alpha', type: 'backend' },
				{ id: 'beta', label: 'Beta', type: 'backend' },
			],
			connections: [{ from: 'alpha', to: 'beta' }],
		};
		expect(parseArchitectureIr(document)?.connections?.[0]?.id).toBe(
			'alpha-to-beta',
		);
		expect(
			parseArchitectureIr({
				...document,
				connections: [
					{ from: 'alpha', to: 'beta' },
					{ from: 'alpha', to: 'beta' },
				],
			})?.connections?.map((connection) => connection.id),
		).toEqual(['alpha-to-beta', 'alpha-to-beta-2']);
	});

	it('keeps an authored connection id rather than deriving over it', () => {
		expect(
			parseArchitectureIr({
				...minimal(),
				components: [
					{ id: 'alpha', label: 'Alpha', type: 'backend' },
					{ id: 'beta', label: 'Beta', type: 'backend' },
				],
				connections: [{ from: 'alpha', id: 'authored', to: 'beta' }],
			})?.connections?.[0]?.id,
		).toBe('authored');
	});
});
