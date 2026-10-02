/**
 * Resolves the Agent Skill bundles Ensemblr ships inside its own app package.
 *
 * One directory serves two consumers, because a Claude Code plugin root and a
 * Pi skill directory nest rather than conflict: Claude loads the plugin root
 * (`plugins` in the SDK, `--plugin-dir` for the harness) and Pi loads the skill
 * directory inside it (`--skill`). Shipping them as app resources rather than
 * installing into `~/.claude/skills` or the user's repository keeps the skills
 * scoped to sessions Ensemblr launched and leaves nothing behind on uninstall.
 *
 * The architecture-diagram skill is a *second* plugin root rather than a second
 * skill inside the first, because it belongs to a feature the user switches on
 * and off. A skill listed in a manifest loads whenever that manifest does — the
 * app cannot rewrite a packaged resource to drop one — so withholding the whole
 * root is the only way the skill is absent rather than advertised alongside two
 * control tools nobody holds. Both runtimes take a list: the SDK's `plugins` is
 * an array and `--plugin-dir` repeats.
 *
 * Every path is resolved defensively: a missing bundle contributes nothing and
 * the runtime launches exactly as it did before skills existed, which beats
 * failing a session over a documentation file.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { App } from 'electron';

/** Manifest that marks a bundle root as a Claude Code plugin. */
const PLUGIN_MANIFEST = path.join('.claude-plugin', 'plugin.json');

/** File every Agent Skill directory is identified by. */
const SKILL_FILE = 'SKILL.md';

/**
 * A shipped plugin root: the directory it lives under, and the skills inside it.
 * Claude reads the manifest and finds them itself; Pi names one directory per
 * `--skill` flag, which is why the skills are listed rather than inferred.
 */
interface BundleSpec {
	directory: string;
	skillSubpaths: readonly string[];
}

/** The always-on bundle: how to work inside Ensemblr at all. */
const CORE_BUNDLE: BundleSpec = {
	directory: 'agent-skills',
	skillSubpaths: [path.join('skills', 'ensemblr')],
};

/** The bundle behind the experimental architecture-diagram switch. */
const ARCHITECTURE_BUNDLE: BundleSpec = {
	directory: 'agent-skills-architecture',
	skillSubpaths: [path.join('skills', 'architecture-diagram')],
};

/** The shipped skills, addressed the way each runtime wants them. */
export interface AgentSkillBundle {
	/** Claude Code plugin roots, for the SDK's `plugins` and the harness's `--plugin-dir`. */
	pluginDirectories: readonly string[];
	/** Pi skill directories inside those roots, one `pi --skill` flag each. */
	skillDirectories: readonly string[];
}

/**
 * Lists the directories one bundle could live in, packaged and in development.
 * @param app - The Electron app, for packaged vs. dev path resolution.
 * @param directory - The bundle's own directory name.
 * @returns Candidate bundle roots, most authoritative first.
 */
function bundleCandidates(app: App, directory: string): readonly string[] {
	return app.isPackaged
		? [path.join(process.resourcesPath, directory)]
		: [
				path.join(app.getAppPath(), 'resources', directory),
				path.join(process.cwd(), 'resources', directory),
			];
}

/**
 * Reads one candidate root, requiring the plugin manifest and at least one
 * complete skill so a half-copied bundle is rejected rather than handed to a
 * runtime that will fail on it. A skill whose `SKILL.md` did not make it is
 * dropped rather than failing the whole bundle — the others still load.
 * @param root - Candidate bundle root to test.
 * @param skillSubpaths - The skills this bundle should hold, relative to the root.
 * @returns The resolved bundle, or null when this root is not a complete one.
 */
function readBundle(
	root: string,
	skillSubpaths: readonly string[],
): AgentSkillBundle | null {
	if (!existsSync(path.join(root, PLUGIN_MANIFEST))) {
		return null;
	}
	const skillDirectories = skillSubpaths.flatMap((subpath) => {
		const directory = path.join(root, subpath);
		return existsSync(path.join(directory, SKILL_FILE)) ? [directory] : [];
	});
	return skillDirectories.length > 0
		? { pluginDirectories: [root], skillDirectories }
		: null;
}

/**
 * Resolves one bundle from its candidate roots, or nothing when it is absent.
 * @param app - The Electron app, for packaged vs. dev path resolution.
 * @param spec - Which bundle to resolve.
 * @returns The resolved bundle, or null.
 */
function resolveBundle(app: App, spec: BundleSpec): AgentSkillBundle | null {
	for (const root of bundleCandidates(app, spec.directory)) {
		const bundle = readBundle(root, spec.skillSubpaths);
		if (bundle) {
			return bundle;
		}
	}
	return null;
}

/**
 * Resolves the shipped skills a session should load, folding every bundle it is
 * entitled to into one answer.
 * @param app - The Electron app, for packaged vs. dev path resolution.
 * @param options - Which optional bundles this session is entitled to.
 * @returns The plugin roots and skill directories, each list empty when nothing was found.
 */
export function resolveAgentSkillBundle(
	app: App,
	options: { architectureDiagram: boolean } = { architectureDiagram: false },
): AgentSkillBundle {
	const specs = options.architectureDiagram
		? [CORE_BUNDLE, ARCHITECTURE_BUNDLE]
		: [CORE_BUNDLE];
	const bundles = specs
		.map((spec) => resolveBundle(app, spec))
		.filter((bundle) => bundle !== null);
	return {
		pluginDirectories: bundles.flatMap((bundle) => bundle.pluginDirectories),
		skillDirectories: bundles.flatMap((bundle) => bundle.skillDirectories),
	};
}
