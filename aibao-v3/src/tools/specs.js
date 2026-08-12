export const SET_REMINDER_SPEC = {
  name: "set_reminder",
  description:
    "為家人設定一個提醒。當家人說「下午 3 點提醒我吃藥」或「明天早上 7 點叫我起床」時呼叫。" +
    "提醒會在指定時間透過 LINE push 發到這個群組。" +
    "fire_time_iso 一定要是 ISO 8601 帶 Asia/Taipei 時區偏移 +08:00 的格式。",
  parameters: {
    type: "OBJECT",
    properties: {
      fire_time_iso: {
        type: "STRING",
        description:
          "提醒觸發時間、ISO 8601 格式帶 +08:00 時區、例如 '2026-07-14T15:00:00+08:00'。" +
          "如果家人只說『明天早上』沒指定時間、預設 09:00。" +
          "如果家人說『下午 3 點』但沒指定日期、預設今天（如果現在已過 3 點就設明天）。",
      },
      content: {
        type: "STRING",
        description: "提醒的內容、家人要被提醒做什麼、例如 '吃藥' 或 '起床準備早餐'",
      },
    },
    required: ["fire_time_iso", "content"],
  },
};

export const READ_URL_SPEC = {
  name: "read_url",
  description:
    "當家人在群組貼一個網址、想知道網頁內容摘要、或想知道這個網頁是不是詐騙/廣告/假新聞時、呼叫這個 tool。" +
    "會抓網頁內容並產生 100-180 字摘要 + 詐騙可疑度評估。" +
    "適合家人問「這個網站在講什麼？」「這個是不是詐騙？」「幫我看一下這個網址」。",
  parameters: {
    type: "OBJECT",
    properties: {
      url: {
        type: "STRING",
        description: "要讀取的完整網頁 URL、必須 http:// 或 https:// 開頭",
      },
    },
    required: ["url"],
  },
};

export const GET_MORNING_BRIEF_SPEC = {
  name: "get_morning_brief",
  description:
    "當家人問「今天的早報呢」「阿寶今天早報講什麼」或想再看一次今天的早報時、呼叫這個 tool。" +
    "會回今天已生成過的早報（cache 命中）或現生一份。" +
    "早報每天上午 8 點會自動 push 到群組、家人主動要看就用這個 tool。",
  parameters: {
    type: "OBJECT",
    properties: {},
    required: [],
  },
};

export const ANALYZE_YOUTUBE_SPEC = {
  name: "analyze_youtube",
  description: "分析 YouTube 影片內容 (畫面幀 + 字幕)、產生摘要或回答家人的問題。適合家人問「這 YT 講什麼」「幫我看這個影片」。",
  parameters: {
    type: "OBJECT",
    properties: {
      url: {
        type: "STRING",
        description: "YouTube 影片完整 URL",
      },
    },
    required: ["url"],
  },
};

export const GENERATE_IMAGE_SPEC = {
  name: "generate_image",
  description: "當家人請你畫圖時（例：「阿寶畫一朵花」「幫我畫早安圖」）呼叫。會生圖上傳雲端、後端自動附進 reply。prompt 越具體越好、可包含風格、色調、主體、場景。中英文皆可。",
  parameters: {
    type: "OBJECT",
    properties: {
      prompt: {
        type: "STRING",
        description: "畫圖提示、越具體越好",
      },
    },
    required: ["prompt"],
  },
};

export const REMEMBER_SPEC = {
  name: "remember",
  description:
    "把一件事馬上寫進「小本本」永久記住。當家人說「記住」「幫我記一下」「別忘了」「以後要知道」時呼叫；" +
    "或當家人透露值得長期記住的事實（過敏、慢性病、用藥、生日、口味偏好、家人寵物狀況、長期目標、忌諱）時主動呼叫。" +
    "寫進去的事會永久保留、每次對話開頭都看得到、不會像一般聊天記錄那樣三天後過期。" +
    "不要記瑣碎或一次性的事（今天天氣、剛剛的玩笑、暫時心情）——那些一般對話記憶就夠了。" +
    "同一件事已經在小本本裡就不要重複寫。" +
    "【公正第三方職責】金錢往來、借還、誰買了什麼花多少、誰答應了什麼、誰說過什麼——這類以後可能有人翻舊帳的事、" +
    "就算家人沒明說「記住」、你也要主動 remember、category 用「約定」。你是家人之間的中立記錄者、不偏袒任何人。" +
    "這種紀錄的 text 裡一定要自己寫進完整日期時間（例如「2026-07-17 00:27 阿哲買 OpenAI API 花了 10 美金」）、不要只寫「買了 API」。" +
    "【誠實鐵律】tool 回 status=error 時要照實跟家人說沒記成功、絕對不可以假裝已經記好了。",
  parameters: {
    type: "OBJECT",
    properties: {
      text: {
        type: "STRING",
        description:
          "要記住的事、一句話講完、用第三人稱陳述句。例如「對花生過敏、吃到會起疹子」「喜歡喝無糖熱茶、不喝冰的」「十一月要去日本旅行」",
      },
      category: {
        type: "STRING",
        enum: ["健康", "偏好", "家人", "工作", "約定", "其他"],
        description:
          "分類：健康（過敏/疾病/用藥/身體狀況）、偏好（喜好/口味/習慣/忌諱）、家人（家庭成員/寵物/關係）、工作（職業/專案/長期目標）、" +
          "約定（金錢往來/借還/承諾/誰答應了什麼/以後可能翻舊帳的事）、其他（放不進上面五類的）",
      },
      about: {
        type: "STRING",
        description:
          "這件事是關於誰、填那個人的暱稱。家人講自己的事就填他自己的暱稱；家人講別人的事（例如「阿寶記住阿姨對花生過敏」）就填那個人的暱稱。",
      },
    },
    required: ["text", "category", "about"],
  },
};

export const FORGET_SPEC = {
  name: "forget",
  description:
    "把小本本裡某一條刪掉。當家人說「那個不用記了」「我現在不是這樣了」「那條刪掉」「忘記那件事」時呼叫。" +
    "memory_id 從系統指令裡【小本本】清單每條前面中括號的 id 抄（看到 [m_a1b2] 就填 m_a1b2）。" +
    "如果家人是要「修改」某條、先 forget 舊的、再 remember 新的。",
  parameters: {
    type: "OBJECT",
    properties: {
      memory_id: {
        type: "STRING",
        description: "要刪掉那條的 id、格式像 m_a1b2、從小本本清單的中括號裡抄、不要自己編",
      },
    },
    required: ["memory_id"],
  },
};

export const CHECK_HEALTH_SPEC = {
  name: "check_health",
  description:
    "查後端連線狀況。當家人問「LINE 現在穩不穩」「訊息有沒有延遲」「後端還好嗎」「剛才是不是很慢」這類系統狀態問題時呼叫。" +
    "會回報：最近訊息的收發延遲（LINE 送出 → 後端收到差幾毫秒）的平均/最大/最小、最後一則訊息時間、多久沒收到訊息。" +
    "【重要限制、回答時不可以講錯】這個工具只看得到「已經收到並存下來」的訊息。" +
    "它**無法偵測漏接**——沒收到的訊息不會出現在任何紀錄裡。" +
    "如果某段時間沒有訊息、那可能只是沒人講話、**不可以說成「漏接」或「掉訊息」**。" +
    "延遲數字通常幾百毫秒到兩三秒是正常的、超過十秒才值得提。",
  parameters: {
    type: "OBJECT",
    properties: {
      reason: {
        type: "STRING",
        description: "為什麼要查（選填、只是留在 log 方便日後追）",
      },
    },
  },
};

export const ALL_FUNCTION_DECLARATIONS = [
  REMEMBER_SPEC,
  FORGET_SPEC,
  CHECK_HEALTH_SPEC,
  SET_REMINDER_SPEC,
  READ_URL_SPEC,
  GET_MORNING_BRIEF_SPEC,
  GENERATE_IMAGE_SPEC,
  // ANALYZE_YOUTUBE_SPEC,  // native multimodal 直接 inject file_data、tool 保留備用
];

export const VERTEX_TOOLS = [
  { functionDeclarations: ALL_FUNCTION_DECLARATIONS },
];
