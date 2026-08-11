import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import { callSidecar, probeSidecar, pythonPath, SidecarError } from "../src/sidecar/client.js";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

function configWith(python?: string): Config {
  return {
    repoRoot: REPO,
    stateDir: `${REPO}/.hammer-mcp`,
    toolAllowlist: [],
    ...(python ? { sidecarPython: python } : {}),
  } as unknown as Config;
}

describe("sidecar client, when it is not installed", () => {
  const broken = configWith("/nonexistent/python");

  it("probeSidecar reports the breakage instead of throwing", async () => {
    // health exists to describe a broken toolchain. If probing could throw, a missing
    // optional helper would turn the one tool meant to diagnose it into an outage.
    const status = await probeSidecar(broken);
    expect(status.installed).toBe(false);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain("setup.sh");
  });

  it("callSidecar throws, and says how to fix it", async () => {
    // The negative control for the test above: the same condition must be fatal on the
    // call path and non-fatal on the probe path. If both merely reported, a real call
    // would return undefined and the failure would surface far from its cause.
    await expect(callSidecar("health", {}, broken)).rejects.toThrow(SidecarError);
    await expect(callSidecar("health", {}, broken)).rejects.toThrow(/setup\.sh/);
  });
});

describe("sidecar client, against the real venv", () => {
  const config = configWith();
  const installed = existsSync(pythonPath(config));

  // `skipIf` rather than an early return: a test that quietly returns reports green,
  // and a green suite on a machine with no venv would claim a proof it never made.
  // Skipped shows as skipped.
  it.skipIf(!installed)("reports srctools and its own Python", async () => {
    const status = await probeSidecar(config);
    expect(status.ok).toBe(true);
    expect(status.srctools).toMatch(/^\d+\.\d+/);
    expect(status.pythonVersion).toMatch(/^3\./);
  });

  it.skipIf(!installed)("refuses an unknown verb with the list of known ones", async () => {
    await expect(callSidecar("no_such_verb", {}, config)).rejects.toThrow(/unknown verb/);
  });

  it.skipIf(!installed)("passes the request through stdin", async () => {
    // The bug this pins: run() used to leave stdin open, so the sidecar's
    // sys.stdin.read() waited for an EOF that never came. The symptom was a timeout
    // that said nothing about stdin.
    const status = await callSidecar<{ ok: boolean }>("health", { probe: 1 }, config, 30_000);
    expect(status.ok).toBe(true);
  });
});
