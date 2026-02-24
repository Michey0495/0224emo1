// ============================================================
// 0224emo1 - AIチャットアプリ サーバー
// 静岡セミナー完成版デモ
// ============================================================

// --- 環境変数の読み込み ---
const dotenv = require("dotenv");
dotenv.config();

// --- パッケージの読み込み ---
const express = require("express");
const OpenAI = require("openai");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const sanitizeHtml = require("sanitize-html");
const path = require("path");

// --- 設定値 ---
const PORT = process.env.PORT || 3000;

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

// --- OpenAI クライアントの初期化（遅延） ---
// APIキー未設定でも起動できるようにする
let openai = null;

function getOpenAIClient() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// --- Express アプリの作成 ---
const app = express();

// --- セキュリティヘッダー（helmet） ---
// Content-Security-Policy はフロントエンドの動作に影響するため緩和設定
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// --- CORS 設定 ---
// セミナー環境ではローカルからのアクセスのみ想定
app.use(cors());

// --- JSON パーサー ---
app.use(express.json({ limit: "1mb" }));

// --- 静的ファイル配信 ---
// public フォルダの中身をそのままブラウザに返す
app.use(express.static(path.join(__dirname, "public")));

// --- レート制限 ---
// 1分あたり20リクエストまで（同一IPごと）
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "リクエスト回数の上限に達しました。1分後に再度お試しください。",
  },
});

// /api 以下のルートにレート制限を適用
app.use("/api", apiLimiter);

// ============================================================
// ユーティリティ関数
// ============================================================

// ユーザー入力のサニタイズ
// HTMLタグをすべて除去し、プレーンテキストのみ残す
function sanitizeInput(text) {
  if (typeof text !== "string") return "";
  return sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {},
  });
}

// メッセージ配列のバリデーションとサニタイズ
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

// ============================================================
// API エンドポイント
// ============================================================

// --- ヘルスチェック ---
app.get("/api/health", (_req, res) => {
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
  res.json({
    status: "ok",
    apiKeyConfigured: hasApiKey,
    timestamp: new Date().toISOString(),
  });
});

// --- チャット API（ストリーミング対応） ---
app.post("/api/chat", async (req, res) => {
  // APIキーが未設定ならここで弾く
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error:
        "OPENAI_API_KEY が設定されていません。.env ファイルを確認してください。",
    });
  }

  // リクエストボディから messages, systemPrompt, model を取り出す
  const { messages, systemPrompt, model } = req.body;

  // 使用モデルのバリデーション
  const allowedModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'];
  const selectedModel = allowedModels.includes(model) ? model : 'gpt-4o-mini';

  // メッセージのバリデーション
  const validation = validateMessages(messages);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // システムプロンプトの組み立て
  const system = sanitizeInput(systemPrompt) || DEFAULT_SYSTEM_PROMPT;

  // OpenAI に送るメッセージ配列を組み立てる
  const chatMessages = [
    { role: "system", content: system },
    ...validation.messages,
  ];

  // SSE（Server-Sent Events）のレスポンスヘッダーを設定
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // OpenAI API をストリーミングモードで呼び出す
    const client = getOpenAIClient();
    const stream = await client.chat.completions.create({
      model: selectedModel,
      messages: chatMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    });

    // ストリームからチャンクを受け取り、SSE 形式でクライアントに送信
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        // SSE の data フィールドとして送信
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    // ストリーム完了を通知（SSE標準に合わせた形式）
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error) {
    console.error("OpenAI API エラー:", error.message);

    // ストリーミング開始前のエラーなら JSON で返す
    // ヘッダー送信済みなら SSE 形式でエラーを送る
    if (!res.headersSent) {
      return res.status(500).json({
        error: "AIからの応答取得に失敗しました。",
        detail: error.message,
      });
    }

    res.write(
      `data: ${JSON.stringify({ error: "AIからの応答中にエラーが発生しました。" })}\n\n`
    );
    res.end();
  }
});

// ============================================================
// サーバー起動
// ============================================================

app.listen(PORT, () => {
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
  console.log(`-----------------------------------------`);
  console.log(`  0224emo1 サーバー起動`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  APIキー: ${hasApiKey ? "設定済み" : "未設定（.envを確認）"}`);
  console.log(`-----------------------------------------`);
});
