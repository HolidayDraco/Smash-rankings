import { defineConfig } from "vitest/config";

// Component tests render through react-native-web (what the web build ships), not native code.
export default defineConfig({
  define: { __DEV__: "true" },
  resolve: { alias: { "react-native": "react-native-web" } },
});
