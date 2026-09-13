/**
 * Intron (Sahara Voice AI) STT — supported languages.
 *
 * The synchronous file-upload client that used to live here has been removed.
 * On this account `/file/v1/upload/sync` rejects anything longer than about
 * five seconds with "insufficient balance to process the file" — reproducibly,
 * and while the streaming handshake reports a healthy credit balance. Since
 * AfriSwitch utterances average ~12s and spoken commands routinely run longer,
 * every caller uses the streaming client in intronStream.ts instead.
 */

/** Intron documents code-switching support for 11 pairs; these are the AfriSwitch ones. */
export const INTRON_SUPPORTED: ReadonlySet<string> = new Set([
  "af",
  "am",
  "en",
  "ha",
  "ig",
  "lg",
  "pcm",
  "rw",
  "sw",
  "yo",
  "zu",
  "fr",
  "sn",
  "tn",
  "om",
]);
