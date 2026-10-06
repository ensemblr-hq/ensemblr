/**
 * secret-redact: replaces the exact values of this workspace's secrets — its
 * Infisical secrets, its Keychain environment rows, and the control tokens the
 * app minted — with `[redacted:NAME]` in every row the conversation keeps,
 * before the model reads it, the transcript stores it, or Ensemblr draws it.
 *
 * The values never reach this module. Ensemblr matches them in its own process
 * (`redactText` over the control server) and answers with the redacted text, so
 * there is no file, variable, or reply here that would hand the model a secret
 * it could otherwise not see. The session's own control token is the one value
 * this module holds — the model's environment already carries it — and it is
 * replaced locally too, so it stays hidden even while the app is unreachable.
 *
 * Rows are rewritten at `session.append`, the one place every row passes, so a
 * secret is caught whichever tool, attachment, or delivery carried it. The
 * person's own prompt and slash commands are left as typed: a value they paste
 * on purpose is theirs to hand the model.
 */
import type { EngineInterface, On } from 'claude-code';

import {
	buildInvokeRequest,
	type ControlEndpoint,
	readInvokeData,
	toControlEndpoint,
} from './control.ts';
import {
	createTextRedactor,
	redactBlocks,
	type TextRedactor,
} from './row-redaction.ts';

/** The doors whose rows the person typed, which are never rewritten. */
const PERSON_DOORS = new Set(['prompt', 'command']);

/** The placeholder the control token becomes. */
const TOKEN_PLACEHOLDER = '[redacted:ENSEMBLR_CONTROL_TOKEN]';

/**
 * Reads the control endpoint Ensemblr injected into this session.
 * @param $ - The engine interface.
 * @returns The endpoint, or null outside an Ensemblr session.
 */
async function readEndpoint(
	$: EngineInterface,
): Promise<ControlEndpoint | null> {
	return toControlEndpoint(
		await $.env.get('ENSEMBLR_CONTROL_URL'),
		await $.env.get('ENSEMBLR_CONTROL_TOKEN'),
	);
}

/**
 * Has the app redact one piece of text against the workspace's secrets.
 * @param $ - The engine interface.
 * @param endpoint - The session's control endpoint.
 * @param piece - Text within the op's size limit.
 * @returns The redacted text, or the piece unchanged when the app did not answer.
 */
async function redactRemotely(
	$: EngineInterface,
	endpoint: ControlEndpoint,
	piece: string,
): Promise<string> {
	const request = buildInvokeRequest(endpoint, 'redactText', { text: piece });
	try {
		const response = await $.http.fetch(request.url, request.init);
		const data = readInvokeData(response.text) as { text?: unknown } | null;
		return typeof data?.text === 'string' ? data.text : piece;
	} catch {
		return piece;
	}
}

/**
 * Builds this session's text redactor, or null outside Ensemblr.
 * @param $ - The engine interface.
 * @returns The redactor.
 */
async function createSessionRedactor(
	$: EngineInterface,
): Promise<TextRedactor | null> {
	const endpoint = await readEndpoint($);
	return endpoint === null
		? null
		: createTextRedactor(endpoint.token, TOKEN_PLACEHOLDER, (piece) =>
				redactRemotely($, endpoint, piece),
			);
}

/**
 * Registers secret-redact's row hook.
 * @param on - The plugin's registrar.
 */
export function registerSecretRedact(on: On): void {
	on('session.append', async ($, e, next) => {
		const redact = PERSON_DOORS.has(e.door)
			? null
			: await createSessionRedactor($);
		if (redact === null) {
			return next(e);
		}
		const content = await redactBlocks(e.message.content, redact);
		return content === e.message.content
			? next(e)
			: next({ ...e, message: { ...e.message, content: [...content] } });
	});
}
