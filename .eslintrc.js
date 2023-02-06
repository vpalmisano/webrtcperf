module.exports = {
  env: {
    browser: false,
    commonjs: true,
    es6: true,
    node: true,
    // 'jest/globals': true,
  },
  extends: [
    'eslint:recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    // 'plugin:jest/recommended',
    'plugin:prettier/recommended', // make sure this is the last plugin
  ],
  ignorePatterns: [],
  plugins: ['simple-import-sort', 'unused-imports'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {},
    ecmaVersion: 2020,
    sourceType: 'module',
    tsconfigRootDir: './',
  },
  overrides: [
    {
      // enable the rule specifically for TypeScript files
      files: ['*.ts', '*.tsx'],
      parserOptions: {
        project: ['./tsconfig.json'], // Specify it only for TypeScript files
      },
      extends: [
        'eslint:recommended',
        'plugin:import/errors',
        'plugin:@typescript-eslint/recommended',
        'plugin:import/warnings',
        // 'plugin:jest/recommended',
        'plugin:prettier/recommended', // make sure this is the last plugin
      ],
      rules: {
        'prettier/prettier': 'error',
        'simple-import-sort/imports': 'error',
        'simple-import-sort/exports': 'error',
        'sort-imports': 'off',
        'import/order': 'off',
        'unused-imports/no-unused-imports-ts': 'error',
        'unused-imports/no-unused-vars-ts': [
          'warn',
          { argsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-non-null-assertion': ['error'],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-var-requires': 'warn',
      },
    },
    {
      // enable the rule specifically for TypeScript files
      files: ['*.js'],
      env: {
        browser: true,
        node: true,
      },
    },
  ],
  rules: {
    'prettier/prettier': 'error',
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'sort-imports': 'off',
    'import/order': 'off',
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        paths: ['node_modules/', 'node_modules/@types/'],
      },
      typescript: {},
    },
  },
}
