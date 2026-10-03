import { defineConfig } from "vitest/config";

// The database tests share one throwaway database and reset its schema, so test files run one at a time.
export default defineConfig({ test: { fileParallelism: false } });
