import { createHash, randomBytes } from 'node:crypto';

/** Linear OAuth authorization endpoint opened in the user's browser. */
export const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
/** Linear OAuth token endpoint used for code exchange and refresh. */
export const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
/** Linear OAuth revocation endpoint used on disconnect. */
export const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke';
/** Default OAuth scopes requested when the config does not override them. */
export const DEFAULT_LINEAR_SCOPES: readonly string[] = ['read', 'write'];
/**
 * Client id of the Linear OAuth application bundled with Ensemblr so users can
 * connect without registering their own app. PKCE-only public client — no
 * client secret ships with the build. `app.linear.clientId` in the Ensemblr
 * config always overrides it; empty until the shared app is registered.
 */
export const BUILT_IN_LINEAR_CLIENT_ID = '0206138b2824f086f7e5ec80288a7501';

/** PKCE verifier/challenge pair (RFC 7636, S256). */
export interface PkcePair {
	challenge: string;
	verifier: string;
}

/** Options for {@link buildLinearAuthorizeUrl}. */
interface BuildAuthorizeUrlOptions {
	challenge: string;
	clientId: string;
	redirectUri: string;
	scopes: readonly string[];
	state: string;
}

/** Outcome of validating an OAuth callback request against the pending login. */
export type OauthCallbackParseResult =
	| { code: string; ok: true }
	| {
			description: string;
			error: 'missing-code' | 'provider-error' | 'state-mismatch';
			ok: false;
	  };

/**
 * Generates a fresh PKCE verifier and its S256 challenge.
 * @returns A {@link PkcePair} with base64url-encoded values.
 */
export function createPkcePair(): PkcePair {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');

	return { challenge, verifier };
}

/**
 * Generates an unguessable OAuth `state` value for CSRF protection.
 * @returns A base64url-encoded random string.
 */
export function createOauthState(): string {
	return randomBytes(24).toString('base64url');
}

/**
 * Builds the Linear authorization URL for the browser-based consent step.
 * @param options - Client, redirect, scope, state, and PKCE challenge inputs.
 * @returns The fully-encoded authorize URL.
 */
export function buildLinearAuthorizeUrl({
	challenge,
	clientId,
	redirectUri,
	scopes,
	state,
}: BuildAuthorizeUrlOptions): string {
	const url = new URL(LINEAR_AUTHORIZE_URL);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', scopes.join(','));
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('prompt', 'consent');

	return url.toString();
}

/**
 * Validates the OAuth callback query against the expected `state` and extracts
 * the authorization code.
 * @param options - Callback search params plus the state issued at login start.
 * @returns A {@link OauthCallbackParseResult}; never throws.
 */
export function parseOauthCallback({
	expectedState,
	searchParams,
}: {
	expectedState: string;
	searchParams: URLSearchParams;
}): OauthCallbackParseResult {
	const providerError = searchParams.get('error');

	if (providerError) {
		return {
			description:
				searchParams.get('error_description') ??
				`Linear returned OAuth error "${providerError}".`,
			error: 'provider-error',
			ok: false,
		};
	}

	if (searchParams.get('state') !== expectedState) {
		return {
			description:
				'The OAuth callback state did not match the pending login request.',
			error: 'state-mismatch',
			ok: false,
		};
	}

	const code = searchParams.get('code');

	if (!code) {
		return {
			description: 'The OAuth callback did not include an authorization code.',
			error: 'missing-code',
			ok: false,
		};
	}

	return { code, ok: true };
}
