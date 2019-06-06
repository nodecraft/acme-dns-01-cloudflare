'use strict';

/* eslint-disable no-process-exit */
if(!process.env.CLOUDFLARE_EMAIL || !process.env.CLOUDFLARE_APIKEY){
	console.error('Missing CLOUDFLARE_EMAIL or CLOUDFLARE_APIKEY env');
	process.exit(1);
}
if(!process.env.DOMAIN){
	console.error('Missing DOMAIN');
	process.exit(1);
}
const tester = require("acme-challenge-test");

const type = "dns-01";
const challenger = require("./").create({
	email: process.env.CLOUDFLARE_EMAIL,
	key: process.env.CLOUDFLARE_APIKEY,
	verifyPropagation: true
});

var domain = process.env.DOMAIN;
tester.test(type, domain, challenger).then(function(){
	console.info("PASS");
}).catch(function(err){
	console.error("FAIL");
	console.error(err);
	process.exit(1);
});