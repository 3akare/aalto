import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The Workers runtime module, stood in for by a minimal shim so the
      // ledger's SQL can run against node:sqlite in plain Node.
      "cloudflare:workers": fileURLToPath(
        new URL("./test/shims/cloudflare-workers.js", import.meta.url)
      ),
    },
  },
  test: {
    include: ["test/**/*.test.{js,ts}"],
    restoreMocks: true,
  },
});
