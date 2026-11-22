import dns from 'node:dns';

import { APIError, Cloudflare } from 'cloudflare';

interface Credentials {
	email?: string;
	key?: string;
	token?: string;
}

interface ChallengeOptions extends Credentials {
	/** Credentials nested the way greenlock serialises them; these take precedence over the top-level ones. */
	client?: Credentials;
	/** Delay in ms ACME.js waits before validating. Ignored when `verifyPropagation` is set. */
	propagationDelay?: number;
	/** Query DNS until the record is visible before resolving `set` and `remove`. */
	verifyPropagation?: boolean;
	verbose?: boolean;
	/** Delay in ms between propagation checks. */
	waitFor?: number;
	/** Number of propagation checks before giving up. */
	retries?: number;
}

interface DnsChallenge {
	dnsPrefix: string;
	dnsZone: string;
	dnsAuthorization: string;
	removed?: boolean;
}

interface ChallengeArgs {
	challenge?: DnsChallenge;
}

type Zone = Awaited<ReturnType<Cloudflare['zones']['get']>>;
type DnsRecord = Awaited<ReturnType<Cloudflare['dns']['records']['get']>>;

type CloudflareChallengeError = Error & {
	cloudflare_errors?: APIError['errors'];
};

const GREENLOCK_VERSION_ERROR = 'You must be using Greenlock v2.7+ to use acme-dns-01-cloudflare';

function formatCloudflareError(err: Error): CloudflareChallengeError {
	// keep exposing Cloudflare's API errors under the property consumers relied on before the SDK upgrade
	if (err instanceof APIError) {
		return Object.assign(err, { cloudflare_errors: err.errors });
	}
	return err;
}

function toError(err: unknown): CloudflareChallengeError {
	if (err instanceof Error) {
		return formatCloudflareError(err);
	}
	return new Error(String(err));
}

function getCredentials(options: ChallengeOptions): Credentials {
	const client = options.client || {};
	return {
		email: client.email || options.email,
		key: client.key || options.key,
		token: client.token || options.token,
	};
}

function createCloudflareClient({ email, key, token }: Credentials): Cloudflare {
	// The SDK sends every credential it has and falls back to env vars, so pass null for the unused method to keep the token taking precedence.
	if (token) {
		return new Cloudflare({
			apiToken: token,
			apiEmail: null,
			apiKey: null,
			userServiceKey: null,
		});
	}
	return new Cloudflare({
		apiToken: null,
		apiEmail: email || null,
		apiKey: key || null,
		userServiceKey: null,
	});
}

async function resolveTxt(fqdn: string): Promise<string[]> {
	const records = await dns.promises.resolveTxt(fqdn);
	return records.map(record => record.join(' '));
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function getChallenge(args: ChallengeArgs): DnsChallenge {
	if (!args.challenge) {
		throw new Error(GREENLOCK_VERSION_ERROR);
	}
	return args.challenge;
}

class Challenge {
	static create(config?: ChallengeOptions): Challenge {
		return new Challenge(config);
	}

	static async verifyPropagation(challenge: DnsChallenge, verbose = false, waitFor = 10000, retries = 30): Promise<void> {
		const fullRecordName = challenge.dnsPrefix + '.' + challenge.dnsZone;
		for (let i = 0; i < retries; i++) {
			try {
				const records = await resolveTxt(fullRecordName);
				const verifyCheck = challenge.dnsAuthorization;
				if (challenge.removed === true && records.includes(verifyCheck)) {
					throw new Error(`DNS record deletion not yet propagated for ${fullRecordName}`);
				}
				if (!records.includes(verifyCheck)) {
					if (challenge.removed === true) {
						return;
					}
					throw new Error(`Could not verify DNS for ${fullRecordName}`);
				}
				return;
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === 'ENODATA' && challenge.removed === true) {
					return;
				}
				if (verbose) {
					console.log(`DNS not propagated yet for ${fullRecordName}. Checking again in ${waitFor}ms. (Attempt ${i + 1} / ${retries})`);
				}
				await delay(waitFor);
			}
		}
		throw new Error(`Could not verify challenge for '${fullRecordName}'.`);
	}

	module = 'acme-dns-01-cloudflare';
	options: ChallengeOptions;
	client: Credentials;
	cfClient: Cloudflare;
	propagationDelay: number;

	constructor(options: ChallengeOptions = {}) {
		this.options = options;
		this.client = getCredentials(options);
		this.cfClient = createCloudflareClient(this.client);
		this.propagationDelay = options.propagationDelay || 15000; // set propagationDelay for ACME.js
		if (this.options.verifyPropagation) {
			// if our own propagation is set, like is required for greenlock.js at time of writing, disable use native ACME.js propagation delay to prevent double verification
			this.propagationDelay = 0;
		}
	}

	async init(): Promise<null> {
		return null;
	}

	async set(args: ChallengeArgs): Promise<null> {
		const challenge = getChallenge(args);
		try {
			const fullRecordName = challenge.dnsPrefix + '.' + challenge.dnsZone;
			const zone = await this.getZoneForDomain(challenge.dnsZone);
			if (!zone) {
				throw new Error(`Could not find a zone for '${fullRecordName}'.`);
			}
			await this.cfClient.dns.records.create({
				zone_id: zone.id,
				type: 'TXT',
				name: fullRecordName,
				content: challenge.dnsAuthorization,
				ttl: 120,
			});
			if (this.options.verifyPropagation) {
				// wait for one "tick" before attempting to query. This can help prevent the DNS cache from getting polluted with a bad value
				await delay(this.options.waitFor || 10000);
				await Challenge.verifyPropagation(challenge, this.options.verbose, this.options.waitFor, this.options.retries);
			}
			return null;
		} catch (err) {
			throw toError(err);
		}
	}

	async remove(args: ChallengeArgs): Promise<null> {
		const challenge = getChallenge(args);
		try {
			const fullRecordName = challenge.dnsPrefix + '.' + challenge.dnsZone;
			const zone = await this.getZoneForDomain(challenge.dnsZone);
			if (!zone) {
				throw new Error(`Could not find a zone for '${fullRecordName}'.`);
			}
			const records = await this.getTxtRecords(zone, fullRecordName);
			if (records.length === 0) {
				throw new Error(`No TXT records found for ${fullRecordName}`);
			}
			for (const record of records) {
				if (record.content === challenge.dnsAuthorization) {
					await this.cfClient.dns.records.delete(record.id, { zone_id: zone.id });
				}
			}
			if (this.options.verifyPropagation) {
				// wait for one "tick" before attempting to query. This can help prevent the DNS cache from getting polluted with a bad value
				await delay(this.options.waitFor || 10000);
				await Challenge.verifyPropagation({ ...challenge, removed: true }, this.options.verbose, this.options.waitFor, this.options.retries);
			}
			return null;
		} catch (err) {
			throw toError(err);
		}
	}

	/* implemented for testing purposes */
	async get(args: ChallengeArgs): Promise<{ dnsAuthorization: string; } | null> {
		const challenge = getChallenge(args);
		try {
			const fullRecordName = challenge.dnsPrefix + '.' + challenge.dnsZone;
			const zone = await this.getZoneForDomain(fullRecordName);
			if (!zone) {
				return null;
			}
			const records = await this.getTxtRecords(zone, fullRecordName);
			const foundRecord = records.find(record => record.content === challenge.dnsAuthorization);
			if (!foundRecord) {
				return null;
			}
			return {
				dnsAuthorization: challenge.dnsAuthorization,
			};
		} catch {
			// could not get record
			return null;
		}
	}

	async zones(): Promise<string[]> {
		try {
			const zones: string[] = [];
			for await (const zone of this.cfClient.zones.list({ per_page: 50 })) {
				zones.push(zone.name);
			}
			return zones;
		} catch (err) {
			throw toError(err);
		}
	}

	async getZoneForDomain(domain: string): Promise<Zone | null> {
		for await (const zone of this.cfClient.zones.list({ per_page: 50 })) {
			if (domain === zone.name || domain.endsWith(`.${zone.name}`)) {
				return zone;
			}
		}
		return null;
	}

	async getTxtRecords(zone: Pick<Zone, 'id'>, name: string): Promise<DnsRecord[]> {
		const records: DnsRecord[] = [];
		const pages = this.cfClient.dns.records.list({
			zone_id: zone.id,
			type: 'TXT',
			name: { exact: name },
			per_page: 100,
		});
		for await (const txtRecord of pages) {
			// the API's name filter is case-insensitive, so keep the exact match the challenge needs
			if (txtRecord.name === name) {
				records.push(txtRecord);
			}
		}
		return records;
	}
}

// Types live on a namespace merged with the class because the CommonJS build exports only the class via `module.exports`.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace Challenge {
	export type {
		ChallengeArgs,
		ChallengeOptions,
		CloudflareChallengeError,
		Credentials,
		DnsChallenge,
	};
}

export default Challenge;
