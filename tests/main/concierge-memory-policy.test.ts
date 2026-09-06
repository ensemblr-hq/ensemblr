import { describe, expect, it } from 'vitest';

import { MEMORY_PASS_PROMPT } from '../../src/main/concierge/concierge-memory-pass.ts';
import { parseMemoryFile } from '../../src/main/concierge/concierge-memory-service.ts';
import {
	CONCIERGE_MEMORY_KINDS,
	coerceConciergeMemoryKind,
} from '../../src/main/storage/repositories/concierge-memory-repository.ts';
import { conciergeAwareness } from '../../src/shared/agent-control.ts';

/** The Concierge playbook with every optional feature on, which these assertions describe. */
const CONCIERGE_AWARENESS = conciergeAwareness({
	architectureDiagram: true,
	tuiHarnesses: true,
});

/** The four frontmatter fields the reader recognises, as the playbook names them. */
const DOCUMENTED_FIELDS = ['description', 'kind', 'name', 'projects'] as const;

// The Concierge writes these files by hand from the playbook, so a field the
// playbook does not name is a field it will not write, and a field it names that
// the reader does not parse indexes as nothing. Both failures are silent: the
// memory lands on disk, is indexed under the wrong kind, and nobody finds out
// until a recall comes back missing it.
describe('the memory frontmatter the playbook teaches', () => {
	it('reads every field the playbook names', () => {
		const parsed = parseMemoryFile(
			[
				'---',
				'name: A short title',
				'description: One line of summary',
				'kind: decision',
				'projects: [ensemblr-dev, playground-repo]',
				'---',
				'',
				'The body.',
			].join('\n'),
		);

		expect(parsed.frontmatter).toEqual({
			description: 'One line of summary',
			kind: 'decision',
			name: 'A short title',
			projects: ['ensemblr-dev', 'playground-repo'],
		});
		expect(parsed.body).toBe('The body.');
	});

	it('names each of those fields in the playbook', () => {
		for (const field of DOCUMENTED_FIELDS) {
			expect(CONCIERGE_AWARENESS, field).toContain(`\`${field}\``);
		}
	});

	it('offers every kind the index recognises, and no others', () => {
		const offered = CONCIERGE_MEMORY_KINDS.filter((kind) =>
			CONCIERGE_AWARENESS.includes(`\`${kind}\``),
		);
		expect(offered).toEqual([...CONCIERGE_MEMORY_KINDS]);
	});

	// The shape the dev Concierge actually wrote before the playbook spelled the
	// contract out. It parses without complaint and loses both the kind and the
	// project filing, which is why the playbook now says so in as many words.
	it('ignores a nested metadata block, as the playbook warns', () => {
		const parsed = parseMemoryFile(
			[
				'---',
				'name: some-memory',
				'description: A one-line summary',
				'metadata:',
				'  type: project',
				'---',
				'',
				'The body.',
			].join('\n'),
		);

		expect(parsed.frontmatter.kind).toBeUndefined();
		expect(parsed.frontmatter.projects).toBeUndefined();
		expect(coerceConciergeMemoryKind(parsed.frontmatter.kind)).toBe('note');
		expect(CONCIERGE_AWARENESS).toContain('`metadata`');
	});
});

// The catalogue filled with rosters, ids, branch lists, and file layouts before
// the playbook drew this line, because "record anything you would otherwise have
// to rediscover" reads as "record everything" to a model that can rediscover
// nothing once its context is gone.
describe('the filter the playbook puts in front of every memory', () => {
	it('states the test as a question about retrieval, not usefulness', () => {
		expect(CONCIERGE_AWARENESS).toContain('could I get this back?');
	});

	it('rules out each source a memory could have been read back from', () => {
		for (const source of ['`ensemblr_*` op returns', 'git or `gh` answers']) {
			expect(CONCIERGE_AWARENESS, source).toContain(source);
		}
		expect(CONCIERGE_AWARENESS).toContain('workspaceId');
	});

	// The pass points the retired conversation at the playbook rather than
	// restating the rule, so a playbook that stops stating one leaves the prompt
	// pointing at nothing and the pass back to writing whatever it has.
	it('is what the retired conversation is pointed at, and permits writing nothing', () => {
		expect(MEMORY_PASS_PROMPT).toContain('test your playbook gives you');
		expect(MEMORY_PASS_PROMPT).toContain('write nothing');
	});
});
