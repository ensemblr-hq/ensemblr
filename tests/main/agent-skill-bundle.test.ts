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

const SKILL_MD = readBundleFile('SKILL.md');
const REFERENCES = readdirSync(path.join(SKILL_ROOT, 'references'));
const EVERY_DOC = [
	SKILL_MD,
	...REFERENCES.map((file) => readBundleFile(path.join('references', file))),
].join('\n');

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

describe('the ensemblr SKILL.md', () => {
	it('carries a name matching its directory and the Agent Skills charset', () => {
		const name = frontmatter(SKILL_MD).name;
		expect(name).toBe(path.basename(SKILL_ROOT));
		expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		expect((name ?? '').length).toBeLessThanOrEqual(64);
	});

	it('carries a description within the 1024-character limit', () => {
		const description = frontmatter(SKILL_MD).description ?? '';
		expect(description.length).toBeGreaterThan(0);
		expect(description.length).toBeLessThanOrEqual(1024);
	});

	it('links only to reference files that exist', () => {
		const links = [...SKILL_MD.matchAll(/\]\((references\/[^)]+)\)/g)].map(
			(match) => match[1] as string,
		);
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) {
			expect(existsSync(path.join(SKILL_ROOT, link))).toBe(true);
		}
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
