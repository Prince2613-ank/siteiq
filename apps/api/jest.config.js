/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          target: 'ES2021',
          module: 'commonjs',
          esModuleInterop: true,
          skipLibCheck: true,
          strictNullChecks: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/../jest.setup.js'],
};
