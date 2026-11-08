import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { config } from "./config/index.js";
import { BrowserManager } from "./browser/manager.js";
import { info } from "./browser/logger.js";

async function promptToClose(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  info("Press Enter here after you finish logging in and want to keep the profile for MCP use.");
  await rl.question("");
  rl.close();
}

async function main(): Promise<void> {
  if (!config.moodleUrl) {
    info("MOODLE_URL is not set. Open your Moodle site manually in the launched browser.");
  }

  const manager = new BrowserManager({ headless: false });

  try {
    info(
      `Setup resolved browser profile: ${manager.getProfilePath()} (cwd=${process.cwd()})`,
    );
    await manager.launch();
    const page = await manager.ensureReady();

    if (config.moodleUrl) {
      info(`Opening ${config.moodleUrl} for manual login...`);
      await page.goto(config.moodleUrl, { waitUntil: "domcontentloaded" });
    } else {
      info("Chromium launched in headed mode. Navigate to your Moodle site and log in manually.");
    }

    info(
      "Complete your school SSO/MFA login manually in the browser window. Do not close this process until finished.",
    );

    await promptToClose();
    await manager.saveSessionState();
    info(`Browser profile saved at ${manager.getProfilePath()}`);
    info("You can now start the MCP server with `npm start`.");
  } finally {
    await manager.close();
  }
}

main().catch((error) => {
  console.error("Setup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
