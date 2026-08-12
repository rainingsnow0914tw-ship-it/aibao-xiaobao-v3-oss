export const config = {
  vertexProject: process.env.VERTEX_PROJECT || "your-gcp-project",
  vertexLocation: process.env.VERTEX_LOCATION || "us-central1",
  vertexChatModel: process.env.VERTEX_CHAT_MODEL || "gemini-3.1-pro-preview",

  lineToken: (process.env.LINE_TOKEN || "").trim(),
  lineSecret: (process.env.LINE_SECRET || "").trim(),
  lineGroupId: (process.env.LINE_GROUP_ID || "").trim(),

  triggerKeyword: (process.env.TRIGGER_KEYWORD || "小寶").trim(),
  schedulerSecret: (process.env.SCHEDULER_SECRET || "").trim(),

  port: parseInt(process.env.PORT || "8080", 10),
};
