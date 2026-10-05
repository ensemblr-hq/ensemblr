import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLinearClient,
	LinearServiceError,
} from '../../src/main/linear/linear-client.ts';

interface RecordedRequest {
	body: Record<string, unknown>;
	headers: Record<string, string>;
}

function createClientFixture(
	respond: (request: RecordedRequest) => Response | Promise<Response>,
) {
	const requests: RecordedRequest[] = [];

	const fetchImpl = (async (
		_input: string | URL | Request,
		init?: RequestInit,
	) => {
		const request: RecordedRequest = {
			body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
			headers: Object.fromEntries(
				Object.entries((init?.headers ?? {}) as Record<string, string>),
			),
		};
		requests.push(request);

		return respond(request);
	}) as typeof fetch;

	const client = createLinearClient({
		fetchImpl,
		getAccessToken: async () => 'token-1',
		retryDelayMs: 0,
	});

	return { client, requests };
}

const ISSUE_NODE = {
	archivedAt: null,
	assignee: null,
	cycle: null,
	description: 'Body',
	dueDate: null,
	id: 'issue-1',
	identifier: 'ENG-1',
	labels: { nodes: [] },
	priority: 2,
	project: null,
	state: { color: '#aaa', id: 'state-1', name: 'Todo', type: 'unstarted' },
	team: { id: 'team-1', key: 'THE', name: 'Theatre' },
	title: 'First issue',
	updatedAt: '2026-06-11T00:00:00.000Z',
	url: 'https://linear.app/x/issue/ENG-1',
};

async function expectServiceError(
	operation: Promise<unknown>,
	expectations: (error: LinearServiceError) => void,
): Promise<void> {
	await assert.rejects(operation, (error: unknown) => {
		assert.ok(error instanceof LinearServiceError);
		expectations(error);
		return true;
	});
}

test('execute: maps HTTP 400 RATELIMITED GraphQL errors to rate-limited', async () => {
	const { client } = createClientFixture(() =>
		Response.json(
			{
				errors: [
					{
						extensions: { code: 'RATELIMITED', retryAfter: 42 },
						message: 'Rate limit exceeded',
					},
				],
			},
			{ status: 400 },
		),
	);

	await expectServiceError(client.listIssues(), (error) => {
		assert.strictEqual(error.code, 'rate-limited');
		assert.strictEqual(error.retryAfterSeconds, 42);
	});
});

test('execute: preserves validation messages from HTTP 400 GraphQL errors', async () => {
	const { client } = createClientFixture(() =>
		Response.json(
			{
				errors: [
					{
						extensions: { code: 'INVALID_INPUT' },
						message: 'Argument "teamId" is invalid.',
					},
				],
			},
			{ status: 400 },
		),
	);

	await expectServiceError(
		client.createIssue({ teamId: 'nope', title: 'x' }),
		(error) => {
			assert.strictEqual(error.code, 'invalid-request');
			assert.match(error.message, /teamId/);
		},
	);
});

test('execute: maps authentication GraphQL errors to reconnect-required', async () => {
	const { client } = createClientFixture(() =>
		Response.json({
			errors: [
				{
					extensions: { type: 'AuthenticationError' },
					message: 'Authentication required',
				},
			],
		}),
	);

	await expectServiceError(client.listIssues(), (error) => {
		assert.strictEqual(error.code, 'reconnect-required');
	});
});

test('execute: maps HTTP 401 to reconnect-required', async () => {
	const { client } = createClientFixture(
		() => new Response('Unauthorized', { status: 401 }),
	);

	await expectServiceError(client.listIssues(), (error) => {
		assert.strictEqual(error.code, 'reconnect-required');
	});
});

test('execute: maps HTTP 429 with Retry-After to rate-limited', async () => {
	const { client } = createClientFixture(
		() =>
			new Response('Too many requests', {
				headers: { 'retry-after': '17' },
				status: 429,
			}),
	);

	await expectServiceError(client.listIssues(), (error) => {
		assert.strictEqual(error.code, 'rate-limited');
		assert.strictEqual(error.retryAfterSeconds, 17);
	});
});

test('execute: maps non-JSON HTTP failures to network errors', async () => {
	const { client, requests } = createClientFixture(
		() => new Response('<html>bad gateway</html>', { status: 502 }),
	);

	await expectServiceError(client.listIssues(), (error) => {
		assert.strictEqual(error.code, 'network');
		assert.match(error.message, /502/);
	});
	assert.strictEqual(requests.length, 2);
});

const EMPTY_ISSUES_PAGE = {
	data: {
		issues: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
	},
};

test('execute: retries a read once after the connection fails', async () => {
	let attempts = 0;
	const { client, requests } = createClientFixture(() => {
		attempts += 1;

		if (attempts === 1) {
			throw new TypeError('fetch failed');
		}

		return Response.json(EMPTY_ISSUES_PAGE);
	});

	const page = await client.listIssues();

	assert.deepStrictEqual(page.nodes, []);
	assert.strictEqual(requests.length, 2);
});

test('execute: retries a read once after a gateway error', async () => {
	let attempts = 0;
	const { client, requests } = createClientFixture(() => {
		attempts += 1;

		return attempts === 1
			? new Response('upstream', { status: 503 })
			: Response.json(EMPTY_ISSUES_PAGE);
	});

	const page = await client.listIssues();

	assert.deepStrictEqual(page.nodes, []);
	assert.strictEqual(requests.length, 2);
});

test('execute: reports a read that fails twice as unreachable', async () => {
	const { client, requests } = createClientFixture(() => {
		throw new TypeError('fetch failed');
	});

	await expectServiceError(client.listIssues(), (error) => {
		assert.strictEqual(error.code, 'network');
		assert.match(error.message, /Could not reach/);
	});
	assert.strictEqual(requests.length, 2);
});

test('execute: never repeats a mutation whose connection failed', async () => {
	const { client, requests } = createClientFixture(() => {
		throw new TypeError('fetch failed');
	});

	await expectServiceError(
		client.createComment({ body: 'Hello', issueId: 'issue-1' }),
		(error) => assert.strictEqual(error.code, 'network'),
	);
	assert.strictEqual(requests.length, 1);
});

test('execute: does not retry a rate-limited read', async () => {
	const { client, requests } = createClientFixture(
		() =>
			new Response('', {
				headers: { 'retry-after': '5' },
				status: 429,
			}),
	);

	await expectServiceError(client.listIssues(), (error) => {
		assert.strictEqual(error.code, 'rate-limited');
	});
	assert.strictEqual(requests.length, 1);
});

test('listIssues: sends bearer auth and the team filter, maps nodes', async () => {
	const { client, requests } = createClientFixture(() =>
		Response.json({
			data: {
				issues: {
					nodes: [ISSUE_NODE],
					pageInfo: { endCursor: 'cursor-1', hasNextPage: true },
				},
			},
		}),
	);

	const page = await client.listIssues({ teamId: 'team-1' });

	assert.strictEqual(page.hasNextPage, true);
	assert.strictEqual(page.endCursor, 'cursor-1');
	assert.strictEqual(page.nodes[0]?.identifier, 'ENG-1');
	assert.strictEqual(requests[0]?.headers.authorization, 'Bearer token-1');
	assert.deepStrictEqual(
		(requests[0]?.body.variables as Record<string, unknown> | undefined)
			?.filter,
		{ team: { id: { eq: 'team-1' } } },
	);
});

test('listIssues: sends the state-type filter beside the team filter, with the order', async () => {
	const { client, requests } = createClientFixture(() =>
		Response.json({
			data: {
				issues: {
					nodes: [ISSUE_NODE],
					pageInfo: { endCursor: null, hasNextPage: false },
				},
			},
		}),
	);

	await client.listIssues({
		orderBy: 'updatedAt',
		stateTypes: ['backlog', 'unstarted'],
		teamId: 'team-1',
	});

	const variables = requests[0]?.body.variables as
		| Record<string, unknown>
		| undefined;
	assert.deepStrictEqual(variables?.filter, {
		state: { type: { in: ['backlog', 'unstarted'] } },
		team: { id: { eq: 'team-1' } },
	});
	assert.strictEqual(variables?.orderBy, 'updatedAt');
	assert.match(String(requests[0]?.body.query), /orderBy: \$orderBy/);
});

test('listIssues: leaves the filter and order to Linear when none is asked for', async () => {
	const { client, requests } = createClientFixture(() =>
		Response.json({
			data: {
				issues: {
					nodes: [],
					pageInfo: { endCursor: null, hasNextPage: false },
				},
			},
		}),
	);

	await client.listIssues();

	const variables = requests[0]?.body.variables as
		| Record<string, unknown>
		| undefined;
	assert.strictEqual(variables?.filter, null);
	assert.ok(variables && !('orderBy' in variables));
});

test('getIssue: maps a missing issue to not-found', async () => {
	const { client } = createClientFixture(() =>
		Response.json({ data: { issue: null } }),
	);

	await expectServiceError(client.getIssue('ENG-404'), (error) => {
		assert.strictEqual(error.code, 'not-found');
	});
});
