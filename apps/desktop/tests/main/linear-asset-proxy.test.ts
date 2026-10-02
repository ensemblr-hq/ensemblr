import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLinearAssetProxy } from '@/main/linear/linear-asset-proxy';
import { LINEAR_ASSET_SCHEME } from '@/shared/linear-assets';

const ACCOUNT_ID = '1ef5f628-0386-40d3-8ab1-fded1e0989bb';
const ASSET_PATH = '/workspace-a/issue-b/asset-c.png';
const PROXY_URL = `${LINEAR_ASSET_SCHEME}://${ACCOUNT_ID}${ASSET_PATH}`;
const UPSTREAM_URL = `https://uploads.linear.app${ASSET_PATH}`;

const imageResponse = (body = 'png-bytes') =>
	new Response(body, {
		headers: { 'content-type': 'image/png' },
		status: 200,
	});

const buildProxy = (
	fetchImpl: typeof fetch,
	overrides: {
		getAccessToken?: () => Promise<string>;
		maxAssetBytes?: number;
	} = {},
) =>
	createLinearAssetProxy({
		fetchImpl,
		getAccessToken: overrides.getAccessToken ?? (async () => 'token-123'),
		listAccountIds: async () => [ACCOUNT_ID],
		maxAssetBytes: overrides.maxAssetBytes,
	});

describe('createLinearAssetProxy', () => {
	let fetchImpl: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchImpl = vi.fn(async () => imageResponse());
	});

	it('resolves the asset with the account bearer token', async () => {
		const response = await buildProxy(
			fetchImpl as unknown as typeof fetch,
		).fetch(PROXY_URL);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(await response.text()).toBe('png-bytes');
		expect(fetchImpl).toHaveBeenCalledTimes(1);

		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];

		expect(url).toBe(UPSTREAM_URL);
		expect((init.headers as Record<string, string>).authorization).toBe(
			'Bearer token-123',
		);
	});

	it('serves a repeat read from cache rather than refetching', async () => {
		const proxy = buildProxy(fetchImpl as unknown as typeof fetch);

		await proxy.fetch(PROXY_URL);
		const second = await proxy.fetch(PROXY_URL);

		expect(await second.text()).toBe('png-bytes');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('collapses concurrent reads of the same asset into one fetch', async () => {
		const proxy = buildProxy(fetchImpl as unknown as typeof fetch);

		await Promise.all([proxy.fetch(PROXY_URL), proxy.fetch(PROXY_URL)]);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('refuses an account that is not connected', async () => {
		const response = await buildProxy(
			fetchImpl as unknown as typeof fetch,
		).fetch(
			`${LINEAR_ASSET_SCHEME}://11111111-2222-3333-4444-555555555555/a/b`,
		);

		expect(response.status).toBe(404);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('refuses a URL this scheme does not serve', async () => {
		const response = await buildProxy(
			fetchImpl as unknown as typeof fetch,
		).fetch('https://uploads.linear.app/a/b/c');

		expect(response.status).toBe(400);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('refuses to serve a non-image body from the privileged scheme', async () => {
		const html = vi.fn(
			async () =>
				new Response('<script>alert(1)</script>', {
					headers: { 'content-type': 'text/html' },
					status: 200,
				}),
		);

		const response = await buildProxy(html as unknown as typeof fetch).fetch(
			PROXY_URL,
		);

		expect(response.status).toBe(415);
	});

	it('reports the upstream status when Linear rejects the read', async () => {
		const denied = vi.fn(async () => new Response(null, { status: 403 }));

		const response = await buildProxy(denied as unknown as typeof fetch).fetch(
			PROXY_URL,
		);

		expect(response.status).toBe(403);
	});

	it('reports a token failure without reaching the network', async () => {
		const response = await buildProxy(fetchImpl as unknown as typeof fetch, {
			getAccessToken: async () => {
				throw new Error('reconnect required');
			},
		}).fetch(PROXY_URL);

		expect(response.status).toBe(401);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('refuses an asset whose declared length exceeds the ceiling', async () => {
		const huge = vi.fn(
			async () =>
				new Response('png-bytes', {
					headers: { 'content-length': '999999', 'content-type': 'image/png' },
					status: 200,
				}),
		);

		const response = await buildProxy(huge as unknown as typeof fetch, {
			maxAssetBytes: 4,
		}).fetch(PROXY_URL);

		expect(response.status).toBe(413);
	});

	it('refuses an asset whose bytes exceed the ceiling', async () => {
		const response = await buildProxy(fetchImpl as unknown as typeof fetch, {
			maxAssetBytes: 4,
		}).fetch(PROXY_URL);

		expect(response.status).toBe(413);
	});

	it('forgets an account so a later read goes back to Linear', async () => {
		const proxy = buildProxy(fetchImpl as unknown as typeof fetch);

		await proxy.fetch(PROXY_URL);
		proxy.forgetAccount(ACCOUNT_ID);
		await proxy.fetch(PROXY_URL);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('drops a read that was in flight when the account was forgotten', async () => {
		let release = (_: Response) => {};
		const pending = new Promise<Response>((resolve) => {
			release = resolve;
		});
		let reads = 0;
		const slow = vi.fn(async () => {
			reads += 1;
			return reads === 1 ? pending : imageResponse();
		});
		const proxy = buildProxy(slow as unknown as typeof fetch);

		const started = proxy.fetch(PROXY_URL);
		await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
		proxy.forgetAccount(ACCOUNT_ID);
		release(imageResponse());
		await started;
		await proxy.fetch(PROXY_URL);

		expect(slow).toHaveBeenCalledTimes(2);
	});

	it('reports a transport failure as a bad gateway', async () => {
		const offline = vi.fn(async () => {
			throw new Error('ENETUNREACH');
		});

		const response = await buildProxy(offline as unknown as typeof fetch).fetch(
			PROXY_URL,
		);

		expect(response.status).toBe(502);
	});
});
