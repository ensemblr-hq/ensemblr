import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { App } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { resolveAgentSkillBundle } from '../../src/main/agent-skills/skill-bundle-paths.ts';
import { AGENT_CONTROL_OPS } from '../../src/shared/agent-control.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN_ROOT = path.join(REPO_ROOT, 'resources', 'agent-skills');
const SKILL_ROOT = path.join(PLUGIN_ROOT, 'skills', 'ensemblr');
const ARCHITECTURE_SKILL_ROOT = path.join(
	PLUGIN_ROOT,
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

const manifest = (): { name: string; skills: string[] } =>
	JSON.parse(
		readFileSync(
			path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'),
			'utf8',
		),
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

/** An Electron `app` stub covering only what the resolver reads. */
const fakeApp = (appPath: string): App =>
	({ getAppPath: () => appPath, isPackaged: false }) as unknown as App;

describe('the shipped Claude plugin manifest', () => {
	it('names every skill directory it bundles, and each one exists', () => {
		for (const entry of manifest().skills) {
			const directory = path.resolve(PLUGIN_ROOT, entry);
			expect(existsSync(path.join(directory, 'SKILL.md'))).toBe(true);
		}
	});

	it('keeps components out of .claude-plugin/, which holds the manifest alone', () => {
		expect(readdirSync(path.join(PLUGIN_ROOT, '.claude-plugin'))).toEqual([
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
	it('ships exactly the skills the manifest names', () => {
		const listed = manifest()
			.skills.map((entry) => path.basename(path.resolve(PLUGIN_ROOT, entry)))
			.sort();
		expect(readdirSync(path.join(PLUGIN_ROOT, 'skills')).sort()).toEqual(
			listed,
		);
	});

	it('validates every skill the plugin bundles, not just the first', () => {
		expect(SHIPPED_SKILLS.map((skill) => skill.name).sort()).toEqual(
			readdirSync(path.join(PLUGIN_ROOT, 'skills')).sort(),
		);
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

describe('resolveAgentSkillBundle', () => {
	it('finds the bundle shipped in the repository', () => {
		expect(resolveAgentSkillBundle(fakeApp(REPO_ROOT))).toEqual({
			pluginDirectory: PLUGIN_ROOT,
			skillDirectories: [SKILL_ROOT, ARCHITECTURE_SKILL_ROOT],
		});
	});

	it('reports nulls rather than a partial bundle when no candidate holds one', () => {
		const cwd = vi
			.spyOn(process, 'cwd')
			.mockReturnValue(path.join(REPO_ROOT, 'schemas'));
		try {
			expect(
				resolveAgentSkillBundle(fakeApp(path.join(REPO_ROOT, 'schemas'))),
			).toEqual({ pluginDirectory: null, skillDirectories: [] });
		} finally {
			cwd.mockRestore();
		}
	});
});
