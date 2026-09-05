import { describe, expect, it } from 'vitest';
import {
	classifyManagedChild,
	MANAGED_CHILD_DEPTH,
} from '@/shared/managed-path';

const ROOT = '/Users/dev/Ensemblr/repos';

describe('classifyManagedChild', () => {
	it('admits a direct child of the managed root', () => {
		expect(
			classifyManagedChild({
				candidatePath: `${ROOT}/ensemblr`,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: ROOT,
			}),
		).toBe('ok');
	});

	it('admits a deeper child when that is the depth asked for', () => {
		expect(
			classifyManagedChild({
				candidatePath: '/Users/dev/Ensemblr/workspaces/ensemblr/ives',
				expectedDepth: 2,
				root: '/Users/dev/Ensemblr/workspaces',
			}),
		).toBe('ok');
	});

	it('tolerates a trailing separator on the root', () => {
		expect(
			classifyManagedChild({
				candidatePath: `${ROOT}/ensemblr`,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: `${ROOT}//`,
			}),
		).toBe('ok');
	});

	it('reports the root itself as outside', () => {
		expect(
			classifyManagedChild({
				candidatePath: ROOT,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: ROOT,
			}),
		).toBe('outside');
	});

	it('reports a sibling of the root as outside', () => {
		expect(
			classifyManagedChild({
				candidatePath: '/Users/dev/Ensemblr/repos-elsewhere/ensemblr',
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: ROOT,
			}),
		).toBe('outside');
	});

	it('reports a path that climbs out as outside rather than walking it', () => {
		expect(
			classifyManagedChild({
				candidatePath: `${ROOT}/../secrets`,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: ROOT,
			}),
		).toBe('outside');
	});

	it('refuses an unresolved doubled separator rather than normalizing it', () => {
		expect(
			classifyManagedChild({
				candidatePath: `${ROOT}//ensemblr`,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: ROOT,
			}),
		).toBe('outside');
	});

	it('admits nothing when the root is empty', () => {
		expect(
			classifyManagedChild({
				candidatePath: `${ROOT}/ensemblr`,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: '',
			}),
		).toBe('outside');
	});

	it('separates a grandchild from a child by depth, not containment', () => {
		expect(
			classifyManagedChild({
				candidatePath: `${ROOT}/ensemblr/src`,
				expectedDepth: MANAGED_CHILD_DEPTH,
				root: ROOT,
			}),
		).toBe('wrong-depth');
	});
});
