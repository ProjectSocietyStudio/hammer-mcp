import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  discoverSourceInstalls,
  installedApps,
  libraryPaths,
  modDirs,
  steamRoots,
} from "../src/games/steam.js";
import { has } from "./support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-steam-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A Steam installation, built from the same shapes the real files have.
 *
 * Fabricated rather than copied: the real files carry the machine's home directory and
 * every addon installed on it, and a fixture that leaks those is the reason
 * test/fixtures/logs had to be scrubbed once already.
 */
function fakeSteam(name: string, opts: { symlinkAs?: string } = {}): string {
  const root = join(scratch, name);
  const apps = join(root, "steamapps");
  mkdirSync(join(apps, "common", "TestGame", "testmod"), { recursive: true });
  mkdirSync(join(apps, "common", "TestGame", "bin"), { recursive: true });

  writeFileSync(
    join(apps, "libraryfolders.vdf"),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${root}"\n\t\t"apps"\n\t\t{\n\t\t\t"70"\t\t"1"\n\t\t}\n\t}\n}\n`,
  );
  writeFileSync(
    join(apps, "appmanifest_70.acf"),
    `"AppState"\n{\n\t"appid"\t\t"70"\n\t"name"\t\t"Test Game"\n\t"installdir"\t\t"TestGame"\n\t"UserConfig"\n\t{\n\t\t"BetaKey"\t\t"x86-64"\n\t}\n}\n`,
  );
  // A manifest for something that never finished downloading: no directory on disk.
  writeFileSync(
    join(apps, "appmanifest_999.acf"),
    `"AppState"\n{\n\t"appid"\t\t"999"\n\t"name"\t\t"Never Installed"\n\t"installdir"\t\t"Ghost"\n}\n`,
  );
  writeFileSync(
    join(apps, "common", "TestGame", "testmod", "gameinfo.txt"),
    `"GameInfo"\n{\n\tgame\t"Test Game"\n\t// Just to shut up vbsp.exe\n\t"GameData"\t\t"testmod.fgd"\n\t"InstancePath"\t"maps/instances/"\n\n\tFileSystem\n\t{\n\t\tSteamAppId\t\t\t70\n\t}\n}\n`,
  );
  writeFileSync(join(apps, "common", "TestGame", "bin", "vbsp.exe"), "stub");

  if (opts.symlinkAs) {
    // Reproduces the Debian layout exactly: ~/.steam/steam is a symlink to the real
    // installation directory, so both paths are candidates and both resolve to one tree.
    const link = join(scratch, opts.symlinkAs);
    mkdirSync(join(link, ".."), { recursive: true });
    symlinkSync(root, link);
  }
  return root;
}

describe("reading Steam's own files", () => {
  const real = fakeSteam("install", { symlinkAs: ".steam/steam" });

  it("finds a library, its installed app and its beta branch", () => {
    const libs = libraryPaths(real);
    expect(libs).toHaveLength(1);

    const apps = installedApps(libs[0]!);
    expect(apps.map((a) => a.appId)).toEqual([70, 999]);

    const game = apps.find((a) => a.appId === 70)!;
    expect(game.name).toBe("Test Game");
    expect(game.installDir).toBe("TestGame");
    expect(game.betaKey).toBe("x86-64");
    expect(game.gameRoot).not.toBeNull();

    // A manifest without files is reported as not installed, not as an error and not as
    // an absence: Steam keeps manifests for interrupted downloads.
    expect(apps.find((a) => a.appId === 999)!.gameRoot).toBeNull();
  });

  it("takes the FGD from the game rather than from a table", () => {
    // The whole point of the module. `GameData "testmod.fgd"` is a fact on disk; a
    // per-game FGD name written in TypeScript would be an assertion nobody checked.
    const mods = modDirs(join(real, "steamapps", "common", "TestGame"));
    expect(mods).toHaveLength(1);
    expect(mods[0]!.dir).toBe("testmod");
    expect(mods[0]!.displayName).toBe("Test Game");
    expect(mods[0]!.steamAppId).toBe(70);
    expect(mods[0]!.fgd).toEqual(["testmod.fgd"]);
    expect(mods[0]!.instancePath).toBe("maps/instances/");
  });

  it("survives the comment Valve leaves in every gameinfo.txt", () => {
    // The real GMod file carries `// Just to shut up vbsp.exe` immediately before the
    // GameData line. A lexer that does not drop `//` comments swallows the FGD name.
    const mods = modDirs(join(real, "steamapps", "common", "TestGame"));
    expect(mods[0]!.fgd).toEqual(["testmod.fgd"]);
  });

  it("counts a symlinked Steam root once, not twice", () => {
    // ~/.steam/steam is a symlink to ~/.steam/debian-installation on Debian and Ubuntu.
    // Without realpath deduplication every game on such a machine is discovered twice.
    // Two candidates, one tree: STEAM_ROOT names it directly, and ~/.steam/steam is a
    // symlink to it. Without realpath they are two strings and the game is found twice.
    const env = { HOME: scratch, STEAM_ROOT: join(scratch, "install") } as NodeJS.ProcessEnv;
    const roots = steamRoots(env);
    expect(roots).toHaveLength(1);

    const installs = discoverSourceInstalls(env);
    expect(installs).toHaveLength(1);
    expect(installs[0]!.app.appId).toBe(70);
    expect(installs[0]!.stock.binaries["vbsp.exe"]).toBe(true);
    // Reported as incomplete rather than usable: only vbsp.exe was written above, and
    // "some of the compilers" is the state that fails at the second stage of a compile.
    expect(installs[0]!.stock.complete).toBe(false);
    expect(installs[0]!.plusplus.dir).toContain("win64");
    expect(installs[0]!.plusplus.complete).toBe(false);
  });

  it("reports nothing, and does not throw, when there is no Steam at all", () => {
    const empty = mkdtempSync(join(tmpdir(), "hammer-nosteam-"));
    try {
      const env = { HOME: empty, STEAM_ROOT: undefined } as NodeJS.ProcessEnv;
      expect(steamRoots(env)).toEqual([]);
      expect(discoverSourceInstalls(env)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("ignores a directory that is not a Source game", () => {
    // An install with no gameinfo.txt anywhere is not a Source game, however many other
    // appids sit in the same library. Most of a real Steam library is exactly this.
    const root = join(scratch, "nonsource");
    mkdirSync(join(root, "steamapps", "common", "Whatever", "data"), { recursive: true });
    writeFileSync(
      join(root, "steamapps", "appmanifest_1.acf"),
      `"AppState"\n{\n\t"appid"\t\t"1"\n\t"name"\t\t"Not Source"\n\t"installdir"\t\t"Whatever"\n}\n`,
    );
    // HOME points at an empty directory on purpose: the scratch root holds the fake
    // .steam/steam of the tests above, and inheriting it would discover that game here.
    const bareHome = mkdtempSync(join(tmpdir(), "hammer-home-"));
    try {
      const env = { HOME: bareHome, STEAM_ROOT: root } as NodeJS.ProcessEnv;
      expect(discoverSourceInstalls(env)).toEqual([]);
    } finally {
      rmSync(bareHome, { recursive: true, force: true });
    }
  });
});

describe("against the Steam installation on this machine", () => {
  // Skipped rather than mocked when there is no game here: the value of this test is
  // precisely that it reads files nobody in this repo wrote.
  it.skipIf(!has.toolchain)("finds the real install the config points at", () => {
    const installs = discoverSourceInstalls();
    expect(installs.length).toBeGreaterThan(0);

    const mods = installs.flatMap((i) => i.mods);
    // Every Source game declares at least one FGD; a run that found games but no FGD
    // means gameinfo parsing silently returned nothing.
    expect(mods.some((m) => m.fgd.length > 0)).toBe(true);

    const roots = installs.map((i) => i.app.gameRoot);
    expect(new Set(roots).size).toBe(roots.length);
  });
});
