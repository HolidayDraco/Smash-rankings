import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "schema/startgg.graphql",
  documents: "src/queries/*.graphql",
  generates: {
    "src/generated/graphql.ts": {
      plugins: ["typescript-operations", "typed-document-node"],
      config: {
        // start.gg returns numeric ids and epoch-second timestamps in JSON.
        scalars: {
          ID: { input: "number", output: "number" },
          Timestamp: { input: "number", output: "number" },
        },
        avoidOptionals: false,
        useTypeImports: true,
      },
    },
  },
};
export default config;
