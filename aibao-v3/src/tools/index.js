import { VERTEX_TOOLS } from "./specs.js";
import { executeSetReminder } from "./set_reminder.js";
import { executeReadUrl } from "./read_url.js";
import { executeGetMorningBrief } from "./morning_brief.js";
import { executeAnalyzeYoutube } from "./analyze_youtube.js";
import { executeGenerateImage } from "./generate_image.js";
import { executeRemember } from "./remember.js";
import { executeForget } from "./forget.js";
import { executeCheckHealth } from "./check_health.js";

export { VERTEX_TOOLS };

const HANDLERS = {
  remember: executeRemember,
  forget: executeForget,
  check_health: executeCheckHealth,
  set_reminder: executeSetReminder,
  read_url: executeReadUrl,
  get_morning_brief: executeGetMorningBrief,
  analyze_youtube: executeAnalyzeYoutube,
  generate_image: executeGenerateImage,
};

export async function dispatchTool(name, args, ctx) {
  const handler = HANDLERS[name];
  if (!handler) {
    return { status: "error", error: `unknown tool: ${name}` };
  }
  try {
    return await handler(args || {}, ctx || {});
  } catch (e) {
    console.error(`[tool.${name}] uncaught:`, e.message);
    return { status: "error", error: e.message };
  }
}
