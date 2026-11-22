import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

// Resolved at runtime through package.json `exports`, so this checks the built files consumers load without lint and tsc needing a build first.
const packageName = 'acme-dns-01-cloudflare';
const require = createRequire(import.meta.url);

describe('published package', () => {
	type ChallengeClass = typeof import('../src/index.ts').default;

	it('exports the challenge class from require(), as greenlock loads it', () => {
		const Challenge: ChallengeClass = require(packageName);
		expect(typeof Challenge).toBe('function');
		const challenger = Challenge.create({ token: 'test-token' });
		expect(challenger).toBeInstanceOf(Challenge);
		expect(challenger.module).toBe('acme-dns-01-cloudflare');
	});

	it('exports the challenge class as the ESM default export', async () => {
		const { default: Challenge }: { default: ChallengeClass; } = await import(packageName);
		expect(typeof Challenge.create).toBe('function');
		expect(Challenge.create({ token: 'test-token' }).module).toBe('acme-dns-01-cloudflare');
	});
});
