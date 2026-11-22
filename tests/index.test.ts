import dns from 'node:dns';

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import Challenge from '../src/index.ts';
import { type FakeCloudflare, createFakeCloudflare } from './fake-cloudflare.ts';

const TOKEN = 'test-token';

function challengeFor(dnsPrefix: string, dnsZone: string, dnsAuthorization = 'auth-value') {
	return { challenge: { dnsPrefix, dnsZone, dnsAuthorization } };
}

type Failure = Challenge.CloudflareChallengeError & { status?: number; };

async function rejectionOf(promise: Promise<unknown>): Promise<Failure> {
	try {
		await promise;
	} catch (err) {
		return err as Failure;
	}
	throw new Error('Expected the promise to reject');
}

function enodata() {
	return Object.assign(new Error('queryTxt ENODATA'), { code: 'ENODATA' });
}

let api: FakeCloudflare;

function useApi(seed: Parameters<typeof createFakeCloudflare>[0]): FakeCloudflare {
	api = createFakeCloudflare(seed);
	vi.stubGlobal('fetch', api.fetch);
	return api;
}

beforeEach(() => {
	// keep developer credentials from leaking into SDK clients under test
	vi.stubEnv('CLOUDFLARE_API_TOKEN', undefined);
	vi.stubEnv('CLOUDFLARE_API_KEY', undefined);
	vi.stubEnv('CLOUDFLARE_EMAIL', undefined);
	vi.stubEnv('CLOUDFLARE_BASE_URL', undefined);
	useApi({ zones: [{ name: 'example.com' }] });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('constructor', () => {
	it('defaults the ACME.js propagation delay to 15 seconds', () => {
		const challenger = Challenge.create({ token: TOKEN });
		expect(challenger.module).toBe('acme-dns-01-cloudflare');
		expect(challenger.propagationDelay).toBe(15000);
	});

	it('accepts a custom propagation delay', () => {
		expect(Challenge.create({ token: TOKEN, propagationDelay: 5000 }).propagationDelay).toBe(5000);
	});

	it('disables the ACME.js propagation delay when verifying propagation itself', () => {
		expect(Challenge.create({ token: TOKEN, propagationDelay: 5000, verifyPropagation: true }).propagationDelay).toBe(0);
	});

	it('reads credentials from top-level options', () => {
		const challenger = Challenge.create({ email: 'a@example.com', key: 'k', token: 't' });
		expect(challenger.client).toEqual({ email: 'a@example.com', key: 'k', token: 't' });
	});

	it('prefers credentials from a serialised greenlock `client` object', () => {
		const challenger = Challenge.create({
			email: 'top@example.com',
			token: 'top-token',
			client: { email: 'client@example.com', key: 'client-key', token: 'client-token' },
		});
		expect(challenger.client).toEqual({ email: 'client@example.com', key: 'client-key', token: 'client-token' });
	});

	it('works when called without a config', async () => {
		const challenger = Challenge.create();
		expect(challenger.client).toEqual({ email: undefined, key: undefined, token: undefined });
		await expect(challenger.init()).resolves.toBeNull();
	});
});

describe('authentication', () => {
	async function headersFor(options: Challenge.ChallengeOptions): Promise<Headers> {
		await Challenge.create(options).zones();
		return api.state.requests[0].headers;
	}

	it('sends only a bearer token when a token is set, even if email and key are also set', async () => {
		const headers = await headersFor({ token: TOKEN, email: 'a@example.com', key: 'global-key' });
		expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
		expect(headers.has('x-auth-email')).toBe(false);
		expect(headers.has('x-auth-key')).toBe(false);
	});

	it('sends email and global API key when no token is set', async () => {
		const headers = await headersFor({ email: 'a@example.com', key: 'global-key' });
		expect(headers.get('x-auth-email')).toBe('a@example.com');
		expect(headers.get('x-auth-key')).toBe('global-key');
		expect(headers.has('authorization')).toBe(false);
	});

	it('ignores Cloudflare SDK environment variables', async () => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'env-token');
		vi.stubEnv('CLOUDFLARE_EMAIL', 'env@example.com');
		vi.stubEnv('CLOUDFLARE_API_KEY', 'env-key');
		const headers = await headersFor({ email: 'a@example.com', key: 'global-key' });
		expect(headers.has('authorization')).toBe(false);
		expect(headers.get('x-auth-email')).toBe('a@example.com');

		api.state.requests.length = 0;
		const tokenHeaders = await headersFor({ token: TOKEN });
		expect(tokenHeaders.get('authorization')).toBe(`Bearer ${TOKEN}`);
		expect(tokenHeaders.has('x-auth-email')).toBe(false);
		expect(tokenHeaders.has('x-auth-key')).toBe(false);
	});
});

describe('zones', () => {
	it('lists zone names across every page', async () => {
		const names = Array.from({ length: 120 }, (_, index) => `zone${index}.example`);
		useApi({ zones: names.map((name) => {
			return { name };
		}) });
		await expect(Challenge.create({ token: TOKEN }).zones()).resolves.toEqual(names);
	});

	it('rejects with the Cloudflare API errors attached', async () => {
		const errors = [{ code: 9109, message: 'Invalid access token' }];
		api.failNext('GET', /\/zones$/, 403, errors);
		const err = await rejectionOf(Challenge.create({ token: TOKEN }).zones());
		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(403);
		expect(err.cloudflare_errors).toEqual(errors);
		expect(err.message).toContain('Invalid access token');
	});
});

describe('getZoneForDomain', () => {
	beforeEach(() => {
		useApi({ zones: [{ name: 'testing-example.com' }, { name: 'example.com' }] });
	});

	it('matches the zone apex', async () => {
		await expect(Challenge.create({ token: TOKEN }).getZoneForDomain('example.com')).resolves.toMatchObject({ name: 'example.com' });
	});

	it('matches a subdomain of a zone', async () => {
		await expect(Challenge.create({ token: TOKEN }).getZoneForDomain('_acme-challenge.www.example.com')).resolves.toMatchObject({ name: 'example.com' });
	});

	it('does not match a zone that only shares a suffix', async () => {
		useApi({ zones: [{ name: 'example.com' }] });
		await expect(Challenge.create({ token: TOKEN }).getZoneForDomain('testing-example.com')).resolves.toBeNull();
	});

	it('finds zones beyond the first page', async () => {
		const zones = Array.from({ length: 75 }, (_, index) => {
			return { name: `zone${index}.example` };
		});
		useApi({ zones: [...zones, { name: 'example.com' }] });
		await expect(Challenge.create({ token: TOKEN }).getZoneForDomain('www.example.com')).resolves.toMatchObject({ name: 'example.com' });
	});
});

describe('getTxtRecords', () => {
	it('returns every exact-name TXT record across pages, ignoring case-insensitive API matches', async () => {
		const name = '_acme-challenge.example.com';
		const matching = Array.from({ length: 150 }, (_, index) => {
			return { id: `r${index}`, zone_id: 'zone-1', type: 'TXT', name, content: `v${index}` };
		});
		useApi({
			zones: [{ name: 'example.com' }],
			records: [
				...matching,
				{ id: 'upper', zone_id: 'zone-1', type: 'TXT', name: name.toUpperCase(), content: 'upper' },
				{ id: 'a-record', zone_id: 'zone-1', type: 'A', name, content: '192.0.2.1' },
				{ id: 'other-zone', zone_id: 'zone-2', type: 'TXT', name, content: 'other' },
			],
		});
		const records = await Challenge.create({ token: TOKEN }).getTxtRecords({ id: 'zone-1' }, name);
		expect(records.map(record => record.id)).toEqual(matching.map(record => record.id));
	});
});

describe('set', () => {
	it('requires Greenlock v2.7+ challenge args', async () => {
		await expect(Challenge.create({ token: TOKEN }).set({})).rejects.toThrow('You must be using Greenlock v2.7+');
	});

	it('creates a TXT record in the matching zone', async () => {
		await expect(Challenge.create({ token: TOKEN }).set(challengeFor('_acme-challenge.www', 'example.com', 'abc123'))).resolves.toBeNull();

		const create = api.state.requests.find(request => request.method === 'POST');
		expect(create).toBeDefined();
		expect(create?.url.pathname).toBe('/client/v4/zones/zone-1/dns_records');
		expect(create?.body).toEqual({
			type: 'TXT',
			name: '_acme-challenge.www.example.com',
			content: 'abc123',
			ttl: 120,
		});
		expect(api.state.records).toHaveLength(1);
	});

	it('rejects when no zone matches', async () => {
		await expect(Challenge.create({ token: TOKEN }).set(challengeFor('_acme-challenge', 'unknown.org'))).rejects.toThrow('Could not find a zone for \'_acme-challenge.unknown.org\'.');
	});

	it('rejects with Cloudflare API errors when record creation fails', async () => {
		const errors = [{ code: 81057, message: 'Record already exists.' }];
		api.failNext('POST', /dns_records$/, 400, errors);
		const err = await rejectionOf(Challenge.create({ token: TOKEN }).set(challengeFor('_acme-challenge', 'example.com')));
		expect(err.cloudflare_errors).toEqual(errors);
		expect(err.status).toBe(400);
	});

	describe('with verifyPropagation', () => {
		it('resolves once the record is visible in DNS', async () => {
			const resolveTxt = vi.spyOn(dns.promises, 'resolveTxt')
				.mockRejectedValueOnce(enodata())
				.mockResolvedValueOnce([['other'], ['auth-value']]);
			const log = vi.spyOn(console, 'log').mockImplementation(() => {});

			const challenger = Challenge.create({ token: TOKEN, verifyPropagation: true, verbose: true, waitFor: 1 });
			await expect(challenger.set(challengeFor('_acme-challenge', 'example.com'))).resolves.toBeNull();

			expect(resolveTxt).toHaveBeenCalledWith('_acme-challenge.example.com');
			expect(resolveTxt).toHaveBeenCalledTimes(2);
			expect(log).toHaveBeenCalledWith(expect.stringContaining('(Attempt 1 / 30)'));
		});

		it('rejects after exhausting retries', async () => {
			vi.spyOn(dns.promises, 'resolveTxt').mockResolvedValue([['stale']]);
			const challenger = Challenge.create({ token: TOKEN, verifyPropagation: true, waitFor: 1, retries: 3 });
			await expect(challenger.set(challengeFor('_acme-challenge', 'example.com'))).rejects.toThrow('Could not verify challenge for \'_acme-challenge.example.com\'.');
			expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(3);
		});
	});
});

describe('remove', () => {
	const name = '_acme-challenge.example.com';

	beforeEach(() => {
		useApi({
			zones: [{ name: 'example.com' }],
			records: [
				{ id: 'target', zone_id: 'zone-1', type: 'TXT', name, content: 'auth-value' },
				{ id: 'sibling', zone_id: 'zone-1', type: 'TXT', name, content: 'another-challenge' },
				{ id: 'elsewhere', zone_id: 'zone-1', type: 'TXT', name: 'www.example.com', content: 'auth-value' },
			],
		});
	});

	it('requires Greenlock v2.7+ challenge args', async () => {
		await expect(Challenge.create({ token: TOKEN }).remove({})).rejects.toThrow('You must be using Greenlock v2.7+');
	});

	it('deletes only the record matching the challenge', async () => {
		await expect(Challenge.create({ token: TOKEN }).remove(challengeFor('_acme-challenge', 'example.com'))).resolves.toBeNull();

		const deletes = api.state.requests.filter(request => request.method === 'DELETE');
		expect(deletes.map(request => request.url.pathname)).toEqual(['/client/v4/zones/zone-1/dns_records/target']);
		expect(api.state.records.map(record => record.id)).toEqual(['sibling', 'elsewhere']);
	});

	it('rejects when there are no TXT records for the name', async () => {
		await expect(Challenge.create({ token: TOKEN }).remove(challengeFor('_acme-challenge.missing', 'example.com'))).rejects.toThrow('No TXT records found for _acme-challenge.missing.example.com');
	});

	it('rejects when no zone matches', async () => {
		await expect(Challenge.create({ token: TOKEN }).remove(challengeFor('_acme-challenge', 'unknown.org'))).rejects.toThrow('Could not find a zone for \'_acme-challenge.unknown.org\'.');
	});

	it('rejects with Cloudflare API errors when deletion fails', async () => {
		const errors = [{ code: 10000, message: 'Authentication error' }];
		api.failNext('DELETE', /dns_records\/target$/, 403, errors);
		const err = await rejectionOf(Challenge.create({ token: TOKEN }).remove(challengeFor('_acme-challenge', 'example.com')));
		expect(err.cloudflare_errors).toEqual(errors);
	});

	describe('with verifyPropagation', () => {
		it('waits until the record is gone from DNS using the configured waitFor and retries', async () => {
			const resolveTxt = vi.spyOn(dns.promises, 'resolveTxt')
				.mockResolvedValueOnce([['auth-value']])
				.mockResolvedValueOnce([['another-challenge']]);
			const challenger = Challenge.create({ token: TOKEN, verifyPropagation: true, waitFor: 1, retries: 2 });
			await expect(challenger.remove(challengeFor('_acme-challenge', 'example.com'))).resolves.toBeNull();
			expect(resolveTxt).toHaveBeenCalledTimes(2);
		});

		it('treats ENODATA as a completed removal', async () => {
			vi.spyOn(dns.promises, 'resolveTxt').mockRejectedValue(enodata());
			const challenger = Challenge.create({ token: TOKEN, verifyPropagation: true, waitFor: 1 });
			await expect(challenger.remove(challengeFor('_acme-challenge', 'example.com'))).resolves.toBeNull();
			expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(1);
		});

		it('rejects when the record never disappears', async () => {
			vi.spyOn(dns.promises, 'resolveTxt').mockResolvedValue([['auth-value']]);
			const challenger = Challenge.create({ token: TOKEN, verifyPropagation: true, waitFor: 1, retries: 2 });
			await expect(challenger.remove(challengeFor('_acme-challenge', 'example.com'))).rejects.toThrow('Could not verify challenge for \'_acme-challenge.example.com\'.');
			expect(dns.promises.resolveTxt).toHaveBeenCalledTimes(2);
		});
	});
});

describe('get', () => {
	beforeEach(() => {
		useApi({
			zones: [{ name: 'example.com' }],
			records: [{ id: 'target', zone_id: 'zone-1', type: 'TXT', name: '_acme-challenge.example.com', content: 'auth-value' }],
		});
	});

	it('requires Greenlock v2.7+ challenge args', async () => {
		await expect(Challenge.create({ token: TOKEN }).get({})).rejects.toThrow('You must be using Greenlock v2.7+');
	});

	it('returns the matching record', async () => {
		await expect(Challenge.create({ token: TOKEN }).get(challengeFor('_acme-challenge', 'example.com'))).resolves.toEqual({ dnsAuthorization: 'auth-value' });
	});

	it('returns null when the content does not match', async () => {
		await expect(Challenge.create({ token: TOKEN }).get(challengeFor('_acme-challenge', 'example.com', 'other'))).resolves.toBeNull();
	});

	it('returns null when there are no records', async () => {
		await expect(Challenge.create({ token: TOKEN }).get(challengeFor('_acme-challenge.none', 'example.com'))).resolves.toBeNull();
	});

	it('returns null when no zone matches', async () => {
		await expect(Challenge.create({ token: TOKEN }).get(challengeFor('_acme-challenge', 'unknown.org'))).resolves.toBeNull();
	});

	it('returns null instead of throwing on API errors', async () => {
		api.failNext('GET', /dns_records$/, 403, [{ code: 10000, message: 'Authentication error' }]);
		await expect(Challenge.create({ token: TOKEN }).get(challengeFor('_acme-challenge', 'example.com'))).resolves.toBeNull();
	});
});

describe('verifyPropagation', () => {
	it('joins multi-string TXT records before comparing', async () => {
		vi.spyOn(dns.promises, 'resolveTxt').mockResolvedValue([['part1', 'part2']]);
		await expect(Challenge.verifyPropagation({ dnsPrefix: '_acme-challenge', dnsZone: 'example.com', dnsAuthorization: 'part1 part2' }, false, 1, 1)).resolves.toBeUndefined();
	});

	it('retries through DNS lookup errors', async () => {
		vi.spyOn(dns.promises, 'resolveTxt')
			.mockRejectedValueOnce(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }))
			.mockResolvedValueOnce([['auth-value']]);
		await expect(Challenge.verifyPropagation({ dnsPrefix: '_acme-challenge', dnsZone: 'example.com', dnsAuthorization: 'auth-value' }, false, 1, 2)).resolves.toBeUndefined();
	});

	it('resolves for a removal once the value is absent', async () => {
		vi.spyOn(dns.promises, 'resolveTxt').mockResolvedValue([['something-else']]);
		await expect(Challenge.verifyPropagation({ dnsPrefix: '_acme-challenge', dnsZone: 'example.com', dnsAuthorization: 'auth-value', removed: true }, false, 1, 1)).resolves.toBeUndefined();
	});
});
