module.exports = require('@backstage/cli/config/eslint-factory')(__dirname, {
  settings: { jest: { version: 30 } },
  overrides: [
    {
      // Vendored @assistant-ui/react-ui code keeps upstream's conventions
      // (declaration order, `== null`, spread-through heading/anchor props).
      files: ['src/collapsible/surface/react-ui/**'],
      rules: {
        '@typescript-eslint/no-use-before-define': 'off',
        'jsx-a11y/heading-has-content': 'off',
        'jsx-a11y/anchor-has-content': 'off',
        'jsx-a11y/no-autofocus': 'off',
        eqeqeq: 'off',
        'prefer-template': 'off',
      },
    },
  ],
});
