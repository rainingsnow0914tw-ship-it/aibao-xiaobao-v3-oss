# 阿寶 & 小寶 — 給長輩的家庭 AI 夥伴 / Family AI Companions for Elders

兩隻跑在 LINE 上的家庭 AI:**阿寶**(家族群組裡的晚輩,叫名字才回話,每天推一則早報)與**小寶**(一對一的私人小秘書)。真實用戶是一位 75 歲的長輩,每天在用。

Two LINE-based family AI companions: **Abao** (a junior family member in the group chat — replies only when called by name, pushes a daily morning briefing) and **Xiaobao** (a one-on-one personal assistant). The primary real-world user is a 75-year-old elder who uses them every day.

> 📖 **活文件 / Living documentation**:這個專案的完整開發故事——每個架構決策、每次踩坑、每條家規的來龍去脈——以連載形式每天發表在 X:[@ChloeXChaCha](https://x.com/ChloeXChaCha)(中/英/日三語)。
> The full development story — every architecture decision, every pitfall, the reasoning behind every house rule — is serialized daily on X: [@ChloeXChaCha](https://x.com/ChloeXChaCha) (in Chinese, English, and Japanese).

## 架構 / Architecture

**一顆腦 + 一箱工具**(Unified Orchestrator + Function Calling):所有訊息直接進同一顆大腦(Gemini),由它自己決定何時取用工具箱裡的工具——沒有意圖分類層、沒有多 agent 轉手。

One brain + one toolbox: every message goes straight into a single brain (Gemini) that decides on its own when to reach for a tool — no intent-classification layer, no multi-agent handoffs.

設計重點 / Design highlights:

- **3 秒合批**(`batcher.js`):連發訊息合併成一次回覆,計時從第一則起算、不重置,上限 10 則——AI 不插嘴
- **兩速記憶**:對話原文 3 天 TTL 自動銷毀;每天深夜 LLM 精煉長期印象(上限 3,000 字,逼迫重寫而非追加);要緊事實由大腦當場寫進永久「小本本」(`remember`/`forget` 工具、6 類固定分類、系統時間戳)
- **逐崗位溫度**:排程整帳 0.2、提醒暖句 0.3+程式守門、氛圍摘要 0.4、畫圖高隨機——聰明集中,可靠分散
- **通路隔離**:群組記憶與一對一記憶物理分離,隱私靠水管不相通,不靠 AI 自律
- **主備雙畫師**:每日早安圖由 AI 現寫提示詞(25 主題 × 8 風格池),主力空手時備援接手;繁中祝福字由程式疊加(模型畫中文會鬼畫符)
- **誠實鐵律**:工具失敗必須照實說、查不到就說查不到、不准拿舊記憶充數

- **3-second batching** (`batcher.js`): burst messages merge into one reply; timer starts at the first message and never resets; cap of 10 — the AI doesn't interrupt
- **Two-speed memory**: raw chat expires after a 3-day TTL; a nightly LLM pass distills long-term impressions (3,000-char cap that forces rewriting over appending); critical facts get written instantly to a permanent notebook (`remember`/`forget` tools, 6 locked categories, system timestamps)
- **Per-job temperature**: schedule reconciliation 0.2, reminder phrasing 0.3 + a code-level gate, mood summaries 0.4, image generation high — concentrate the intelligence, distribute the reliability
- **Channel isolation**: group memory and one-on-one memory are physically separate; privacy comes from unconnected pipes, not AI self-discipline
- **Dual painters**: daily morning images from AI-written prompts (25-theme × 8-style pools) with a backup model when the primary returns empty; Traditional Chinese blessing text is overlaid by code (image models garble CJK)
- **Honesty as iron law**: failed tool calls must be reported truthfully; "not found" means saying "not found," never padding with stale memory

## 技術棧 / Stack

Node.js · Google Cloud Run · Firestore · Vertex AI (Gemini) · Cloud Tasks(精準排程提醒,取代輪詢)· LINE Messaging API · Cloud TTS(台灣腔語音)

## 目錄 / Layout

```
aibao-v3/    家族群組 bot(早報、提醒、畫圖、查證、記憶)
xiaobao-v3/  一對一 bot(TTS 語音、讀文件、提醒、記憶)
```

## 部署 / Deploy

這是參考實作(reference implementation),不是一鍵部署包。兩個服務各自 `gcloud run deploy --source .`,環境變數見 `.env.example`;密鑰一律放 Secret Manager,倉庫內零硬編碼。

This is a reference implementation, not a one-click deploy. Each service deploys via `gcloud run deploy --source .`; see `.env.example` for environment variables. All secrets live in Secret Manager — nothing is hardcoded in this repo.

## 隱私聲明 / Privacy note

公開版已去識別化:所有人名為虛構示例(阿哲、Chloe、阿姨等)、地區改為環境變數、內部座標已移除。生產環境的家人資料(記憶、檔案、對話)全部住在私有的 Firestore,不在本倉庫。

This public version is de-identified: all personal names are fictional placeholders, regions are env-configurable, and internal coordinates have been removed. Real family data (memories, profiles, conversations) lives in a private Firestore and is not part of this repository.

## License

MIT
