/**
 * The standing instruction that credits Ensemblr on commits an agent makes,
 * rendered unless the user has switched the credit off.
 *
 * The app can put the trailer on the commits it makes itself, and those are the
 * few: the Changes panel's Commit button is one code path, while every other
 * commit in a workspace comes from an agent shelling out `git commit`. Crediting
 * only the app would therefore credit almost nothing, so the agent is told the
 * line and told when to write it.
 *
 * It is rendered by the app rather than written into a playbook for the reason
 * {@link buildLinkedIssueDirective} is: the shipped Pi extension carries
 * byte-identical copies of the playbooks that a parity test polices, and those
 * copies must stay flat literals. A block that appears only under a setting has
 * no literal to compare against, so the app renders the finished sentence and
 * every surface appends a string it never authors.
 *
 * The block never claims authorship of the change. A trailer is a credit line
 * git already understands, and the human running the session stays the author.
 *
 * It names no workspace, because the Concierge reaches every repository under
 * the root by grant and commits there without holding a workspace of its own.
 */

import {
	ENSEMBLR_CO_AUTHOR_EMAIL,
	ENSEMBLR_CO_AUTHOR_TRAILER,
} from '../co-author.ts';

/** Opening line of the block, and the marker tests assert on. */
export const CO_AUTHOR_DIRECTIVE_HEADER = 'COMMIT CO-AUTHOR';

/** Why the line exists, so it reads as settled configuration rather than self-promotion. */
const RATIONALE = `Ensemblr ships this credit on and the user has left it that way; Settings → Git is where they switch it off, so it is a settled call and not something to raise with them or to leave out because a commit felt too small. \`${ENSEMBLR_CO_AUTHOR_EMAIL}\` is a real GitHub account, which is what makes the credit land rather than render as text.`;

/** How to write it, and the two ways it goes wrong. */
const MECHANICS = `Put it in the commit message body, separated from everything above it by a blank line, and after any other trailer the message already carries. One blank line, one trailer per line, nothing after it. Two things break the credit and both look fine in a terminal: a trailer wrapped onto a second line, and a trailer sharing a line with prose.

If the message already carries this exact line, leave it — never write it twice. Nothing else about the message changes: the subject, the body, and any \`Co-authored-by\` naming a human all stay as they are, because this credit is additional to theirs rather than a replacement for it.`;

/**
 * Renders the co-author block, or null when the user has switched the credit off.
 * @param enabled - Whether the credit is on, as it is until the user turns it off.
 * @returns The block to append to a playbook, or null when the setting is off.
 */
export function buildCoAuthorDirective(enabled: boolean): string | null {
	if (!enabled) {
		return null;
	}
	return `${CO_AUTHOR_DIRECTIVE_HEADER}: every commit you make ends with this trailer, exactly as written:

\`\`\`
${ENSEMBLR_CO_AUTHOR_TRAILER}
\`\`\`

${RATIONALE}

${MECHANICS}`;
}
