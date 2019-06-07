# acme-dns-01-cloudflare
[greenlock](https://www.npmjs.com/package/greenlock) ACME dns-01 challenge for [Cloudflare](https://www.cloudflare.com/)
`npm install acme-dns-01-cloudflare --save`

[![npm version](https://badge.fury.io/js/acme-dns-01-cloudflare.svg)](https://badge.fury.io/js/acme-dns-01-cloudflare)
[![dependencies Status](https://david-dm.org/nodecraft/acme-dns-01-cloudflare/status.svg)](https://david-dm.org/nodecraft/acme-dns-01-cloudflare)

## Usage
```js
const Greenlock = require('greenlock'),
	greenlockStore = require('greenlock-store-fs'),
	LEChallengeCloudflare = require('acme-dns-01-cloudflare');

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
	key: 'xxxxxxx',
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
	domains: ['example.com'],
	email: 'example@example.com',
	agreeTos: true,
	rsaKeySize: 2048,
	debug: true
}).then(() => {
	console.log('SUCCESS');
}).catch((err) => {
	console.error(err);
});
```