import { z } from 'zod';

/**
 * Schema + defaults for the user-facing **App settings** persisted in
 * `~/.config/ensemble/config.json` under the `app` key (`app.general`,
 * `app.models`). This is the single source of truth shared by the main process
 * (read/validate/write) and the renderer (defaults + types).
 *
 * Per-field `.catch(default)` keeps a hand-edited config resilient: an invalid
 * or missing field falls back to its default instead of rejecting the whole
 * file. Repo-scoped settings are intentionally out of scope here.
 */

// No object-level `.default` — each field's `.catch` already fills a missing or
// invalid value when the (possibly empty) object is parsed, which sidesteps
// zod's requirement that `.default` receive a fully-populated object.
export const generalSettingsSchema = z.object({
	sendShortcut: z.enum(['enter', 'mod+enter']).catch('enter'),
	followUpBehavior: z.enum(['steer', 'queue', 'block']).catch('steer'),
	desktopNotifications: z.boolean().catch(true),
	autoConvertLongText: z.boolean().catch(true),
	alwaysShowContextUsage: z.boolean().catch(true),
	caffeinateWhileRunning: z.boolean().catch(false),
	toolCallCollapse: z.enum(['collapsed', 'expanded']).catch('collapsed'),
});

export const modelSettingsSchema = z.object({
	defaultModel: z.string().nullable().catch(null),
	defaultThinkingLevel: z.string().nullable().catch(null),
	reviewModel: z.string().nullable().catch(null),
	reviewThinkingLevel: z.string().nullable().catch(null),
	hiddenModels: z.array(z.string()).catch([]),
});

// Git user-scope defaults. Field names mirror the repository-resolution keys
// (`deleteLocalBranchOnArchive`, `archiveAfterMerge`, `setUpstreamOnPush`, …) so
// `resolveSettings` can feed them straight in as the `user-default` source.
export const gitSettingsSchema = z.object({
	branchPrefixSource: z
		.enum(['github-username', 'custom', 'none'])
		.catch('github-username'),
	branchPrefixCustom: z.string().catch(''),
	renameWorkspaceOnBranch: z.boolean().catch(true),
	deleteLocalBranchOnArchive: z.boolean().catch(false),
	archiveAfterMerge: z.boolean().catch(false),
	setUpstreamOnPush: z.boolean().catch(true),
});

export const appSettingsSchema = z.object({
	general: generalSettingsSchema,
	models: modelSettingsSchema,
	git: gitSettingsSchema,
});

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type GeneralSettings = AppSettings['general'];
export type ModelSettings = AppSettings['models'];
export type GitSettings = AppSettings['git'];
export type BranchPrefixSource = GitSettings['branchPrefixSource'];

/** Section-scoped partial patch applied by `updateAppSettings`. */
export interface AppSettingsPatch {
	general?: Partial<GeneralSettings>;
	models?: Partial<ModelSettings>;
	git?: Partial<GitSettings>;
}

/** Validates an untrusted patch at the IPC boundary; unknown keys are dropped. */
export const appSettingsPatchSchema = z.object({
	general: generalSettingsSchema.partial().optional(),
	models: modelSettingsSchema.partial().optional(),
	git: gitSettingsSchema.partial().optional(),
});

/** Fully-defaulted settings — the baseline before any config file is read. */
export const DEFAULT_APP_SETTINGS: AppSettings = appSettingsSchema.parse({
	general: {},
	models: {},
	git: {},
});

/** True for a non-null, non-array plain object. */
function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * Parses an untrusted value (the `app` slice of config.json) into validated
 * {@link AppSettings}, filling per-field defaults. A missing/non-object section
 * normalizes to `{}` so each field's `.catch` supplies its default.
 */
export function parseAppSettings(raw: unknown): AppSettings {
	const record = asRecord(raw);
	const result = appSettingsSchema.safeParse({
		general: asRecord(record.general),
		models: asRecord(record.models),
		git: asRecord(record.git),
	});
	return result.success ? result.data : DEFAULT_APP_SETTINGS;
}

/** Merges a section-scoped patch onto current settings (immutably). */
export function mergeAppSettings(
	current: AppSettings,
	patch: AppSettingsPatch,
): AppSettings {
	return {
		general: { ...current.general, ...patch.general },
		models: { ...current.models, ...patch.models },
		git: { ...current.git, ...patch.git },
	};
}
