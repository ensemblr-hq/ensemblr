#!/usr/bin/env node
/**
 * Fails on user-facing English that never reached a translation catalogue.
 *
 * `i18next-cli lint` only sees literals it can attribute to a `t()` call or a
 * JSX text node, so prose parked in an object literal, a `const` table, or a
 * template literal passes it silently — which is how the Changes panel shipped
 * "No changes yet" untranslated. This walks the renderer with the opposite
 * default: every prose-shaped literal is a finding unless it is inside a `t()`
 * call, in an excluded tree, or marked with an `i18next-instrument-ignore`
 * directive on the line above.
 *
 * The scanning itself lives in `hardcoded-strings-scan.mjs`, which is unit
 * tested; this module owns the walk, the exclusions, and the exit code.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findingsForFile } from './hardcoded-strings-scan.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOT = join(ROOT, 'src', 'renderer');

/** Trees the localization policy exempts, matched against the repo-relative path. */
const EXCLUDED_PATHS = [
	'src/renderer/components/ui/',
	'src/renderer/fixtures/',
	'src/renderer/types/',
	'src/renderer/lib/i18n/locales/',
	'src/renderer/routing/routeTree.gen.ts',
	// Diagnostic and telemetry copy, which the policy leaves untranslated.
	'src/renderer/lib/instrumentation/',
];

/**
 * Modules whose strings address an agent rather than the user. Agent-facing
 * prose is steered by `buildLanguageDirective`, not translated — see
 * `.claude/rules/i18n.md`.
 */
const AGENT_FACING_PATHS = [
	'src/renderer/lib/workbench/pi-slash-commands.ts',
	'src/renderer/lib/workbench/action-prompts.ts',
	'src/renderer/lib/workbench/checks-pr-prompts.ts',
	'src/renderer/lib/workbench/review-context.ts',
	'src/renderer/lib/workbench/comment-document.ts',
	'src/renderer/lib/workbench/mention-payload.ts',
	'src/renderer/state/composer/agent-turns.ts',
	'src/renderer/hooks/workbench-shell/composer/use-ask-agent-setup-script.ts',
	'src/renderer/hooks/workbench-shell/conversation-panel/use-plan-review.ts',
	'src/renderer/hooks/workbench-shell/conversation-panel/use-plan-handoff.ts',
	'src/renderer/lib/linear/issue-view.ts',
];

/**
 * Repo-relative, forward-slash form of a path, which is what both exclusion
 * lists are written in.
 * @param absolute - Absolute path somewhere under the repo
 * @returns The path relative to the repo root, with `/` separators
 */
function toRepoPath(absolute) {
	return relative(ROOT, absolute).split(sep).join('/');
}

/**
 * Whether a path sits in a tree the localization policy exempts.
 * @param repoPath - Repo-relative path, per {@link toRepoPath}
 * @returns True when the path must not be scanned
 */
function isExcluded(repoPath) {
	return EXCLUDED_PATHS.some((excluded) => repoPath.startsWith(excluded));
}

/**
 * What one directory entry contributes to the scan: the sources under it when
 * it is a directory, itself when it is a TypeScript file, nothing otherwise.
 * @param entry - Directory entry from a `withFileTypes` read
 * @param absolute - Absolute path of that entry
 * @returns Absolute paths of every file to check under this entry
 */
function sourcesUnder(entry, absolute) {
	if (entry.isDirectory()) {
		return collectSourceFiles(absolute);
	}
	return /\.tsx?$/.test(entry.name) ? [absolute] : [];
}

/**
 * Recursively collects the renderer's TypeScript sources, skipping excluded trees.
 * @param dir - Directory to walk
 * @returns Absolute paths of every file to check
 */
function collectSourceFiles(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const absolute = join(dir, entry.name);
		if (!isExcluded(toRepoPath(absolute))) {
			found.push(...sourcesUnder(entry, absolute));
		}
	}
	return found;
}

const findings = collectSourceFiles(SCAN_ROOT).flatMap((absolute) => {
	const repoPath = toRepoPath(absolute);
	return AGENT_FACING_PATHS.includes(repoPath)
		? []
		: findingsForFile(repoPath, readFileSync(absolute, 'utf8'));
});

if (findings.length > 0) {
	console.error(
		`Found ${findings.length} user-facing string(s) outside a t() call:\n`,
	);
	for (const finding of findings) {
		console.error(`  ${finding.file}:${finding.line}  ${finding.value}`);
	}
	console.error(
		"\nWrap each in t('namespace:key', 'English default') and fill ru/el, " +
			'or add an i18next-instrument-ignore directive when it must not translate.',
	);
	process.exit(1);
}

console.log('No untranslated user-facing strings found.');
