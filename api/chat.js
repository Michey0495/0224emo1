// ============================================================
// emo1 - チャット API（Vercel Serverless Function）
// ============================================================

const OpenAI = require("openai");
const sanitizeHtml = require("sanitize-html");

// --- ストリーミング対応のため最大60秒に設定 ---
export const config = {
  maxDuration: 60,
};

// --- セミナーアシスタント用システムプロンプト ---
const DEFAULT_SYSTEM_PROMPT = `あなたは「emo1」セミナーのアシスタントです。
静岡で開催されている、ブラウザで動くAIチャットアプリ開発のセミナーに参加している受講者をサポートする役割を担っています。

このセミナーで扱っているテーマ:
- Node.js + Express によるサーバー構築と OpenAI API の活用
- SSE（Server-Sent Events）によるリアルタイムストリーミング応答
- Vanilla HTML/CSS/JavaScript でのモバイルファーストUI設計
- AI生成コードに潜むセキュリティリスク（XSS、APIキー漏洩、インジェクション）と具体的な対策
- sanitize-html / Helmet / express-rate-limit によるサーバー防御
- AI生成コードの品質管理、依存関係の精査、著作権やライセンスへの注意

話し方のルール:
- 日本語で回答する
- 「です・ます」調で丁寧に、ただし堅すぎず親しみやすいトーンを心がける
- 絵文字は一切使わない
- 結論を先に述べ、詳細は後から補足する
- コードに関する質問にはコード例を添える
- わからないことには「わかりません」と正直に伝える
- 質問の意図を汲み取り、聞かれていないことまで長々と語らない`;

// --- ユーティリティ ---
function sanitizeInput(text) {
  if (typeof text !== "string") return "";
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    return { valid: false, error: "messages は配列で送信してください。" };
  }
  if (messages.length === 0) {
    return { valid: false, error: "messages が空です。" };
  }
  const allowedRoles = ["user", "assistant"];
  const sanitized = messages.map((msg) => {
    const role = allowedRoles.includes(msg.role) ? msg.role : "user";
    const content = sanitizeInput(msg.content);
    return { role, content };
  });
  return { valid: true, messages: sanitized };
}

// --- Vercel Serverless Function ハンドラ ---
module.exports = async function handler(req, res) {
  // CORS ヘッダー
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // プリフライトリクエスト
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // POST のみ許可
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // APIキー確認
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY が設定されていません。",
    });
  }

  const { messages, systemPrompt, model } = req.body;

  // モデルのバリデーション
  const allowedModels = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];
  const selectedModel = allowedModels.includes(model) ? model : "gpt-4o-mini";

  // メッセージのバリデーション
  const validation = validateMessages(messages);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // システムプロンプトの組み立て
  const system = sanitizeInput(systemPrompt) || DEFAULT_SYSTEM_PROMPT;

  const chatMessages = [
    { role: "system", content: system },
    ...validation.messages,
  ];

  // SSE ヘッダー
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const stream = await openai.chat.completions.create({
      model: selectedModel,
      messages: chatMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error) {
    console.error("OpenAI API エラー:", error.message);

    if (!res.headersSent) {
      return res.status(500).json({
        error: "AIからの応答取得に失敗しました。",
      });
    }

    res.write(
      `data: ${JSON.stringify({ error: "応答中にエラーが発生しました。" })}\n\n`
    );
    res.end();
  }
};
