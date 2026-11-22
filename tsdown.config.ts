import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	// CommonJS keeps `require('acme-dns-01-cloudflare')` working for greenlock, which loads challenge modules by name.
	format: ['esm', 'cjs'],
	platform: 'node',
	dts: true,
	publint: true,
	attw: {
		profile: 'node16',
		level: 'error',
	},
});
