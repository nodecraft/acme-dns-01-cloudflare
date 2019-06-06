'use strict';

const util = require('util');
const dns = require('dns');

const resolveTxtPromise = util.promisify(dns.resolveTxt);

const cloudflare = require('cloudflare');

class Challenge{
	constructor(options){
		this.options = options;
		this.client = new cloudflare({
			email: options.email,
			key: options.key
		});
	}

	static create(config){
		return new Challenge(Object.assign(config, this.options));
	}

	async set(args, callback){
		console.log('set', args.challenge);
		if(!args.challenge){
			return callback("You must be using Greenlock v2.7+ to use greenlock-challenge-cloudflare");
		}
		try{
			const zone = await this.getZoneForDomain(args.challenge.dnsHost);
			if(!zone){
				return callback(`Could not find a zone for '${args.challenge.dnsHost}'.`);
			}
			const records = await this.getTxtRecords(zone, args.challenge.dnsHost);
			let content = args.challenge.keyAuthorization;
			// is this the correct thing to be doing?
			if(args.challenge.dnsHost.startsWith('_greenlock-dryrun')){
				content = args.challenge.dnsAuthorization;
			}
			if(records.length === 0){
				// add record
				console.log('add record', {
					type: 'TXT',
					name: args.challenge.dnsHost,
					content: content,
					ttl: 120
				});
				await this.client.dnsRecords.add(zone.id, {
					type: 'TXT',
					name: args.challenge.dnsHost,
					content: content,
					ttl: 120
				});
			}else if(records.length === 1){
				// update existing record
				console.log('update record');
				await this.client.dnsRecords.edit(zone.id, records[0].id, Object.assign(
					{},
					records[0],
					{content: content, ttl: 120}
				));
			}else{
				// delete all but latest record
				console.log('remove old records');
				for(const record of records.slice(1)){
					await this.client.dnsRecords.del(zone.id, record.id);
				}
			}
			if(this.options.verifyPropagation){
				await Challenge.verifyPropagation(args.challenge, this.options.waitFor, this.options.retries);
			}
			return callback();
		}catch(err){
			return callback(err);
		}
	}

	async remove(args, callback){
		console.log('remove', args);
		if(!args.challenge){
			return callback("You must be using Greenlock v2.7+ to use greenlock-challenge-cloudflare v3+");
		}
		try{
			const zone = await this.getZoneForDomain(args.challenge.dnsHost);
			if(!zone){
				return callback(`Could not find a zone for '${args.challenge.dnsHost}'.`);
			}
			const records = await this.getTxtRecords(zone, args.challenge.dnsHost);
			if(!records.length){
				return callback(`No TXT records found for ${args.challenge.dnsHost}`);
			}
			for(const record of records){
				await this.client.dnsRecords.del(zone.id, record.id);
			}
			return callback();
		}catch(err){
			return callback(err);
		}
	}

	static async verifyPropagation(challenge, waitFor = 8000, retries = 20){
		for(let i = 0; i < retries; i++){
			try{
				const records = await resolveTxt(challenge.dnsHost);
				console.log(`Successfully propagated challenge for ${challenge.dnsHost}`);
				console.log(records);
				let verifyCheck = challenge.keyAuthorization;
				// is this the correct thing to be doing?
				if(challenge.dnsHost.startsWith('_greenlock-dryrun')){
					verifyCheck = challenge.dnsAuthorization;
				}
				if(!records.includes(verifyCheck)){
					throw new Error(`Could not verify DNS for ${challenge.dnsHost}`);
				}
				return;
			}catch(err){
				console.error(err);
				console.log(`Waiting for ${waitFor} ms before attempting retry ${i + 1} / ${retries}.`);
				await delay(waitFor);
			}
		}
		throw new Error(`Could not verify challenge for '${challenge.dnsHost}'.`);
	}

	async getZoneForDomain(domain){
		for await(const zone of consumePages(pagination =>
			this.client.zones.browse(pagination)
		)){
			if(domain.endsWith(zone.name)){
				return zone;
			}
		}
		return null;
	}

	async getTxtRecords(zone, name){
		const records = [];

		for await(const txtRecord of consumePages(pagination =>
			this.client.dnsRecords.browse(zone.id, {
				...pagination,
				type: 'TXT',
				name
			})
		)){
			if(txtRecord.name === name){
				records.push(txtRecord);
			}
		}

		return records;
	}
}

/* Thanks to https://github.com/buschtoens/le-challenge-cloudflare for this great pagination implementation */
async function* consumePages(loader, pageSize = 10){
	for(let page = 1, didReadAll = false; !didReadAll; page++){
		const response = await loader({
			per_page: pageSize,
			page
		});

		if(response.success){
			yield* response.result;
		}else{
			const error = new Error('Cloudflare API error.');
			error.errors = response.errors;
			throw error;
		}

		didReadAll = page >= response.result_info.total_pages;
	}
}

async function resolveTxt(fqdn){
	const records = await resolveTxtPromise(fqdn);
	return records.map(r => r.join(' '));
}

function delay(ms){
	return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = Challenge;