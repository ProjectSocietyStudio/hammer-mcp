import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs before any test file, so the "what this machine is missing" notice appears
    // even when a single file is invoked. Most of this suite drives the real Source
    // toolchain, and a green summary full of silent skips is indistinguishable from a
    // green summary that proved something.
    setupFiles: ["./test/support/setup.ts"],
    // No global testTimeout on purpose: the tests that need minutes (wine compiles) already
    // declare their own, and raising the default would let a genuine hang look like slowness.
  },
});
