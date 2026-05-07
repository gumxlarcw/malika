module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/evals"],
  testMatch: ["**/__tests__/**/*.test.js"],
  collectCoverageFrom: ["src/**/*.js", "!src/**/index.js"],
};