'use strict';

const {promisify} = require('util');
const dns = require('dns');

const resolveTxtPromise = promisify(dns.resolveTxt);

const cloudflare = require('cloudflare');

function formatCloudflareError(err){
	if(!err.response || !err.response.body){
		return err;
	}
	// maintain Cloudflare API errors, not just a generic HTTPError from `got`
	const newErr = err;
	newErr.cloudflare_errors = err.response.body.errors;
	return newErr;
}

/* Thanks to https://github.com/buschtoens/le-challenge-cloudflare for this great pagination implementation */
async function* consumePages(loader, pageSize = 10){
	for(let page = 1, didReadAll = false; !didReadAll; page++){
		let response;
		try{
			response = await loader({
				per_page: pageSize,
				page
			});
		}catch(err){
			// try to pass-through human-friendly Cloudflare API errors
			throw formatCloudflareError(err);
		}

		if(response.success){
			yield* response.result;
		}else{
			const error = new Error('Cloudflare API error.');
			error.response = response;
			throw formatCloudflareError(error);
		}

		didReadAll = page >= response.result_info.total_pages;
	}
}

async function resolveTxt(fqdn){
	const records = await resolveTxtPromise(fqdn);
	return records.map(r => r.join(' '));
}

function delay(ms){
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve();
		}, ms);
	});
}

class Challenge {
	constructor(options = {}){
		this.options = options;
		this.client = new cloudflare({
			email: options.email,
			key: options.key,
			token: options.token
		});
		this.propagationDelay = options.propagationDelay || 15000; // set propagationDelay for ACME.js
		if(this.options.verifyPropagation){
			// if our own propagation is set, like is required for greenlock.js at time of writing, disable use native ACME.js propagation delay to prevent double verification
			this.propagationDelay = 0;
		}
	}

	static create(config){
		return new Challenge(Object.assign(config, this.options));
	}

	async init(){
		return null;
	}

	async set(args){
		if(!args.challenge){
			throw new Error("You must be using Greenlock v2.7+ to use acme-dns-01-cloudflare");
		}
		try{
			const fullRecordName = args.challenge.dnsPrefix + '.' + args.challenge.dnsZone;
			const zone = await this.getZoneForDomain(args.challenge.dnsZone);
			if(!zone){
				throw new Error(`Could not find a zone for '${fullRecordName}'.`);
			}
			// add record
			await this.client.dnsRecords.add(zone.id, {
				type: 'TXT',
				name: fullRecordName,
				content: args.challenge.dnsAuthorization,
				ttl: 120
			});
			// verify propagation
			if(this.options.verifyPropagation){
				// wait for one "tick" before attempting to query. This can help prevent the DNS cache from getting polluted with a bad value
				await delay(this.options.waitFor || 10000);
				await Challenge.verifyPropagation(args.challenge, this.options.verbose, this.options.waitFor, this.options.retries);
			}
			return null;
		}catch(err){
			if(err instanceof Error){
				throw formatCloudflareError(err);
			}
			throw new Error(err);
		}
	}

	async remove(args){
		if(!args.challenge){
			throw new Error("You must be using Greenlock v2.7+ to use acme-dns-01-cloudflare");
		}
		try{
			const fullRecordName = args.challenge.dnsPrefix + '.' + args.challenge.dnsZone;
			const zone = await this.getZoneForDomain(args.challenge.dnsZone);
			if(!zone){
				throw new Error(`Could not find a zone for '${fullRecordName}'.`);
			}
			const records = await this.getTxtRecords(zone, fullRecordName);
			if(records.length === 0){
				throw new Error(`No TXT records found for ${fullRecordName}`);
			}
			for(const record of records){
				if(record.name === fullRecordName && record.content === args.challenge.dnsAuthorization){
					await this.client.dnsRecords.del(zone.id, record.id);
				}
			}
			if(this.options.verifyPropagation){
				// wait for one "tick" before attempting to query. This can help prevent the DNS cache from getting polluted with a bad value
				await delay(this.options.waitFor || 10000);
				// allow time for deletion to propagate
				await Challenge.verifyPropagation(Object.assign({}, args.challenge, {removed: true}), this.options.verbose);
			}
			return null;
		}catch(err){
			if(err instanceof Error){
				throw formatCloudflareError(err);
			}
			throw new Error(err);
		}
	}

	/* implemented for testing purposes */
	async get(args){
		if(!args.challenge){
			throw new Error("You must be using Greenlock v2.7+ to use acme-dns-01-cloudflare");
		}
		try{
			const fullRecordName = args.challenge.dnsPrefix + '.' + args.challenge.dnsZone;
			const zone = await this.getZoneForDomain(fullRecordName);
			if(!zone){
				throw new Error(`Could not find a zone for '${fullRecordName}'.`);
			}
			const records = await this.getTxtRecords(zone, fullRecordName);
			if(records.length === 0){
				return null;
			}
			// find the applicable record if multiple
			let foundRecord = null;
			for(const record of records){
				if(record.name === fullRecordName && record.content === args.challenge.dnsAuthorization){
					foundRecord = record;
				}
			}
			if(!foundRecord){
				return null;
			}
			return {
				dnsAuthorization: foundRecord.content
			};

		}catch{
			// could not get record
			return null;
		}
	}

	async zones(args){ // eslint-disable-line no-unused-vars
		try{
			const zones = [];
			for await(const zone of consumePages(pagination => this.client.zones.browse(pagination))){
				zones.push(zone.name);
			}
			return zones;
		}catch(err){
			if(err instanceof Error){
				throw formatCloudflareError(err);
			}
			throw new Error(err);
		}
	}

	static async verifyPropagation(challenge, verbose = false, waitFor = 10000, retries = 30){
		const fullRecordName = challenge.dnsPrefix + '.' + challenge.dnsZone;
		for(let i = 0; i < retries; i++){
			try{
				const records = await resolveTxt(fullRecordName);
				const verifyCheck = challenge.dnsAuthorization;
				if(challenge.removed === true && records.includes(verifyCheck)){
					throw new Error(`DNS record deletion not yet propagated for ${fullRecordName}`);
				}
				if(!records.includes(verifyCheck)){
					if(challenge.removed === true){
						return;
					}
					throw new Error(`Could not verify DNS for ${fullRecordName}`);
				}
				return;
			}catch(err){
				if(err.code === 'ENODATA' && challenge.removed === true){
					return;
				}
				if(verbose){
					console.log(`DNS not propagated yet for ${fullRecordName}. Checking again in ${waitFor}ms. (Attempt ${i + 1} / ${retries})`);
				}
				await delay(waitFor);
			}
		}
		throw new Error(`Could not verify challenge for '${fullRecordName}'.`);
	}

	async getZoneForDomain(domain){
		for await(const zone of consumePages(pagination => this.client.zones.browse(pagination))){
			if(domain === zone.name || domain.endsWith(`.${zone.name}`)){
				return zone;
			}
		}
		return null;
	}

	async getTxtRecords(zone, name){
		const records = [];

		for await(const txtRecord of consumePages(pagination => this.client.dnsRecords.browse(zone.id, {
			...pagination,
			type: 'TXT',
			name
		}))){
			if(txtRecord.name === name){
				records.push(txtRecord);
			}
		}

		return records;
	}
}

module.exports = Challenge;