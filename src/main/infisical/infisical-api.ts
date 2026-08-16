import type { InfisicalFailureCode } from '../../shared/ipc/contracts/infisical';

const LOGIN_PATH = '/api/v1/auth/universal-auth/login';
const PROJECTS_PATH = '/api/v1/projects';
const SECRETS_PATH = '/api/v3/secrets/raw';

/** Default Infisical Cloud region. EU users and self-hosters override it per account. */
export const DEFAULT_INFISICAL_SITE_URL = 'https://app.infisical.com';

/** Typed error thrown by every raw Infisical API call. */
export class InfisicalApiError extends Error {
	readonly code: InfisicalFailureCode;
	readonly retryAfterSeconds: number | null;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable description kept for logs and diagnostics.
	 * @param options - Optional retry hint and underlying cause.
	 */
	constructor(
		code: InfisicalFailureCode,
		message: string,
		options: { cause?: unknown; retryAfterSeconds?: number | null } = {},
	) {
		super(message, { cause: options.cause });
		this.name = 'InfisicalApiError';
		this.code = code;
		this.retryAfterSeconds = options.retryAfterSeconds ?? null;
	}
}

/** A short-lived Universal Auth access token and the epoch millisecond it expires at. */
export interface InfisicalAccessToken {
	expiresAtMs: number;
	token: string;
}

/** One environment of a project as returned by the projects endpoint. */
export interface InfisicalEnvironmentData {
	name: string;
	slug: string;
}

/** One project the authenticated identity can reach, with its environments inlined. */
export interface InfisicalProjectData {
	environments: InfisicalEnvironmentData[];
	id: string;
	name: string;
	slug: string | null;
}

/** One resolved secret. Values are handled as secrets everywhere downstream. */
export interface InfisicalSecretData {
	key: string;
	value: string;
}

/** Query shape for a secret listing, mirroring the raw-secrets endpoint. */
export interface ListInfisicalSecretsQuery {
	environment: string;
	expandSecretReferences?: boolean;
	includeImports?: boolean;
	projectId: string;
	recursive?: boolean;
	secretPath?: string;
}

/** Options for {@link createInfisicalApi}. */
export interface CreateInfisicalApiOptions {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

/** Boundary over the Infisical REST API with typed error mapping. */
export interface InfisicalApiClient {
	listProjects: (input: {
		accessToken: string;
		siteUrl: string;
	}) => Promise<InfisicalProjectData[]>;
	listSecrets: (input: {
		accessToken: string;
		query: ListInfisicalSecretsQuery;
		siteUrl: string;
	}) => Promise<InfisicalSecretData[]>;
	login: (input: {
		clientId: string;
		clientSecret: string;
		siteUrl: string;
	}) => Promise<InfisicalAccessToken>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * Tokens are refreshed this far before their stated expiry so a request already
 * in flight cannot land on a token that expired mid-round-trip.
 */
const TOKEN_EXPIRY_SKEW_MS = 30_000;

/**
 * Normalises a site URL into an origin Ensemblr can build request paths on,
 * rejecting anything that is not an absolute HTTP(S) URL.
 * @param siteUrl - Raw user-entered instance URL.
 * @returns The normalised origin without a trailing slash.
 */
export function normalizeSiteUrl(siteUrl: string): string {
	const trimmed = siteUrl.trim();

	if (!trimmed) {
		return DEFAULT_INFISICAL_SITE_URL;
	}

	let parsed: URL;

	try {
		parsed = new URL(trimmed);
	} catch (error) {
		throw new InfisicalApiError(
			'infisical-invalid-request',
			`"${trimmed}" is not a valid Infisical instance URL.`,
			{ cause: error },
		);
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new InfisicalApiError(
			'infisical-invalid-request',
			'An Infisical instance URL must use http or https.',
		);
	}

	return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Builds the raw Infisical REST boundary. It owns transport, timeouts, and the
 * mapping from HTTP status onto {@link InfisicalFailureCode}; it holds no
 * credentials and no cache of its own.
 * @param options - Optional fetch override and request timeout.
 * @returns A fresh {@link InfisicalApiClient}.
 */
export function createInfisicalApi({
	fetchImpl = fetch,
	timeoutMs = DEFAULT_TIMEOUT_MS,
}: CreateInfisicalApiOptions = {}): InfisicalApiClient {
	/**
	 * Issues one request, mapping transport failures and non-2xx responses onto
	 * typed errors and returning the parsed JSON body.
	 * @param input - Absolute URL, fetch init, and the operation name used in messages.
	 * @returns The parsed JSON body.
	 */
	async function request({
		init,
		operation,
		url,
	}: {
		init: RequestInit;
		operation: string;
		url: string;
	}): Promise<unknown> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		let response: Response;
		let bodyText: string;

		// The deadline has to span the body read too: a server that sends headers
		// and then stalls the stream would otherwise leave the read pending
		// forever, wedging every environment assembly waiting on this scope.
		try {
			response = await fetchImpl(url, { ...init, signal: controller.signal });
			bodyText = await response.text();
		} catch (error) {
			throw new InfisicalApiError(
				'infisical-network',
				`${operation} could not reach Infisical: ${describeError(error)}`,
				{ cause: error },
			);
		} finally {
			clearTimeout(timeout);
		}

		if (!response.ok) {
			throw toApiError({ bodyText, operation, response });
		}

		if (!bodyText) {
			return {};
		}

		try {
			return JSON.parse(bodyText) as unknown;
		} catch (error) {
			throw new InfisicalApiError(
				'infisical-server-error',
				`${operation} returned a response Ensemblr could not parse.`,
				{ cause: error },
			);
		}
	}

	return {
		listProjects: async ({ accessToken, siteUrl }) => {
			const body = await request({
				init: {
					headers: { Authorization: `Bearer ${accessToken}` },
					method: 'GET',
				},
				operation: 'Listing Infisical projects',
				url: `${normalizeSiteUrl(siteUrl)}${PROJECTS_PATH}`,
			});

			return readProjects(body);
		},

		listSecrets: async ({ accessToken, query, siteUrl }) => {
			const params = new URLSearchParams({
				environment: query.environment,
				expandSecretReferences: String(query.expandSecretReferences ?? true),
				include_imports: String(query.includeImports ?? true),
				recursive: String(query.recursive ?? false),
				secretPath: query.secretPath || '/',
				workspaceId: query.projectId,
			});
			const body = await request({
				init: {
					headers: { Authorization: `Bearer ${accessToken}` },
					method: 'GET',
				},
				operation: 'Reading Infisical secrets',
				url: `${normalizeSiteUrl(siteUrl)}${SECRETS_PATH}?${params.toString()}`,
			});

			return readSecrets(body);
		},

		login: async ({ clientId, clientSecret, siteUrl }) => {
			const body = await request({
				init: {
					body: JSON.stringify({ clientId, clientSecret }),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST',
				},
				operation: 'Signing in to Infisical',
				url: `${normalizeSiteUrl(siteUrl)}${LOGIN_PATH}`,
			});

			return readAccessToken(body);
		},
	};
}

/**
 * Maps a non-2xx response onto a typed error, preferring the message Infisical
 * supplies in its JSON error envelope.
 * @param input - Raw body text, operation name, and the response.
 * @returns The error to throw.
 */
function toApiError({
	bodyText,
	operation,
	response,
}: {
	bodyText: string;
	operation: string;
	response: Response;
}): InfisicalApiError {
	const detail = readErrorMessage(bodyText) ?? response.statusText;
	const retryAfterSeconds = readRetryAfter(response);

	return new InfisicalApiError(
		toFailureCode(response.status),
		`${operation} failed (${response.status}): ${detail}`,
		{ retryAfterSeconds },
	);
}

/**
 * Classifies an HTTP status into the failure vocabulary the renderer localizes.
 * @param status - HTTP status code.
 * @returns The matching failure code.
 */
function toFailureCode(status: number): InfisicalFailureCode {
	if (status === 401) {
		return 'infisical-invalid-credentials';
	}

	if (status === 403) {
		return 'infisical-permission-denied';
	}

	if (status === 404) {
		return 'infisical-project-not-found';
	}

	if (status === 429) {
		return 'infisical-rate-limited';
	}

	if (status >= 500) {
		return 'infisical-server-error';
	}

	return 'infisical-invalid-request';
}

/**
 * Extracts Infisical's `message` field from an error body.
 * @param bodyText - Raw response body.
 * @returns The message, or null when the body is not a recognisable envelope.
 */
function readErrorMessage(bodyText: string): string | null {
	if (!bodyText) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(bodyText);

		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			'message' in parsed &&
			typeof parsed.message === 'string'
		) {
			return parsed.message;
		}
	} catch {
		return bodyText.slice(0, 200);
	}

	return null;
}

/**
 * Reads a `Retry-After` header as whole seconds.
 * @param response - The rejected response.
 * @returns The retry hint, or null when absent or unparseable.
 */
function readRetryAfter(response: Response): number | null {
	const header = response.headers.get('retry-after');

	if (!header) {
		return null;
	}

	const seconds = Number.parseInt(header, 10);

	return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Validates a login response and converts its relative TTL into an absolute
 * expiry, held back by a safety margin.
 * @param body - Parsed login response.
 * @returns The access token and its expiry.
 */
function readAccessToken(body: unknown): InfisicalAccessToken {
	if (
		typeof body !== 'object' ||
		body === null ||
		!('accessToken' in body) ||
		typeof body.accessToken !== 'string' ||
		!body.accessToken
	) {
		throw new InfisicalApiError(
			'infisical-server-error',
			'Infisical did not return an access token.',
		);
	}

	const expiresIn =
		'expiresIn' in body && typeof body.expiresIn === 'number'
			? body.expiresIn
			: 0;
	const ttlMs = Math.max(expiresIn * 1000 - TOKEN_EXPIRY_SKEW_MS, 0);

	return { expiresAtMs: Date.now() + ttlMs, token: body.accessToken };
}

/**
 * Validates a projects response, skipping entries that do not carry the id and
 * name a picker needs rather than failing the whole listing.
 * @param body - Parsed projects response.
 * @returns The projects Ensemblr can display.
 */
function readProjects(body: unknown): InfisicalProjectData[] {
	const rawProjects = readArrayField(body, ['workspaces', 'projects']);

	if (!rawProjects) {
		throw new InfisicalApiError(
			'infisical-server-error',
			`Infisical listed projects in a shape Ensemblr could not read: ${describeShape(body)}`,
		);
	}

	const projects: InfisicalProjectData[] = [];

	for (const entry of rawProjects) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}

		const id = readStringField(entry, 'id');
		const name = readStringField(entry, 'name');

		if (!id || !name) {
			continue;
		}

		projects.push({
			environments: readEnvironments(entry),
			id,
			name,
			slug: readStringField(entry, 'slug'),
		});
	}

	return projects;
}

/**
 * Reads the environments inlined on a project entry.
 * @param project - One raw project object.
 * @returns Its environments, empty when the field is missing or malformed.
 */
function readEnvironments(project: object): InfisicalEnvironmentData[] {
	if (!('environments' in project) || !Array.isArray(project.environments)) {
		return [];
	}

	const environments: InfisicalEnvironmentData[] = [];

	for (const entry of project.environments) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}

		const slug = readStringField(entry, 'slug');

		if (!slug) {
			continue;
		}

		environments.push({ name: readStringField(entry, 'name') ?? slug, slug });
	}

	return environments;
}

/**
 * Validates a raw-secrets response, keeping only entries with a usable key.
 * @param body - Parsed secrets response.
 * @returns The resolved secrets.
 */
function readSecrets(body: unknown): InfisicalSecretData[] {
	const rawSecrets = readArrayField(body, ['secrets']);

	if (!rawSecrets) {
		throw new InfisicalApiError(
			'infisical-server-error',
			`Infisical returned secrets in a shape Ensemblr could not read: ${describeShape(body)}`,
		);
	}

	const secrets: InfisicalSecretData[] = [];

	for (const entry of rawSecrets) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}

		const key = readStringField(entry, 'secretKey');

		if (!key) {
			continue;
		}

		secrets.push({ key, value: readStringField(entry, 'secretValue') ?? '' });
	}

	return secrets;
}

/**
 * Reads the first array-valued field present under any of the candidate names,
 * so one parser survives Infisical's `workspaces`/`projects` naming.
 *
 * Returns `null` when no candidate field exists at all, which the callers treat
 * as a response they could not read — distinct from a field that is present and
 * empty, which is a legitimate "you have none".
 * @param body - Parsed response body.
 * @param fieldNames - Candidate field names, in preference order.
 * @returns The array, or null when no candidate field is present.
 */
function readArrayField(body: unknown, fieldNames: string[]): unknown[] | null {
	if (Array.isArray(body)) {
		return body;
	}

	if (typeof body !== 'object' || body === null) {
		return null;
	}

	for (const fieldName of fieldNames) {
		const value = (body as Record<string, unknown>)[fieldName];

		if (Array.isArray(value)) {
			return value;
		}
	}

	return null;
}

/**
 * Reads a non-empty string field off a raw object.
 * @param source - Raw object.
 * @param fieldName - Field to read.
 * @returns The trimmed value, or null when absent, non-string, or empty.
 */
function readStringField(source: object, fieldName: string): string | null {
	const value = (source as Record<string, unknown>)[fieldName];

	if (typeof value !== 'string') {
		return null;
	}

	return value || null;
}

/**
 * Names the top-level fields a response carried, so a shape Ensemblr cannot read
 * is diagnosable from the message alone without logging any secret value.
 * @param body - Parsed response body.
 * @returns A short description of the response's shape.
 */
function describeShape(body: unknown): string {
	if (Array.isArray(body)) {
		return 'a bare array';
	}

	if (typeof body !== 'object' || body === null) {
		return typeof body;
	}

	const fields = Object.keys(body);

	return fields.length
		? `an object with ${fields.join(', ')}`
		: 'an empty object';
}

/**
 * Renders a thrown transport value as a short message.
 * @param error - Thrown value.
 * @returns A description safe to embed in an error message.
 */
function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.name === 'AbortError'
			? 'the request timed out'
			: error.message;
	}

	return String(error);
}
