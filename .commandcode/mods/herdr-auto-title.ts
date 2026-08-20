import type { ModApi } from "@commandcode/harness";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function enabled(): boolean {
  return (
    process.env.HERDR_ENV === "1" &&
    Boolean(process.env.HERDR_SOCKET_PATH) &&
    Boolean(process.env.HERDR_PANE_ID || process.env.HERDR_TAB_ID)
  );
}

function modDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return "";
  }
}

export default function (cmd: ModApi): void {
  function resolveGenerator(): string | undefined {
    const dir = modDir();
    if (dir) {
      const sibling = join(dir, "herdr_auto_title.py");
      if (existsSync(sibling)) return sibling;
      const parent = join(dir, "..", "herdr_auto_title.py");
      if (existsSync(parent)) return parent;
    }
    const cwdGen = join(cmd.cwd, "herdr_auto_title.py");
    if (existsSync(cwdGen)) return cwdGen;
    const projectGen = join(cmd.cwd, ".commandcode", "mods", "herdr_auto_title.py");
    if (existsSync(projectGen)) return projectGen;
    const homeGen = join(homedir(), ".commandcode", "mods", "herdr-auto-title", "herdr_auto_title.py");
    if (existsSync(homeGen)) return homeGen;
    return undefined;
  }

  cmd.hooks({
    transformInput: ({ text }) => {
      if (!enabled()) return { action: "continue" as const };
      const prompt = typeof text === "string" ? text.trim() : "";
      if (!prompt) return { action: "continue" as const };
      // Don't title slash commands themselves — the underlying prompt does
      if (prompt.startsWith("/")) return { action: "continue" as const };

      const gen = resolveGenerator();
      if (!gen) return { action: "continue" as const };

      // Session identity for state file — leafId is the durable branch id
      let sessionId: string | undefined;
      try {
        sessionId = cmd.sessions?.leafId?.();
      } catch {
        sessionId = undefined;
      }
      // Fallback: use cwd hash-ish identifier when sessions API unavailable
      if (!sessionId) sessionId = `cmd-${cmd.cwd}`;

      const payload = JSON.stringify({
        agent: "cmd",
        session_id: sessionId,
        prompt,
        // model is available via context at run time, but transformInput
        // has no model param — python will use DEFAULT_MODEL[cmd] or env
      });

      const child = spawn("python3", [gen], {
        cwd: cmd.cwd,
        detached: true,
        env: process.env,
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.on("error", () => undefined);
      child.stdin.on("error", () => undefined);
      child.stdin.end(`${payload}\n`);
      child.unref();

      return { action: "continue" as const };
    },
  });
}
