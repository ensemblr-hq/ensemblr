import { addCollection } from '@iconify/react';
import { icons as logosIcons } from '@iconify-json/logos';

addCollection(logosIcons);

/**
 * Iconify brand-logo names (from the offline `logos` collection) for the agent
 * harnesses that ship a recognizable logo. Harnesses absent here fall back to a
 * generic robot glyph in the launcher menu.
 */
const HARNESS_ICON_BY_ID: Record<string, string> = {
	claude: 'logos:claude-icon',
	codex: 'logos:openai-icon',
	vibe: 'logos:mistral-ai-icon',
};

/**
 * Extra Tailwind classes per harness icon, for logos that do not render legibly
 * with their default fill. The OpenAI (Codex) logo is a single fill-less path
 * that defaults to black and vanishes in dark mode; `fill-current` + a theme
 * text color recolors it. Other logos carry their own fills and are left alone.
 */
const HARNESS_ICON_CLASS_BY_ID: Record<string, string> = {
	codex: 'fill-current text-foreground',
};

/**
 * Resolves the iconify brand-logo name for a harness id.
 * @param harnessId - The harness registry id.
 * @returns The iconify name, or null when the harness has no brand logo.
 */
export function harnessIconName(harnessId: string): string | null {
	return HARNESS_ICON_BY_ID[harnessId] ?? null;
}

/**
 * Resolves extra icon classes that fix legibility for a harness brand logo.
 * @param harnessId - The harness registry id.
 * @returns The extra Tailwind classes, or an empty string when none are needed.
 */
export function harnessIconClassName(harnessId: string): string {
	return HARNESS_ICON_CLASS_BY_ID[harnessId] ?? '';
}
