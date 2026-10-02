import type { TFunction } from 'i18next';

/** Longest project or workspace name the main process accepts. */
const ENTITY_NAME_MAX_LENGTH = 100;

/** Which named thing a dialog is validating; picks the wording of the message. */
export type EntityNameKind = 'project' | 'workspace';

/** Why a typed name is not acceptable, per {@link validateEntityName}. */
export type EntityNameIssue = 'invalid-characters' | 'leading-dot' | 'too-long';

/**
 * Mirror the main-process name rules so a dialog can surface feedback before
 * the IPC round-trip. An empty name reads as "not typed yet", not as invalid.
 * @param name - Trimmed name the user typed
 * @param pattern - Character-set pattern the main process enforces
 * @returns The issue to report under the field, or null when the name passes
 */
export function validateEntityName({
	name,
	pattern,
}: {
	name: string;
	pattern: RegExp;
}): EntityNameIssue | null {
	if (!name) {
		return null;
	}
	if (name.length > ENTITY_NAME_MAX_LENGTH) {
		return 'too-long';
	}
	if (name === '.' || name === '..' || name.startsWith('.')) {
		return 'leading-dot';
	}
	if (!pattern.test(name)) {
		return 'invalid-characters';
	}
	return null;
}

/**
 * Localized message for a name issue. Each entity spells its own full sentence
 * rather than splicing a translated noun into a shared frame, which no target
 * language would decline correctly.
 * @param t - Translator bound to the active language
 * @param kind - Which named thing failed validation
 * @param issue - The issue {@link validateEntityName} reported
 * @returns The message to show under the field
 */
export function entityNameIssueText(
	t: TFunction,
	kind: EntityNameKind,
	issue: EntityNameIssue,
): string {
	if (kind === 'project') {
		switch (issue) {
			case 'too-long':
				return t(
					'common:entity-name.project.too-long',
					'Project names must be {{max}} characters or fewer.',
					{ max: ENTITY_NAME_MAX_LENGTH },
				);
			case 'leading-dot':
				return t(
					'common:entity-name.project.leading-dot',
					'Project names cannot start with a dot.',
				);
			case 'invalid-characters':
				return t(
					'common:entity-name.project.invalid-characters',
					'Use only letters, numbers, dots, dashes, or underscores.',
				);
		}
	}
	switch (issue) {
		case 'too-long':
			return t(
				'common:entity-name.workspace.too-long',
				'Workspace names must be {{max}} characters or fewer.',
				{ max: ENTITY_NAME_MAX_LENGTH },
			);
		case 'leading-dot':
			return t(
				'common:entity-name.workspace.leading-dot',
				'Workspace names cannot start with a dot.',
			);
		case 'invalid-characters':
			return t(
				'common:entity-name.workspace.invalid-characters',
				'Use only letters, numbers, spaces, dots, dashes, or underscores.',
			);
	}
}
