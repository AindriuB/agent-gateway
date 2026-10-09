import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/**', '.worktrees/**', '.claude/**'] },
  ...tseslint.configs.recommended,
);
