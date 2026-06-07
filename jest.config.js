module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/apps'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.base.json' }],
  },
  collectCoverageFrom: [
    '<rootDir>/apps/**/src/**/*.ts',
    '<rootDir>/packages/**/src/**/*.ts',
    '!**/*.spec.ts',
  ],
  // Thresholds set at/just below the measured global coverage (2026-06: stmts 54.42,
  // branches 45.49, funcs 56.39, lines 55.20) so the suite passes today. Ratchet up over time.
  coverageThreshold: {
    global: {
      statements: 53,
      branches: 44,
      functions: 55,
      lines: 54,
    },
  },
};
