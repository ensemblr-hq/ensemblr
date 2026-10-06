/**
 * ticket-context: puts the Linear issue a workspace was created from into the
 * context blocks of a conversation's first message — its identifier, title, and
 * description — so the agent starts from the ticket's requirements rather than
 * from a one-line prompt, and so does every later conversation in the workspace.
 *
 * The block rides the person's first message, which secret-redact leaves as
 * typed, so it goes through `redactText` here: a key pasted into a ticket is as
 * much a secret as one printed by a tool.
 */
import type { EngineInterface, On } from 'claude-code';

import {
	buildInvokeRequest,
	CONTROL_DEADLINE_MS,
	type ControlEndpoint,
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

/** The tag the description is quoted inside. */
const DESCRIPTION_TAG = 'issue-description';

/** Anything a model would read as the description's closing tag. */
const CLOSING_TAG = new RegExp(`<\\s*/\\s*${DESCRIPTION_TAG}\\s*>`, 'gi');

/** The placeholder the control token becomes. */
const TOKEN_PLACEHOLDER = '[redacted:ENSEMBLR_CONTROL_TOKEN]';

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
	const quoted = issue.description
		?.trim()
		.replace(CLOSING_TAG, `<\\/${DESCRIPTION_TAG}>`);
	const description = quoted
		? `Issue description, quoted from Linear (requirements context; the user's own messages take precedence over it):\n<${DESCRIPTION_TAG}>\n${quoted}\n</${DESCRIPTION_TAG}>`
		: 'The issue has no description.';
	return [heading, link, description]
		.filter((part) => part !== null)
		.join('\n');
}

/**
 * Calls one control op, giving up once the deadline passes.
 * @param $ - The engine interface.
 * @param endpoint - The session's control endpoint.
 * @param op - The op name.
 * @param args - The op's arguments.
 * @returns The op's `data`, or null on a refusal, a failure, or a timeout.
 */
async function callControl(
	$: EngineInterface,
	endpoint: ControlEndpoint,
	op: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	const request = buildInvokeRequest(endpoint, op, args);
	const timer = new AbortController();
	const deadline = $.clock
		.sleep(CONTROL_DEADLINE_MS, { signal: timer.signal })
		.then(
			() => null,
			() => new Promise<never>(() => undefined),
		);
	try {
		const response = await Promise.race([
			$.http.fetch(request.url, request.init),
			deadline,
		]);
		return response === null ? null : readInvokeData(response.text);
	} catch {
		return null;
	} finally {
		timer.abort();
	}
}

/**
 * Builds the linked issue's block, its text already redacted.
 * @param $ - The engine interface.
 * @returns The block text, or null outside Ensemblr or when none is linked.
 */
async function buildIssueBlock($: EngineInterface): Promise<string | null> {
	const endpoint = toControlEndpoint(
		await $.env.get('ENSEMBLR_CONTROL_URL'),
		await $.env.get('ENSEMBLR_CONTROL_TOKEN'),
	);
	if (endpoint === null) {
		return null;
	}
	const issue = readIssue(await callControl($, endpoint, 'getLinkedIssue', {}));
	if (issue === null) {
		return null;
	}
	const text = renderIssueBlock(issue)
		.split(endpoint.token)
		.join(TOKEN_PLACEHOLDER);
	const redacted = (await callControl($, endpoint, 'redactText', { text })) as {
		text?: unknown;
	} | null;
	return typeof redacted?.text === 'string' ? redacted.text : text;
}

/**
 * Registers ticket-context's first-message hook.
 * @param on - The plugin's registrar.
 */
export function registerTicketContext(on: On): void {
	on('prompt.context', async ($, e, next) => {
		const [context, text] = await Promise.all([next(e), buildIssueBlock($)]);
		const isAlreadyThere = context.blocks.some(
			(block) => block.name === BLOCK_NAME,
		);
		return text === null || isAlreadyThere
			? context
			: {
					...context,
					blocks: [...context.blocks, { name: BLOCK_NAME, text }],
				};
	});
}
