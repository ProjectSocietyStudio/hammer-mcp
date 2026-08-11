import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs once in the main process, before any worker. Most of this suite drives the real
    // Source toolchain, and a green summary full of silent skips is indistinguishable from
    // a green summary that proved something -- so the run says what it could not test.
    //
    // Deliberately not `setupFiles`: that is loaded once per test file, in a separate
    // worker process each time, so the notice printed sixteen times and a module-level
    // guard could not see across processes.
    globalSetup: ["./test/support/global-setup.ts"],
    // No global testTimeout on purpose: the tests that need minutes (wine compiles) already
    // declare their own, and raising the default would let a genuine hang look like slowness.
  },
});
