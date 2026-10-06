/**
 * secret-redact: replaces the exact values of this workspace's secrets — its
 * Infisical secrets, its Keychain environment rows, and the control tokens the
 * app minted — with `[redacted:NAME]` in every row the conversation keeps,
 * before the model reads it or the next request sends it. A tool's structured
 * record beside its result is stored as the tool made it, so the transcript
 * file and a host drawing from that record can still show the raw output.
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
 * on purpose is theirs to hand the model. When the app does not answer within
 * {@link CONTROL_DEADLINE_MS}, the row goes on with the local pass alone:
 * holding the session hostage to a slow main process is the worse failure.
 */
import type { EngineInterface, HttpResponse, On } from 'claude-code';

import {
	buildInvokeRequest,
	CONTROL_DEADLINE_MS,
	type ControlEndpoint,
	NEVER_SETTLES,
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
 * Calls the app, giving up once the deadline passes.
 * @param $ - The engine interface.
 * @param request - The request to send.
 * @returns The response, or null on a failure or a timeout.
 */
async function fetchWithinDeadline(
	$: EngineInterface,
	request: ReturnType<typeof buildInvokeRequest>,
): Promise<HttpResponse | null> {
	const timer = new AbortController();
	const deadline = $.clock
		.sleep(CONTROL_DEADLINE_MS, { signal: timer.signal })
		.then(
			() => null,
			() => NEVER_SETTLES,
		);
	try {
		return await Promise.race([
			$.http.fetch(request.url, request.init),
			deadline,
		]);
	} catch {
		return null;
	} finally {
		timer.abort();
	}
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
	const response = await fetchWithinDeadline($, request);
	const data = (response === null ? null : readInvokeData(response.text)) as {
		text?: unknown;
	} | null;
	return typeof data?.text === 'string' ? data.text : piece;
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
