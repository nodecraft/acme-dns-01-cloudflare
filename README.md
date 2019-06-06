# greenlock-challenge-cloudflare
Greenlock DNS Challenge for Cloudflare
`npm install greenlock-challenge-cloudflare --save`

[![npm version](https://badge.fury.io/js/greenlock-challenge-cloudflare.svg)](https://badge.fury.io/js/greenlock-challenge-cloudflare)
[![dependencies Status](https://david-dm.org/nodecraft/greenlock-challenge-cloudflare/status.svg)](https://david-dm.org/nodecraft/greenlock-challenge-cloudflare)


Note: This module is still a WIP and not yet functional.

## Usage
```js
const Greenlock = require('greenlock'),
	greenlockStore = require('greenlock-store-fs'),
	LEChallengeCloudflare = require('greenlock-challenge-cloudflare');

const store = greenlockStore.create({
	configDir: './store/certs',
	privkeyPath: ':configDir/certs/:hostname.key',
	bundlePath: ':configDir/certs/:hostname.bundle',
	fullchainPath: ':configDir/certs/:hostname.fullchain',
	certPath: ':configDir/certs/:hostname.cert',
	chainPath: ':configDir/certs/:hostname.chain',
	logsDir: './store/cert-fix/logs',
	debug: true
});

const DNSChallenge = new LEChallengeCloudflare({
	email: 'example@example.com',
	key: 'api key',
	verifyPropagation: true
});

const greenlock = Greenlock.create({
	server: 'https://acme-staging-v02.api.letsencrypt.org/directory',
	store: store,
	challenges: {
		'dns-01': DNSChallenge
	},
	challengeType: 'dns-01',
	debug: true
});

greenlock.register({
	domains: ['nodecraft.com'],
	email: 'admin@nodecraft.com',
	agreeTos: true,
	rsaKeySize: 2048,
	debug: true
}).then(() => {
	console.log('SUCCESS');
}).catch((err) => {
	console.error(err);
});
```