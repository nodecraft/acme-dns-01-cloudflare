acme-dns-01-cloudflare
==============
[![npm version](https://badge.fury.io/js/acme-dns-01-cloudflare.svg)](https://badge.fury.io/js/acme-dns-01-cloudflare)
[![dependencies Status](https://david-dm.org/nodecraft/acme-dns-01-cloudflare/status.svg)](https://david-dm.org/nodecraft/acme-dns-01-cloudflare)

[Cloudflare](https://www.cloudflare.com/) DNS + Let's Encrypt. This module handles ACME dns-01 challenges, compatible with [Greenlock.js](https://www.npmjs.com/package/greenlock) and [ACME.js](https://www.npmjs.com/package/acme). It passes [acme-dns-01-test](https://www.npmjs.com/package/acme-dns-01-test).

## Install
```bash
npm install acme-dns-01-cloudflare --save
```

## Usage

First, create an instance of the library with your Cloudflare API credentials. These can be generated/retrieved from your [account profile](https://dash.cloudflare.com/profile).

```js
const acmeDnsCloudflare = require('acme-dns-01-cloudflare');

const cloudflareDns01 = new acmeDnsCloudflare({
	email: 'example@example.com',
	key: 'xxxxxxx',
	verifyPropagation: true
});
````
Other options include `waitFor` and `retries` which control the number of propagation retries, and delay between retries. You probably won't need to tweak these unless you're seeing regular DNS related failures.

Then you can use it with any compatible ACME library, such as [Greenlock.js](https://www.npmjs.com/package/greenlock) or [ACME.js](https://www.npmjs.com/package/acme).

### Greenlock.js

See the [Greenlock.js documentation](https://www.npmjs.com/package/greenlock) for more information. The example below uses the `greenlock-store-fs` module to write these certs to disk for demonstration.

```js
const Greenlock = require('greenlock'),
	greenlockStore = require('greenlock-store-fs');

const store = greenlockStore.create({
	configDir: './store/certs',
	debug: true
});

const greenlock = Greenlock.create({
	server: 'https://acme-staging-v02.api.letsencrypt.org/directory',
	store: store,
	challenges: {
		'dns-01': cloudflareDns01
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

### ACME.js

```js
// TODO
```


## Tests
```bash
# CLOUDFLARE_EMAIL, CLOUDFLARE_APIKEY and DOMAIN env vars must be set
node ./test.js
```
