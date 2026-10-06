import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { App } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
	readStagedAgentMods,
	stageAgentMods,
} from '../../src/main/agent-skills/mods-staging.ts';
import { resolveAgentSkillBundle } from '../../src/main/agent-skills/skill-bundle-paths.ts';
import { AGENT_CONTROL_OPS } from '../../src/shared/agent-control.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN_ROOT = path.join(REPO_ROOT, 'resources', 'agent-skills');
const ARCHITECTURE_PLUGIN_ROOT = path.join(
	REPO_ROOT,
	'resources',
	'agent-skills-architecture',
);
const PLUGIN_ROOTS = [PLUGIN_ROOT, ARCHITECTURE_PLUGIN_ROOT];
const MODS_PLUGIN_ROOT = path.join(REPO_ROOT, 'resources', 'agent-mods');
const SKILL_ROOT = path.join(PLUGIN_ROOT, 'skills', 'ensemblr');
const ARCHITECTURE_SKILL_ROOT = path.join(
	ARCHITECTURE_PLUGIN_ROOT,
	'skills',
	'architecture-diagram',
);
const SETTINGS_SCHEMA_PATH = path.join(
	REPO_ROOT,
	'schemas',
	'settings.schema.json',
);

const readBundleFile = (relative: string): string =>
	readFileSync(path.join(SKILL_ROOT, relative), 'utf8');

const referenceFiles = (root: string): string[] => {
	const directory = path.join(root, 'references');
	return existsSync(directory) ? readdirSync(directory) : [];
};

const shippedSkill = (root: string) => {
	const read = (relative: string): string =>
		readFileSync(path.join(root, relative), 'utf8');
	const skillMarkdown = read('SKILL.md');
	return {
		everyDoc: [
			skillMarkdown,
			...referenceFiles(root).map((file) =>
				read(path.join('references', file)),
			),
		].join('\n'),
		name: path.basename(root),
		root,
		skillMarkdown,
	};
};

const SHIPPED_SKILLS = [SKILL_ROOT, ARCHITECTURE_SKILL_ROOT].map(shippedSkill);
const EVERY_DOC = SHIPPED_SKILLS.map((skill) => skill.everyDoc).join('\n');

const manifest = (root: string): { name: string; skills: string[] } =>
	JSON.parse(
		readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'),
	);

const frontmatter = (source: string): Record<string, string> => {
	const block = /^---\n([\s\S]*?)\n---/.exec(source);
	if (!block) {
		return {};
	}
	return Object.fromEntries(
		(block[1] ?? '')
			.split('\n')
			.map((line) => /^([a-z-]+):\s*([\s\S]*)$/.exec(line))
			.filter((match) => match !== null)
			.map((match) => [match[1] as string, (match[2] ?? '').trim()]),
	);
};

const USER_DATA = mkdtempSync(path.join(tmpdir(), 'ensemblr-user-data-'));

/** An Electron `app` stub covering only what the resolver reads. */
const fakeApp = (appPath: string): App =>
	({
		getAppPath: () => appPath,
		getPath: () => USER_DATA,
		isPackaged: false,
	}) as unknown as App;

/** A staged mods root under the stub's user data, whatever its hash. */
const STAGED_MODS_ROOT = expect.stringMatching(
	/[\\/]claude-mods[\\/][0-9a-f]{16}$/,
);

/**
 * Writes a minimal mods plugin, plus test-only files that must never ship.
 * @param root - Directory to write it into.
 * @param hook - Body of the one hook module, so a test can change what ships.
 */
const writeModsPlugin = (root: string, hook = 'export default {};\n'): void => {
	mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
	mkdirSync(path.join(root, 'hooks'), { recursive: true });
	mkdirSync(path.join(root, 'tests'), { recursive: true });
	writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{}\n');
	writeFileSync(path.join(root, 'hooks', 'hooks.json'), '{}\n');
	writeFileSync(path.join(root, 'hooks', 'mod.ts'), hook);
	writeFileSync(path.join(root, 'hooks', 'mod.test.ts'), 'test one\n');
	writeFileSync(path.join(root, 'tests', 'suite.ts'), 'test two\n');
};

/** A fresh scratch directory for one staging test. */
const scratch = (): string =>
	mkdtempSync(path.join(tmpdir(), 'ensemblr-mods-staging-'));

/**
 * Lists every file under a directory, relative to it.
 * @param root - Directory to list.
 * @returns POSIX-style relative paths, sorted.
 */
const listFiles = (root: string): string[] =>
	readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) =>
			path
				.relative(root, path.join(entry.parentPath, entry.name))
				.split(path.sep)
				.join('/'),
		)
		.sort();

describe.each(PLUGIN_ROOTS)('the shipped Claude plugin manifest', (root) => {
	it('names every skill directory it bundles, and each one exists', () => {
		for (const entry of manifest(root).skills) {
			const directory = path.resolve(root, entry);
			expect(existsSync(path.join(directory, 'SKILL.md'))).toBe(true);
		}
	});

	it('keeps components out of .claude-plugin/, which holds the manifest alone', () => {
		expect(readdirSync(path.join(root, '.claude-plugin'))).toEqual([
			'plugin.json',
		]);
	});
});

describe.each(SHIPPED_SKILLS)('the $name SKILL.md', (skill) => {
	it('carries a name matching its directory and the Agent Skills charset', () => {
		const name = frontmatter(skill.skillMarkdown).name;
		expect(name).toBe(skill.name);
		expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		expect((name ?? '').length).toBeLessThanOrEqual(64);
	});

	it('carries a description within the 1024-character limit', () => {
		const description = frontmatter(skill.skillMarkdown).description ?? '';
		expect(description.length).toBeGreaterThan(0);
		expect(description.length).toBeLessThanOrEqual(1024);
	});

	it('links only to reference files that exist', () => {
		const links = [
			...skill.skillMarkdown.matchAll(/\]\((references\/[^)]+)\)/g),
		].map((match) => match[1] as string);
		for (const link of links) {
			expect(existsSync(path.join(skill.root, link))).toBe(true);
		}
	});
});

describe('the shipped skills as a set', () => {
	it('ships exactly the skills each manifest names', () => {
		for (const root of PLUGIN_ROOTS) {
			const listed = manifest(root)
				.skills.map((entry) => path.basename(path.resolve(root, entry)))
				.sort();
			expect(readdirSync(path.join(root, 'skills')).sort()).toEqual(listed);
		}
	});

	it('validates every skill the plugins bundle, not just the first', () => {
		expect(SHIPPED_SKILLS.map((skill) => skill.name).sort()).toEqual(
			PLUGIN_ROOTS.flatMap((root) =>
				readdirSync(path.join(root, 'skills')),
			).sort(),
		);
	});

	// The architecture diagram is a whole feature behind an Experimental switch,
	// and a skill listed in a manifest loads whenever that manifest does. Keeping
	// it in a root of its own is the only way the app can withhold it.
	it('keeps the architecture-diagram skill in a root the core manifest does not name', () => {
		expect(manifest(PLUGIN_ROOT).skills).not.toContain(
			'./skills/architecture-diagram',
		);
		expect(manifest(ARCHITECTURE_PLUGIN_ROOT).skills).toEqual([
			'./skills/architecture-diagram',
		]);
	});

	it('keeps at least one reference link across the bundle, so the link check cannot pass vacuously', () => {
		expect(
			[...EVERY_DOC.matchAll(/\]\(references\/[^)]+\)/g)].length,
		).toBeGreaterThan(0);
	});
});

describe('the skill against the surfaces it documents', () => {
	it('names no control tool the control layer does not serve', () => {
		const served = new Set(
			AGENT_CONTROL_OPS.map(
				(op) =>
					`ensemblr_${op.replaceAll(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
			),
		);
		const named = new Set(
			[...EVERY_DOC.matchAll(/`(ensemblr_[a-z_]+)`/g)].map(
				(match) => match[1] as string,
			),
		);
		expect(named.size).toBeGreaterThan(0);
		expect([...named].filter((tool) => !served.has(tool))).toEqual([]);
	});

	it('names no settings.toml key the published schema does not accept', () => {
		const schema = JSON.parse(readFileSync(SETTINGS_SCHEMA_PATH, 'utf8'));
		const accepted = new Set([
			...Object.keys(schema.properties ?? {}),
			...Object.values(schema.properties ?? {}).flatMap((property: unknown) =>
				Object.keys(
					(property as { properties?: Record<string, unknown> }).properties ??
						{},
				),
			),
			...Object.keys(schema.$defs?.runScript?.properties ?? {}),
		]);
		const settingsDoc = readBundleFile(
			path.join('references', 'settings-toml.md'),
		);
		const named = [
			...settingsDoc.matchAll(/^\| `([a-z_]+)`(?: \/ `([a-z_]+)`)? \|/gm),
		].flatMap((match) =>
			[match[1], match[2]].filter((key) => key !== undefined),
		);
		expect(named.length).toBeGreaterThan(0);
		expect(named.filter((key) => !accepted.has(key as string))).toEqual([]);
	});
});

describe('the shipped Claude Code mods plugin', () => {
	it('keeps components out of .claude-plugin/, which holds the manifest alone', () => {
		expect(readdirSync(path.join(MODS_PLUGIN_ROOT, '.claude-plugin'))).toEqual([
			'plugin.json',
		]);
	});

	it('carries the hook registry the staging step requires', () => {
		expect(existsSync(path.join(MODS_PLUGIN_ROOT, 'hooks', 'hooks.json'))).toBe(
			true,
		);
	});
});

describe('resolveAgentSkillBundle', () => {
	it('finds the bundle shipped in the repository, the staged mods last', () => {
		expect(
			resolveAgentSkillBundle(fakeApp(REPO_ROOT), {
				architectureDiagram: true,
			}),
		).toEqual({
			pluginDirectories: [...PLUGIN_ROOTS, STAGED_MODS_ROOT],
			skillDirectories: [SKILL_ROOT, ARCHITECTURE_SKILL_ROOT],
		});
	});

	it('withholds the architecture bundle by default, and gives Pi nothing from the mods', () => {
		expect(resolveAgentSkillBundle(fakeApp(REPO_ROOT))).toEqual({
			pluginDirectories: [PLUGIN_ROOT, STAGED_MODS_ROOT],
			skillDirectories: [SKILL_ROOT],
		});
	});

	it('reports nulls rather than a partial bundle when no candidate holds one', () => {
		const cwd = vi
			.spyOn(process, 'cwd')
			.mockReturnValue(path.join(REPO_ROOT, 'schemas'));
		try {
			expect(
				resolveAgentSkillBundle(fakeApp(path.join(REPO_ROOT, 'schemas'))),
			).toEqual({ pluginDirectories: [], skillDirectories: [] });
		} finally {
			cwd.mockRestore();
		}
	});
});

describe('stageAgentMods', () => {
	it('copies what ships into a content-hashed directory, leaving tests behind', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');

		const staged = stageAgentMods(source, parent);

		expect(path.dirname(staged)).toBe(parent);
		expect(path.basename(staged)).toMatch(/^[0-9a-f]{16}$/);
		expect(listFiles(staged)).toEqual([
			'.claude-plugin/plugin.json',
			'hooks/hooks.json',
			'hooks/mod.ts',
		]);
	});

	it('hashes only what ships, so a test-only change keeps the same copy', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const before = stageAgentMods(source, parent);

		writeFileSync(path.join(source, 'tests', 'suite.ts'), 'changed\n');
		writeFileSync(path.join(source, 'hooks', 'mod.test.ts'), 'changed\n');

		expect(stageAgentMods(source, parent)).toBe(before);
	});

	it('moves to a new copy when a shipped file changes', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const before = stageAgentMods(source, parent);

		writeModsPlugin(source, 'export default { changed: true };\n');

		expect(stageAgentMods(source, parent)).not.toBe(before);
	});

	it('reuses a copy already staged, keeping what Claude wrote into it', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const staged = stageAgentMods(source, parent);
		writeFileSync(path.join(staged, 'tsconfig.json'), '{}\n');

		expect(stageAgentMods(source, parent)).toBe(staged);
		expect(existsSync(path.join(staged, 'tsconfig.json'))).toBe(true);
	});

	it('removes sibling copies untouched for a day and keeps recent ones', () => {
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');
		const stale = path.join(parent, '0000000000000000');
		const recent = path.join(parent, '1111111111111111');
		mkdirSync(stale, { recursive: true });
		mkdirSync(recent, { recursive: true });
		const now = Date.now();
		const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
		utimesSync(stale, twoDaysAgo, twoDaysAgo);

		const staged = stageAgentMods(source, parent, now);

		expect(existsSync(stale)).toBe(false);
		expect(existsSync(recent)).toBe(true);
		expect(statSync(staged).mtimeMs).toBe(now);
	});
});

describe('readStagedAgentMods', () => {
	it('stages the first complete candidate once per process', () => {
		const incomplete = path.join(scratch(), 'agent-mods');
		mkdirSync(path.join(incomplete, '.claude-plugin'), { recursive: true });
		writeFileSync(path.join(incomplete, '.claude-plugin', 'plugin.json'), '{}');
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const parent = path.join(scratch(), 'claude-mods');

		const staged = readStagedAgentMods([incomplete, source], parent);
		writeModsPlugin(source, 'export default { later: true };\n');

		expect(staged).not.toBeNull();
		expect(readStagedAgentMods([incomplete, source], parent)).toBe(staged);
		expect(readdirSync(parent)).toHaveLength(1);
	});

	it('contributes nothing when no candidate holds the hook registry', () => {
		const source = path.join(scratch(), 'agent-mods');
		mkdirSync(path.join(source, '.claude-plugin'), { recursive: true });
		writeFileSync(path.join(source, '.claude-plugin', 'plugin.json'), '{}');

		expect(
			readStagedAgentMods([source], path.join(scratch(), 'claude-mods')),
		).toBeNull();
	});

	it('contributes nothing, and logs, when the copy cannot be written', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = path.join(scratch(), 'agent-mods');
		writeModsPlugin(source);
		const blocked = path.join(scratch(), 'not-a-directory');
		writeFileSync(blocked, 'a file where the staging parent should be');

		try {
			expect(readStagedAgentMods([source], blocked)).toBeNull();
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});
