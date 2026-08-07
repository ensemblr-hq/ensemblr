/**
 * Pretty display names for the popular model families, derived from Pi's raw
 * model ids by convention so new releases format automatically without a lookup
 * table. Anything that doesn't match a known family falls back to its reported
 * name unchanged — niche / local models keep e.g. `google/gemma-4-26b-a4b`.
 *
 *   claude-3-5-sonnet-20240620 → Claude Sonnet 3.5 (20240620)
 *   claude-fable-5             → Claude Fable 5
 *   claude-opus-4-5            → Claude Opus 4.5
 *   gpt-5.5                    → GPT‑5.5
 *   gpt-5.3-codex-spark        → GPT‑5.3‑Codex‑Spark
 */

/** Non-breaking hyphen — keeps multi-part GPT names from wrapping mid-word. */
const NB_HYPHEN = '‑';

/** Capitalizes a single word; leaves version-number tokens untouched. */
function capitalize(word: string): string {
	if (!word) {
		return word;
	}
	return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/** Joins Claude version numbers, dropping a trailing `.0` (4-0 → "4"). */
function formatVersion(parts: readonly string[]): string {
	if (parts.length === 0) {
		return '';
	}
	if (parts.length === 1) {
		return parts[0];
	}
	const [major, minor] = parts;
	return minor === '0' ? major : `${major}.${minor}`;
}

/**
 * Formats the Anthropic family. Tier and version can appear in either order
 * (`claude-3-5-sonnet-…` vs `claude-opus-4-5`), with an optional trailing
 * `YYYYMMDD` date or `latest` qualifier. Returns `null` on an unexpected shape
 * so the caller can fall back to the raw name.
 */
function formatClaude(name: string): string | null {
	const tokens = name.slice('claude-'.length).split('-').filter(Boolean);
	if (tokens.length === 0) {
		return null;
	}

	let qualifier: string | null = null;
	const last = tokens[tokens.length - 1];
	if (/^\d{8}$/.test(last)) {
		qualifier = last;
		tokens.pop();
	} else if (last.toLowerCase() === 'latest') {
		qualifier = 'latest';
		tokens.pop();
	}

	const numbers: string[] = [];
	let tier: string | null = null;
	for (const token of tokens) {
		if (/^\d+$/.test(token)) {
			numbers.push(token);
		} else if (tier === null) {
			tier = token;
		} else {
			// A second non-numeric token isn't part of the known convention.
			return null;
		}
	}
	if (tier === null) {
		return null;
	}

	const version = formatVersion(numbers);
	const base = version
		? `Claude ${capitalize(tier)} ${version}`
		: `Claude ${capitalize(tier)}`;
	return qualifier ? `${base} (${qualifier})` : base;
}

/**
 * Formats the OpenAI GPT family: `GPT` + each remaining token (versions kept
 * verbatim, words capitalized), joined by a non-breaking hyphen.
 */
function formatGpt(name: string): string {
	const rest = name.slice('gpt'.length).replace(/^-/, '');
	const tokens = rest.split('-').filter(Boolean);
	if (tokens.length === 0) {
		return 'GPT';
	}
	const parts = tokens.map((token) =>
		/^\d/.test(token) ? token : capitalize(token),
	);
	return ['GPT', ...parts].join(NB_HYPHEN);
}

/**
 * Maps a raw Pi model name to a human-friendly display name, falling back to the
 * reported name for families we don't recognize.
 */
export function formatModelDisplayName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		return name;
	}
	const lower = trimmed.toLowerCase();
	if (lower.startsWith('claude-')) {
		return formatClaude(trimmed) ?? trimmed;
	}
	if (lower === 'gpt' || lower.startsWith('gpt-')) {
		return formatGpt(trimmed);
	}
	return trimmed;
}
