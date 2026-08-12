export const config = {
  vertexProject: process.env.VERTEX_PROJECT || "your-gcp-project",
  vertexLocation: process.env.VERTEX_LOCATION || "us-central1",
  vertexChatModel: process.env.VERTEX_CHAT_MODEL || "gemini-3.1-pro-preview",

  lineToken: (process.env.LINE_TOKEN || "").trim(),
  lineSecret: (process.env.LINE_SECRET || "").trim(),
  lineGroupId: (process.env.LINE_GROUP_ID || "").trim(),

  triggerKeyword: (process.env.TRIGGER_KEYWORD || "阿寶").trim(),
  schedulerSecret: (process.env.SCHEDULER_SECRET || "").trim(),

  // 早報天氣查詢的地區、依家人實際所在地設定（例：台北市）
  weatherRegion: (process.env.WEATHER_REGION || "台北市").trim(),

  // Cloud Tasks：提醒改成精準排程、不再每 5 分鐘 polling（2026-07-31）
  serviceUrl: (process.env.SERVICE_URL || "").trim(),
  tasksQueue: (process.env.TASKS_QUEUE || "reminders").trim(),
  tasksLocation: (process.env.TASKS_LOCATION || "us-central1").trim(),

  port: parseInt(process.env.PORT || "8080", 10),
};
