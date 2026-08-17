/**
 * Resolves the Agent Skill bundle Ensemblr ships inside its own app package.
 *
 * One directory serves three consumers, because a Claude Code plugin root and a
 * Pi skill directory nest rather than conflict: Claude loads the plugin root
 * (`plugins` in the SDK, `--plugin-dir` for the harness) and Pi loads the skill
 * directory inside it (`--skill`). Shipping it as an app resource rather than
 * installing into `~/.claude/skills` or the user's repository keeps the skill
 * scoped to sessions Ensemblr launched and leaves nothing behind on uninstall.
 *
 * Every path is resolved defensively: a missing bundle yields `null` and the
 * runtime launches exactly as it did before skills existed, which beats failing
 * a session over a documentation file.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { App } from 'electron';

/** Directory the bundle is packaged under, in `extraResource` and in `resources/`. */
const BUNDLE_DIRECTORY = 'agent-skills';

/** Manifest that marks the bundle root as a Claude Code plugin. */
const PLUGIN_MANIFEST = path.join('.claude-plugin', 'plugin.json');

/** The one skill in the bundle, relative to the plugin root. */
const SKILL_SUBPATH = path.join('skills', 'ensemblr');

/** File every Agent Skill directory is identified by. */
const SKILL_FILE = 'SKILL.md';

/** The shipped skill bundle, addressed the way each runtime wants it. */
export interface AgentSkillBundle {
	/** Claude Code plugin root, for the SDK's `plugins` and the harness's `--plugin-dir`. */
	pluginDirectory: string | null;
	/** Pi skill directory inside that root, for `pi --skill`. */
	skillDirectory: string | null;
}

/** The bundle as it reads when nothing was found, so callers need no null check. */
const MISSING: AgentSkillBundle = {
	pluginDirectory: null,
	skillDirectory: null,
};

/**
 * Lists the directories the bundle could live in, packaged and in development.
 * @param app - The Electron app, for packaged vs. dev path resolution.
 * @returns Candidate bundle roots, most authoritative first.
 */
function bundleCandidates(app: App): readonly string[] {
	return app.isPackaged
		? [path.join(process.resourcesPath, BUNDLE_DIRECTORY)]
		: [
				path.join(app.getAppPath(), 'resources', BUNDLE_DIRECTORY),
				path.join(process.cwd(), 'resources', BUNDLE_DIRECTORY),
			];
}

/**
 * Reads one candidate root, requiring both the plugin manifest and the skill
 * file so a half-copied bundle is rejected rather than handed to a runtime that
 * will fail on it.
 * @param root - Candidate bundle root to test.
 * @returns The resolved bundle, or null when this root is not a complete one.
 */
function readBundle(root: string): AgentSkillBundle | null {
	const skillDirectory = path.join(root, SKILL_SUBPATH);
	const complete =
		existsSync(path.join(root, PLUGIN_MANIFEST)) &&
		existsSync(path.join(skillDirectory, SKILL_FILE));
	return complete ? { pluginDirectory: root, skillDirectory } : null;
}

/**
 * Resolves the shipped skill bundle, or a bundle of nulls when it is absent.
 * @param app - The Electron app, for packaged vs. dev path resolution.
 * @returns The plugin root and skill directory, each null when not found.
 */
export function resolveAgentSkillBundle(app: App): AgentSkillBundle {
	for (const root of bundleCandidates(app)) {
		const bundle = readBundle(root);
		if (bundle) {
			return bundle;
		}
	}
	return MISSING;
}
