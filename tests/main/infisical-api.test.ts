import { describe, expect, test, vi } from 'vitest';

import {
	createInfisicalApi,
	InfisicalApiError,
	normalizeSiteUrl,
} from '../../src/main/infisical/infisical-api';

/** Builds a fetch stub that answers every call with one canned response. */
function stubFetch(response: {
	body?: unknown;
	headers?: Record<string, string>;
	status?: number;
}) {
	return vi.fn(
		async (_url: string, _init?: RequestInit) =>
			new Response(
				response.body === undefined ? '' : JSON.stringify(response.body),
				{ headers: response.headers, status: response.status ?? 200 },
			),
	);
}

describe('normalizeSiteUrl', () => {
	test('strips a trailing slash and keeps the origin', () => {
		expect(normalizeSiteUrl('https://app.infisical.com/')).toBe(
			'https://app.infisical.com',
		);
	});

	test('falls back to Infisical Cloud when the value is blank', () => {
		expect(normalizeSiteUrl('   ')).toBe('https://app.infisical.com');
	});

	test('rejects a non-HTTP scheme', () => {
		expect(() => normalizeSiteUrl('ftp://infisical.example.com')).toThrow(
			InfisicalApiError,
		);
	});

	test('rejects an unparseable URL', () => {
		expect(() => normalizeSiteUrl('not a url')).toThrow(InfisicalApiError);
	});
});

describe('createInfisicalApi.login', () => {
	test('converts the relative TTL into an absolute expiry held back by a margin', async () => {
		const fetchImpl = stubFetch({
			body: { accessToken: 'tok', expiresIn: 7200 },
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		const before = Date.now();
		const token = await api.login({
			clientId: 'id',
			clientSecret: 'secret',
			siteUrl: 'https://app.infisical.com',
		});

		expect(token.token).toBe('tok');
		// 7200s minus the 30s skew, so it must land short of the raw TTL.
		expect(token.expiresAtMs).toBeGreaterThan(before);
		expect(token.expiresAtMs).toBeLessThan(before + 7200 * 1000);
	});

	test('posts to the universal-auth login path', async () => {
		const fetchImpl = stubFetch({
			body: { accessToken: 'tok', expiresIn: 60 },
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await api.login({
			clientId: 'id',
			clientSecret: 'secret',
			siteUrl: 'https://eu.infisical.com',
		});

		expect(fetchImpl.mock.calls[0]?.[0]).toBe(
			'https://eu.infisical.com/api/v1/auth/universal-auth/login',
		);
	});

	test('maps a 401 onto invalid-credentials', async () => {
		const fetchImpl = stubFetch({
			body: { message: 'Invalid credentials' },
			status: 401,
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.login({
				clientId: 'id',
				clientSecret: 'wrong',
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toMatchObject({ code: 'infisical-invalid-credentials' });
	});

	test('rejects a 200 that carries no access token', async () => {
		const fetchImpl = stubFetch({ body: { expiresIn: 60 } });
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.login({
				clientId: 'id',
				clientSecret: 'secret',
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toMatchObject({ code: 'infisical-server-error' });
	});

	test('maps a transport failure onto a network error', async () => {
		const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
			throw new Error('socket hang up');
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.login({
				clientId: 'id',
				clientSecret: 'secret',
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toMatchObject({ code: 'infisical-network' });
	});

	test('times out a response whose body never arrives', async () => {
		const fetchImpl = vi.fn(
			async (_url: string, init?: RequestInit) =>
				new Response(
					new ReadableStream({
						/**
						 * Streams headers and then nothing, standing in for a server that
						 * stalls mid-body. Only the request signal ends it.
						 * @param controller - Stream controller for the stalled body.
						 */
						start(controller) {
							init?.signal?.addEventListener('abort', () =>
								controller.error(
									Object.assign(new Error('aborted'), { name: 'AbortError' }),
								),
							);
						},
					}),
				),
		);
		const api = createInfisicalApi({
			fetchImpl: fetchImpl as never,
			timeoutMs: 20,
		});

		await expect(
			api.login({
				clientId: 'id',
				clientSecret: 'secret',
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toMatchObject({ code: 'infisical-network' });
	});

	test('reads the retry hint off a 429', async () => {
		const fetchImpl = stubFetch({
			body: { message: 'slow down' },
			headers: { 'retry-after': '17' },
			status: 429,
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.login({
				clientId: 'id',
				clientSecret: 'secret',
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toMatchObject({
			code: 'infisical-rate-limited',
			retryAfterSeconds: 17,
		});
	});
});

describe('createInfisicalApi.listProjects', () => {
	test('reads projects with their inlined environments', async () => {
		const fetchImpl = stubFetch({
			body: {
				projects: [
					{
						environments: [
							{ name: 'Development', slug: 'dev' },
							{ name: 'Production', slug: 'prod' },
						],
						id: 'proj_1',
						name: 'Backend',
						slug: 'backend',
					},
				],
			},
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		const projects = await api.listProjects({
			accessToken: 'tok',
			siteUrl: 'https://app.infisical.com',
		});

		expect(projects).toEqual([
			{
				environments: [
					{ name: 'Development', slug: 'dev' },
					{ name: 'Production', slug: 'prod' },
				],
				id: 'proj_1',
				name: 'Backend',
				slug: 'backend',
			},
		]);
	});

	test('accepts the legacy `workspaces` field name', async () => {
		const fetchImpl = stubFetch({
			body: { workspaces: [{ id: 'proj_1', name: 'Backend' }] },
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		const projects = await api.listProjects({
			accessToken: 'tok',
			siteUrl: 'https://app.infisical.com',
		});

		expect(projects).toHaveLength(1);
		expect(projects[0]?.environments).toEqual([]);
	});

	// An empty picker is ambiguous, so a body with no recognisable projects field
	// must fail loudly rather than read as "you have no projects".
	test('rejects a response shape it cannot read', async () => {
		const fetchImpl = stubFetch({ body: { data: { items: [] } } });
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.listProjects({
				accessToken: 'tok',
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toMatchObject({ code: 'infisical-server-error' });
	});

	test('names the fields it did see, so the shape is diagnosable', async () => {
		const fetchImpl = stubFetch({ body: { data: [], total: 0 } });
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.listProjects({
				accessToken: 'tok',
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toThrow(/data, total/);
	});

	test('reports a genuinely empty project list as zero, not as an error', async () => {
		const fetchImpl = stubFetch({ body: { projects: [] } });
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.listProjects({
				accessToken: 'tok',
				siteUrl: 'https://app.infisical.com',
			}),
		).resolves.toEqual([]);
	});

	test('skips entries missing the id or name a picker needs', async () => {
		const fetchImpl = stubFetch({
			body: {
				projects: [
					{ id: 'proj_1', name: 'Backend' },
					{ id: 'proj_2' },
					{ name: 'No id' },
					'garbage',
				],
			},
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		const projects = await api.listProjects({
			accessToken: 'tok',
			siteUrl: 'https://app.infisical.com',
		});

		expect(projects.map((project) => project.id)).toEqual(['proj_1']);
	});
});

describe('createInfisicalApi.listSecrets', () => {
	test('sends the project, environment, path, and recursive flags', async () => {
		const fetchImpl = stubFetch({ body: { secrets: [] } });
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await api.listSecrets({
			accessToken: 'tok',
			query: {
				environment: 'dev',
				projectId: 'proj_1',
				recursive: true,
				secretPath: '/backend',
			},
			siteUrl: 'https://app.infisical.com',
		});

		const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));

		expect(url.pathname).toBe('/api/v3/secrets/raw');
		expect(url.searchParams.get('workspaceId')).toBe('proj_1');
		expect(url.searchParams.get('environment')).toBe('dev');
		expect(url.searchParams.get('secretPath')).toBe('/backend');
		expect(url.searchParams.get('recursive')).toBe('true');
	});

	test('defaults the secret path to the environment root', async () => {
		const fetchImpl = stubFetch({ body: { secrets: [] } });
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await api.listSecrets({
			accessToken: 'tok',
			query: { environment: 'dev', projectId: 'proj_1' },
			siteUrl: 'https://app.infisical.com',
		});

		expect(
			new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get(
				'secretPath',
			),
		).toBe('/');
	});

	test('keeps a secret whose value is an empty string', async () => {
		const fetchImpl = stubFetch({
			body: {
				secrets: [
					{ secretKey: 'DATABASE_URL', secretValue: 'postgres://x' },
					{ secretKey: 'EMPTY_ON_PURPOSE', secretValue: '' },
					{ secretValue: 'no key' },
				],
			},
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		const secrets = await api.listSecrets({
			accessToken: 'tok',
			query: { environment: 'dev', projectId: 'proj_1' },
			siteUrl: 'https://app.infisical.com',
		});

		expect(secrets).toEqual([
			{ key: 'DATABASE_URL', value: 'postgres://x' },
			{ key: 'EMPTY_ON_PURPOSE', value: '' },
		]);
	});

	test('rejects a secrets response shape it cannot read', async () => {
		const fetchImpl = stubFetch({ body: { data: {} } });
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.listSecrets({
				accessToken: 'tok',
				query: { environment: 'dev', projectId: 'proj_1' },
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toMatchObject({ code: 'infisical-server-error' });
	});

	test('maps a 403 onto permission-denied', async () => {
		const fetchImpl = stubFetch({
			body: { message: 'forbidden' },
			status: 403,
		});
		const api = createInfisicalApi({ fetchImpl: fetchImpl as never });

		await expect(
			api.listSecrets({
				accessToken: 'tok',
				query: { environment: 'dev', projectId: 'proj_1' },
				siteUrl: 'https://app.infisical.com',
			}),
		).rejects.toMatchObject({ code: 'infisical-permission-denied' });
	});
});
