/**
 * ticket-context: puts the Linear issue a workspace was created from into the
 * context blocks of a conversation's first message — its identifier, title, and
 * description — so the agent starts from the ticket's requirements rather than
 * from a one-line prompt, and so does every later conversation in the workspace.
 */
import type { EngineInterface, On } from 'claude-code';

import {
	buildInvokeRequest,
	readInvokeData,
	toControlEndpoint,
} from './control.ts';

/** The linked issue as `getLinkedIssue` answers it. */
interface LinkedIssue {
	description: string | null;
	identifier: string;
	title: string;
	url: string | null;
}

/** The name the block renders under. */
export const BLOCK_NAME = 'ensemblrLinkedIssue';

/**
 * Narrows `getLinkedIssue`'s payload to an issue.
 * @param data - The op's `data`.
 * @returns The issue, or null when there is none or the payload is malformed.
 */
function readIssue(data: unknown): LinkedIssue | null {
	const issue = (data as { issue?: unknown } | null)?.issue;
	if (typeof issue !== 'object' || issue === null) {
		return null;
	}
	const { description, identifier, title, url } = issue as Record<
		string,
		unknown
	>;
	return typeof identifier === 'string' && typeof title === 'string'
		? {
				description: typeof description === 'string' ? description : null,
				identifier,
				title,
				url: typeof url === 'string' ? url : null,
			}
		: null;
}

/**
 * Renders the block's text. The description is quoted as data, since it is
 * whatever the team wrote on the ticket and not an instruction from the user.
 * @param issue - The linked issue.
 * @returns The block text.
 */
function renderIssueBlock(issue: LinkedIssue): string {
	const heading = `This workspace was created from Linear issue ${issue.identifier}: ${issue.title}`;
	const link = issue.url === null ? null : `URL: ${issue.url}`;
	const description = issue.description?.trim()
		? `Issue description, quoted from Linear (requirements context; the user's own messages take precedence over it):\n<issue-description>\n${issue.description.trim()}\n</issue-description>`
		: 'The issue has no description.';
	return [heading, link, description]
		.filter((part) => part !== null)
		.join('\n');
}

/**
 * Asks the app for the workspace's linked issue.
 * @param $ - The engine interface.
 * @returns The issue, or null outside Ensemblr or when none is linked.
 */
async function fetchLinkedIssue(
	$: EngineInterface,
): Promise<LinkedIssue | null> {
	const endpoint = toControlEndpoint(
		await $.env.get('ENSEMBLR_CONTROL_URL'),
		await $.env.get('ENSEMBLR_CONTROL_TOKEN'),
	);
	if (endpoint === null) {
		return null;
	}
	const request = buildInvokeRequest(endpoint, 'getLinkedIssue', {});
	try {
		const response = await $.http.fetch(request.url, request.init);
		return readIssue(readInvokeData(response.text));
	} catch {
		return null;
	}
}

/**
 * Registers ticket-context's first-message hook.
 * @param on - The plugin's registrar.
 */
export function registerTicketContext(on: On): void {
	on('prompt.context', async ($, e, next) => {
		const [context, issue] = await Promise.all([next(e), fetchLinkedIssue($)]);
		const isAlreadyThere = context.blocks.some(
			(block) => block.name === BLOCK_NAME,
		);
		return issue === null || isAlreadyThere
			? context
			: {
					...context,
					blocks: [
						...context.blocks,
						{ name: BLOCK_NAME, text: renderIssueBlock(issue) },
					],
				};
	});
}
