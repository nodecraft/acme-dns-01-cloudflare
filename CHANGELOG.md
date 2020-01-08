# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2020-01
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
