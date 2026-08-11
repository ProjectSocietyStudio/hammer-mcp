import { announceMissing } from "./env.js";

/**
 * Says once, before anything runs, what this machine cannot test.
 *
 * This lives in `globalSetup` rather than `setupFiles` for one reason: vitest runs each
 * test file in its own worker process, so a `setupFiles` module is loaded once *per file*
 * and its module-level "already announced" flag is useless across processes. The notice
 * came out sixteen times, which is how a useful warning turns into noise people learn to
 * scroll past.
 *
 * `globalSetup` runs once in the main process, before any worker starts.
 */
export default function setup(): void {
  announceMissing();
}
