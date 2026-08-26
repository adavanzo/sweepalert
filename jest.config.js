/**
 * The scheduling engine + Boston row mapping are pure TypeScript (luxon only),
 * so they run under the default node environment without the native React
 * Native shims. ts-jest is pinned to a CommonJS module target here so it is
 * decoupled from Expo's tsconfig.base (which uses `module: "preserve"` for
 * Metro's bundler and is not directly runnable under node).
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          resolveJsonModule: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
};
