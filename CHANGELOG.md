# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.3] - 2020-06-07
- Fix over-eager zone matching that could cause certs for `testing-example.com` to fail if domain `example.com` was available

## [1.2.2] - 2020-05-09
- Improve Cloudflare error response handling

## [1.2.1] - 2020-04-26
- Fix promise rejections to always return an Error instance for better compatibility with ACME.js

## [1.2.0] - 2020-04-26
- Add ACME.js propagationDelay support
- Wait 10 seconds before attempting first propagation check, to prevent polluting the DNS cache with an invalid result

## [1.1.1] - 2020-02-04
- Simplify promise handlers

## [1.1.0] - 2020-01-15
- Bump `cloudflare` to 2.7.0
- Enable using an API token for Cloudflare instead of email + API Key
- Bump `acme-dns-01-test` to 3.3.2
- `init` function returns a Promise
- Add Greenlock v3 example to docs

## [1.0.2] - 2019-07-15
- Bump dependencies

## [1.0.1] - 2019-06-17
- Fix issue where invalid Cloudflare credentials wouldn't be caught and rejected in `zones`
- Bump `acme-dns-01-test` to 3.3.0
- Add `init` function to pass new test requirements

## [1.0.0] - 2019-06-15
- Initial production release
