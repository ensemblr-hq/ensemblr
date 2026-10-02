/**
 * Turns one naming input into the human-readable name a workspace carries on
 * the board, the sidebar, and the tab strip.
 *
 * The sibling of `sanitizeBranchSlug`: both read the same argument through
 * {@link readNamingInput} — the one an agent passes to
 * `ensemblr_set_branch_name`, or the phrase the app derives from a first
 * prompt — and each renders it for its own surface. The branch gets the kebab
 * slug; the workspace gets words and spaces. Deriving
 * both from one input is what workspace *creation* has always done
 * (`prepareWorkspace` keeps the typed name and slugs it separately for the
 * folder and the branch); this is the same split, applied to rename, so a
 * workspace stops being titled with its own branch name minus the prefix.
 *
 * Case is preserved rather than imposed. An agent asked for a short title sends
 * one already cased — "Fix the IPC handler" — and the provisional namer carries
 * the user's own capitalization out of their prompt, so the best available
 * casing is the one that arrived. Only the first word is capitalized, only when
 * it came in lowercase, and never when {@link CANONICAL_WORDS} already fixed its
 * spelling — sentence case must not turn `npm` into `Npm`.
 */

import { toWorkspaceDisplayName } from '../../../shared/workspace-name.ts';
import { readNamingInput } from './naming-input.ts';

/**
 * Separators a naming input joins its words with, in a slug or a sentence. The
 * dot is one of them even though a workspace name may carry dots: a name built
 * from words has no use for one, and splitting on it is what stops `../../etc`
 * arriving as a name that leads with a dot — which the rename service rejects
 * outright.
 */
const WORD_SEPARATORS = /[\s\-_/.]+/;

/**
 * Words whose canonical rendering is fixed, keyed by their lowercase form. A
 * rendering from here is final: {@link renderWord} returns it as written and the
 * opening-word capitalization never runs over it, so a term the table fixes
 * lowercase survives in first position.
 *
 * The criterion for an entry is **determinacy, not case**. Most are initialisms
 * an abbreviation fixes uppercase, and a few are terms whose owner fixes them
 * lowercase — `npm` and `npx` because this repository's own package-manager
 * policy writes them that way, `xterm` because `.claude/rules/stack.md` does
 * throughout, `gh` because the same file names the CLI it shells out to. Each is
 * as determinate as `IPC`. Add one only against a source that fixes the
 * spelling; a term you would have to guess at stays out.
 *
 * A proper noun does not belong here however badly it reads lowercased, because
 * "GitHub" versus "github" is a judgment about a name rather than a fixed
 * spelling. The only caller that can send one lowercase is a caller that sent a
 * slug, and the fix for that is the title the tool now asks for — where "GitHub"
 * and "macOS" arrive spelled the way their owners spell them, without this table
 * having to predict them.
 */
const CANONICAL_WORDS = new Map<string, string>([
	['afk', 'AFK'],
	['ai', 'AI'],
	['api', 'API'],
	['cli', 'CLI'],
	['cpu', 'CPU'],
	['css', 'CSS'],
	['csv', 'CSV'],
	['db', 'DB'],
	['dns', 'DNS'],
	['dom', 'DOM'],
	['e2e', 'E2E'],
	['gh', 'gh'],
	['gpu', 'GPU'],
	['html', 'HTML'],
	['http', 'HTTP'],
	['https', 'HTTPS'],
	['id', 'ID'],
	['ide', 'IDE'],
	['ipc', 'IPC'],
	['json', 'JSON'],
	['jsx', 'JSX'],
	['jwt', 'JWT'],
	['llm', 'LLM'],
	['mcp', 'MCP'],
	['npm', 'npm'],
	['npx', 'npx'],
	['oauth', 'OAuth'],
	['os', 'OS'],
	['pdf', 'PDF'],
	['pr', 'PR'],
	['pty', 'PTY'],
	['rpc', 'RPC'],
	['sdk', 'SDK'],
	['sql', 'SQL'],
	['ssh', 'SSH'],
	['svg', 'SVG'],
	['tls', 'TLS'],
	['toml', 'TOML'],
	['tsx', 'TSX'],
	['ttl', 'TTL'],
	['ui', 'UI'],
	['url', 'URL'],
	['ux', 'UX'],
	['uuid', 'UUID'],
	['vm', 'VM'],
	['xml', 'XML'],
	['xterm', 'xterm'],
	['yaml', 'YAML'],
]);

/**
 * Derives the display name a workspace should carry from the same argument its
 * branch slug is derived from.
 * @param raw - The agent's naming argument, or the phrase derived from a first prompt.
 * @returns A workspace name the create and rename services accept, or null when nothing usable survives.
 */
export function deriveWorkspaceDisplayName(raw: string): string | null {
	const cleaned = readNamingInput(raw);
	if (!cleaned) {
		return null;
	}
	const words = cleaned
		.split(WORD_SEPARATORS)
		.filter((word) => word.length > 0)
		.map((word, index) => renderWord(word, index === 0));
	if (words.length === 0) {
		return null;
	}
	return toWorkspaceDisplayName(words.join(' '));
}

/**
 * Renders one word the way it should read in a name. A word {@link
 * CANONICAL_WORDS} fixes is returned as the table spells it and nothing else
 * touches it, which is what lets `npm` open a name without becoming `Npm`;
 * anything else keeps the casing it arrived with, and is sentence-cased when it
 * opens the name.
 * @param word - A single word split off the naming input.
 * @param opensName - Whether this word is the first in the name.
 * @returns The word as it should appear in the display name.
 */
function renderWord(word: string, opensName: boolean): string {
	const canonical = CANONICAL_WORDS.get(word.toLowerCase());
	if (canonical) {
		return canonical;
	}
	return opensName ? capitalizeOpeningWord(word) : word;
}

/**
 * Capitalizes the opening word, leaving one that already carries a capital alone
 * so a deliberately-cased term survives.
 * @param word - The word opening the name.
 * @returns The word, capitalized when it came in lowercase.
 */
function capitalizeOpeningWord(word: string): string {
	return word === word.toLowerCase()
		? `${word.charAt(0).toUpperCase()}${word.slice(1)}`
		: word;
}
