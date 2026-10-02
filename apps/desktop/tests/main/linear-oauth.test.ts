import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	buildLinearAuthorizeUrl,
	createOauthState,
	createPkcePair,
	LINEAR_AUTHORIZE_URL,
	parseOauthCallback,
} from '../../src/main/linear/linear-oauth.ts';

test('createPkcePair: challenge is the S256 hash of the verifier', () => {
	const { challenge, verifier } = createPkcePair();

	assert.ok(verifier.length >= 43, 'verifier must satisfy RFC 7636 length');
	assert.strictEqual(
		challenge,
		createHash('sha256').update(verifier).digest('base64url'),
	);
});

test('createPkcePair: produces unique pairs per login attempt', () => {
	const first = createPkcePair();
	const second = createPkcePair();

	assert.notStrictEqual(first.verifier, second.verifier);
	assert.notStrictEqual(first.challenge, second.challenge);
});

test('createOauthState: produces unguessable unique values', () => {
	const states = new Set(Array.from({ length: 16 }, () => createOauthState()));

	assert.strictEqual(states.size, 16);
	for (const state of states) {
		assert.ok(state.length >= 24);
	}
});

test('buildLinearAuthorizeUrl: encodes every OAuth parameter', () => {
	const url = new URL(
		buildLinearAuthorizeUrl({
			challenge: 'challenge-1',
			clientId: 'client-1',
			redirectUri: 'http://127.0.0.1:53682/callback',
			scopes: ['read', 'write'],
			state: 'state-1',
		}),
	);

	assert.ok(url.toString().startsWith(LINEAR_AUTHORIZE_URL));
	assert.strictEqual(url.searchParams.get('client_id'), 'client-1');
	assert.strictEqual(
		url.searchParams.get('redirect_uri'),
		'http://127.0.0.1:53682/callback',
	);
	assert.strictEqual(url.searchParams.get('response_type'), 'code');
	assert.strictEqual(url.searchParams.get('scope'), 'read,write');
	assert.strictEqual(url.searchParams.get('state'), 'state-1');
	assert.strictEqual(url.searchParams.get('code_challenge'), 'challenge-1');
	assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
});

test('parseOauthCallback: returns the code when the state matches', () => {
	const result = parseOauthCallback({
		expectedState: 'state-1',
		searchParams: new URLSearchParams({ code: 'code-1', state: 'state-1' }),
	});

	assert.deepStrictEqual(result, { code: 'code-1', ok: true });
});

test('parseOauthCallback: rejects a mismatched state', () => {
	const result = parseOauthCallback({
		expectedState: 'state-1',
		searchParams: new URLSearchParams({ code: 'code-1', state: 'state-2' }),
	});

	assert.strictEqual(result.ok, false);
	assert.ok(!result.ok && result.error === 'state-mismatch');
});

test('parseOauthCallback: surfaces provider errors with their description', () => {
	const result = parseOauthCallback({
		expectedState: 'state-1',
		searchParams: new URLSearchParams({
			error: 'access_denied',
			error_description: 'The user denied access.',
			state: 'state-1',
		}),
	});

	assert.ok(!result.ok && result.error === 'provider-error');
	assert.ok(!result.ok && result.description.includes('denied'));
});

test('parseOauthCallback: rejects callbacks without an authorization code', () => {
	const result = parseOauthCallback({
		expectedState: 'state-1',
		searchParams: new URLSearchParams({ state: 'state-1' }),
	});

	assert.ok(!result.ok && result.error === 'missing-code');
});
