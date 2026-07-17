import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'build/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // the codebase annotates return types by convention but not exhaustively
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // plain CommonJS node scripts (icon generation etc.)
    files: ['scripts/**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  // must come last: disables stylistic rules that would fight Prettier
  prettier
)
