import nodecraftEslint from '@nodecraft/eslint-config';
import vitest from '@vitest/eslint-plugin';

export default [
	{
		ignores: ['coverage/', 'dist/'],
	},
	...nodecraftEslint.configs.typescript,
	...nodecraftEslint.configs.node,
	{
		files: ['**/*.cjs'],
		languageOptions: {
			sourceType: 'commonjs',
		},
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
		},
	},
	{
		files: ['tests/**'],
		plugins: {
			vitest,
		},
		rules: {
			...vitest.configs.recommended.rules,
		},
	},
];
