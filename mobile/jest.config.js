// jest.config.js: jest-expo unit tests for the app's pure logic (SSE dedupe, i18n parity, money via
// shared/, NFC URL building). Maps the @shared and @ aliases the same way tsconfig does.
module.exports = {
  preset: "jest-expo",
  modulePaths: ["<rootDir>/node_modules"],
  // roots + a relative glob: a "<rootDir>/..." glob matches nothing when the path has a dot folder
  // (a git worktree under .claude/worktrees) on Windows.
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/../shared/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
