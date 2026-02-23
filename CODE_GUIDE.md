# コード解説ガイド

emo1 セミナー資料 | 2026年2月24日
Author: Givery EZOAI 安田光喜

---

このドキュメントでは emo1 の全コンポーネントを順に解説します。セミナー中にコードを見せながら説明する際のリファレンスとしてお使いください。


## 1. 全体構成

### クライアント・サーバーアーキテクチャ

emo1 は2つの層で動いています。

ブラウザ側（クライアント）: `public/` フォルダ内の HTML/CSS/JS がそのままブラウザに配信されます。ユーザーの入力を受け取り、サーバーへ POST リクエストを送信し、返ってきた応答を画面に描画する役割を担っています。

サーバー側: `server.js` が Express サーバーとして起動します。ブラウザからのリクエストを受け取り、OpenAI API を呼び出して結果をストリーミング返却する仕組みです。APIキーの管理もサーバー側が担います。

```
ブラウザ (public/)          サーバー (server.js)         外部API
┌─────────────────┐    POST /api/chat     ┌───────────┐    ┌──────────┐
│  index.html     │ ──────────────────→   │  Express  │ ──→│ OpenAI   │
│  style.css      │ ←── SSE ストリーム ── │           │ ←──│ API      │
│  app.js         │                       └───────────┘    └──────────┘
└─────────────────┘
```

### なぜフレームワークを使わないのか

React、Vue、Svelte のようなフレームワークを使えば開発効率は上がります。それでも今回はあえて Vanilla JS（素のJavaScript）で構成しました。理由は3つあります。

1つ目。セミナーの教材として、ブラウザの標準APIだけでアプリが動く仕組みを理解していただきたいと考えました。フレームワーク固有の概念（仮想DOM、リアクティビティ、コンパイルステップ）を挟むと、HTTP通信やDOM操作といった根本の動きが見えにくくなります。

2つ目。依存を最小限にしたいという意図があります。フレームワークを入れるとビルドツール（Vite, Webpack）も必要になり、セットアップの手間が増えてしまいます。`npm install` して `npm start` するだけで動く手軽さを重視しました。

3つ目。配布のしやすさです。受講者にフォルダごと渡して、すぐ動かせる状態にしておきたかったという事情によります。

### ファイル構成の意図

```
server.js      → サーバーロジックを1ファイルに集約
public/
  index.html   → 構造（HTML）
  css/style.css → 見た目（CSS）
  js/app.js    → 振る舞い（JS）
  assets/      → 画像等の静的リソース
```

HTML/CSS/JS を分離しているのは「構造・見た目・振る舞い」の関心を分けるためです。これはWebアプリケーション設計の基本原則であり、フレームワークの有無に関わらず通用する考え方といえます。


## 2. server.js の解説

### 2-1. Express の基本

server.js の冒頭で Express アプリを作成し、ミドルウェアを積み上げていきます。

```javascript
const app = express();
```

この1行で HTTP サーバーの雛形ができます。あとは `app.use()` でミドルウェア（リクエストを処理する関数群）を追加し、`app.get()` / `app.post()` でルートを定義するだけです。

ミドルウェアの適用順序には意味があります。server.js では以下の順で積んでいます。

1. `helmet()` ... セキュリティヘッダーの付与
2. `cors()` ... CORS ヘッダーの付与
3. `express.json()` ... リクエストボディのJSON解析
4. `express.static()` ... 静的ファイル配信
5. `rateLimit()` ... `/api` 以下へのレート制限

セキュリティ関連のミドルウェアを先に適用し、ビジネスロジック（APIルート）を後に配置するという設計思想に基づいています。

### 2-2. OpenAI API との通信

```javascript
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

OpenAI の公式 Node.js クライアントを使用しています。APIキーは `process.env` から取得するため、ソースコードにキーが露出しません。

API呼び出しの核心部分を見てみましょう。

```javascript
const stream = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: chatMessages,
  stream: true,
  temperature: 0.7,
  max_tokens: 2048,
});
```

`stream: true` を指定すると、完全なレスポンスを待たずにトークン単位でデータが返ってきます。`temperature: 0.7` は応答のランダム性で、0に近いほど決定的、2に近いほど多様になります。`max_tokens: 2048` は応答の上限長を示しています。

### 2-3. SSE（Server-Sent Events）の仕組み

ストリーミング応答を実現するのが SSE です。HTTP の仕組みの上で、サーバーからクライアントへデータを逐次送信できます。

```javascript
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Connection", "keep-alive");
```

この3つのヘッダーが SSE の定型設定です。`text/event-stream` という Content-Type がブラウザに「これはSSEである」と伝えます。

データ送信のフォーマットは `data: JSON文字列\n\n` です。末尾の空行2つ（`\n\n`）が1つのイベントの区切りになります。

```javascript
for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    res.write(`data: ${JSON.stringify({ content })}\n\n`);
  }
}
```

`for await...of` は非同期イテレータの構文です。OpenAI SDK が返すストリームオブジェクトからチャンク（断片）を1つずつ取り出し、SSE形式に変換してブラウザに送ります。

### 2-4. セキュリティミドルウェアの役割

Helmet: レスポンスに `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` などのセキュリティヘッダーを自動付与します。ブラウザにMIMEタイプスニッフィングを禁止させたり、クリックジャッキングを防いだりする働きがあります。`contentSecurityPolicy: false` にしているのは、インラインスタイルやスクリプトの評価を許可するためです。本番環境では CSP を適切に設定すべきでしょう。

express-rate-limit: 同一IPアドレスからのリクエスト数を制限します。1分あたり20回を超えると 429 Too Many Requests を返す仕組みです。APIの不正利用やDDoS攻撃の緩和に効果があります。

sanitize-html: ユーザー入力からHTMLタグを完全に除去します。`allowedTags: []` の設定で、一切のタグを許可していません。

### 2-5. 入力バリデーション

```javascript
function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    return { valid: false, error: "messages は配列で送信してください。" };
  }
  const allowedRoles = ["user", "assistant"];
  const sanitized = messages.map((msg) => {
    const role = allowedRoles.includes(msg.role) ? msg.role : "user";
    const content = sanitizeInput(msg.content);
    return { role, content };
  });
  return { valid: true, messages: sanitized };
}
```

この関数は防御的プログラミングの実例です。受け取ったデータが配列かどうか、ロールが許可リストに含まれるかを検証し、不正な値は安全なデフォルトに差し替えます。サニタイズ済みのデータだけが OpenAI API に到達する設計になっています。


## 3. index.html の解説

### 3-1. セマンティックHTML

```html
<header class="header">...</header>
<main class="chat-container">...</main>
<footer class="input-area">...</footer>
```

`<div>` だけで組むこともできますが、`<header>` `<main>` `<footer>` というセマンティックタグを使うことで、文書の構造がタグ名から読み取れるようになります。スクリーンリーダー（視覚障害者向けの読み上げソフト）もこれらのタグを手がかりにページ内のナビゲーションを行います。

### 3-2. メタタグの役割

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

`viewport` メタタグがないと、スマートフォンでページを開いた際にPC向けのレイアウトが縮小表示されてしまいます。`viewport-fit=cover` は iPhone のノッチ部分までレイアウトを拡張する指定です。

```html
<meta property="og:title" content="emo1 - AI Chat">
<meta property="og:description" content="ブラウザで動くAIチャットアプリ">
```

OGP（Open Graph Protocol）タグです。SNS やメッセンジャーで URL を共有した際に表示されるプレビューカードの情報源になります。

### 3-3. アクセシビリティへの配慮

```html
<button class="send-btn" id="send-btn" type="button" disabled aria-label="送信">
```

`aria-label` 属性はスクリーンリーダーに対して「このボタンは送信ボタンである」と伝えるものです。ボタンの中身がアイコン（SVG）だけの場合、テキストがないのでスクリーンリーダーはボタンの用途を判別できません。`aria-label` がその補完をしてくれます。

```html
<div class="modal" role="dialog" aria-label="設定">
```

`role="dialog"` はモーダルウィンドウであることを支援技術に通知します。WAI-ARIA の仕様に沿った記述です。

### 3-4. ウェルカムカードのパターン

```html
<button class="welcome-card" data-prompt="静岡県のおすすめ観光スポットを教えて" type="button">
```

`data-prompt` カスタムデータ属性にプロンプトのテキストを持たせておき、クリック時に JS で `element.dataset.prompt` として取り出します。HTML に状態を持たせるこのパターンは、小規模アプリでは有効な手法です。


## 4. style.css の解説

### 4-1. CSS変数（カスタムプロパティ）

```css
:root {
  --color-primary: #2563eb;
  --color-bg: #ffffff;
  --color-text: #1a1a1a;
  --radius: 12px;
}
```

`:root` セレクタで定義した CSS 変数は、スタイルシート全体から `var(--color-primary)` のように参照できます。色やサイズの値を一箇所で管理することで、デザイン変更時に `:root` ブロックだけ書き換えれば全体に反映されます。ダークモード対応を入れたくなった場合も、変数の値を切り替えるだけで済むのが利点です。

### 4-2. Flexbox レイアウト

```css
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

ヘッダー内のロゴ(左)と設定ボタン(右)を左右に配置するのに `justify-content: space-between` を使っています。Flexbox は1次元レイアウト（横並び or 縦並び）に強い仕組みです。

チャットメッセージの表示エリアも Flexbox で `flex-direction: column` を指定し、メッセージを縦に積んでいく構成をとっています。

### 4-3. モバイルファーストとメディアクエリ

```css
/* ベースのスタイル = モバイル向け */
.chat-container {
  padding: 16px;
}

/* 画面幅が768px以上ならPC向けに調整 */
@media (min-width: 768px) {
  .chat-container {
    padding: 24px 32px;
    max-width: 800px;
    margin: 0 auto;
  }
}
```

モバイルファーストとは、小さい画面のスタイルをデフォルトに書き、大きい画面向けを `@media` で上書きするアプローチです。逆（PC基準でモバイルを `max-width` で上書き）より記述が簡潔になり、モバイル環境で不要な CSS の読み込みも減ります。

### 4-4. safe-area-inset（ノッチ対応）

```css
.input-area {
  padding-bottom: env(safe-area-inset-bottom);
}
```

`env(safe-area-inset-bottom)` は iPhone X 以降のノッチ付き端末で、画面下部のホームバー領域にコンテンツが被らないようにするための値です。`viewport-fit=cover`（index.html で指定済み）と組み合わせて初めて機能します。

Android 端末やノッチのないiPhoneでは `env(safe-area-inset-bottom)` は 0 になるため、影響はありません。


## 5. app.js の解説

### 5-1. 状態管理パターン

```javascript
const state = {
  messages: [],
  isStreaming: false,
  systemPrompt: "",
};
```

React の useState や Vue の reactive を使わず、ただのオブジェクトで状態を管理しています。状態が変わったら自分で DOM を更新する必要がある分、手間はかかります。その代わり「状態変更 → DOM操作」の流れが明示的に見えるので、ブラウザが何をしているか理解しやすくなります。

フレームワークの仮想DOMや差分検出アルゴリズムを使えば、この手動DOM操作は不要になります。便利ですが、裏で何が起きているかが隠蔽されてしまいます。教材としてはその「裏」を見せたいので、あえて手動にしました。

### 5-2. Fetch API と ReadableStream

```javascript
const response = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    messages: state.messages,
    systemPrompt: state.systemPrompt,
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
```

`fetch()` の戻り値の `response.body` は `ReadableStream` 型です。`getReader()` でストリームリーダーを取得し、`read()` メソッドでデータを逐次読み出します。

`TextDecoder` はバイナリデータ（Uint8Array）を文字列に変換するものです。ネットワークから届く生データはバイト列なので、この変換が必要になります。

### 5-3. SSE のパース

サーバーから届く SSE データは `data: {"content":"こ"}\n\ndata: {"content":"ん"}\n\n` のような形式です。これをクライアント側でパースします。

```javascript
const lines = text.split("\n");
for (const line of lines) {
  if (line.startsWith("data: ")) {
    const jsonStr = line.slice(6);
    const parsed = JSON.parse(jsonStr);
    if (parsed.done) {
      // ストリーム完了
    } else if (parsed.content) {
      // テキストの断片を画面に追加
    }
  }
}
```

`EventSource` API を使えばもっと簡潔に書けますが、`EventSource` は GET リクエストしかサポートしていません。チャットでは POST でメッセージ履歴を送る必要があるため、`fetch` + 手動パースの方式を採用しています。

### 5-4. マークダウンパーサーの実装

AIの応答はマークダウン形式で返ってくることが多いです。コードブロック、リスト、見出し、太字などをHTMLに変換して表示します。

```javascript
function parseMarkdown(text) {
  // コードブロック: ```lang ... ``` → <pre><code>
  // インラインコード: `code` → <code>
  // 見出し: ### → <h3>
  // 太字: **text** → <strong>
  // リスト: - item → <li>
  // リンク: [text](url) → <a>
}
```

本格的なマークダウンパーサー（marked.js など）を使わず、正規表現ベースの簡易パーサーを自前で実装しています。追加の依存を増やしたくないことと、マークダウン→HTML変換のロジックそのものを教材として見せたいことが、その理由です。

コードブロック内は HTML エスケープを施します。これを怠ると、AIが生成した HTML コードの解説がそのままブラウザに解釈され、レイアウトが崩れてしまいます。

### 5-5. IME 対応（日本語入力との共存）

```javascript
let isComposing = false;

input.addEventListener("compositionstart", () => {
  isComposing = true;
});

input.addEventListener("compositionend", () => {
  isComposing = false;
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !isComposing) {
    e.preventDefault();
    sendMessage();
  }
});
```

日本語入力（IME）使用中に Enter キーを押すと、本来は変換確定の操作です。しかし Enter にメッセージ送信を割り当てていると、変換中の確定と送信が衝突してしまいます。

`compositionstart` / `compositionend` イベントで IME の状態を追跡し、変換中は Enter による送信を無効化しています。この処理がないと日本語環境では使い物になりません。英語圏で作られたチャットUIのコードにはこの対策が入っていないことが多く、AIに生成させた場合も抜け落ちがちなポイントです。


## 6. 拡張のヒント

emo1 をベースに機能を追加する場合の方向性を示します。

### 6-1. 会話履歴の永続化

現在は画面をリロードすると会話履歴が消えます。`localStorage` を使えば、ブラウザにデータを保持できます。

```javascript
// 保存
localStorage.setItem("emo1-messages", JSON.stringify(state.messages));

// 読み込み
const saved = localStorage.getItem("emo1-messages");
if (saved) {
  state.messages = JSON.parse(saved);
}
```

注意点として、`localStorage` はドメインごとに最大5MB程度の容量制限があります。長い会話を溜め続けると上限に達するため、古い会話を自動削除するロジックか、IndexedDB への移行を検討する必要があるでしょう。

### 6-2. マルチモーダル対応（画像入力）

OpenAI の GPT-4o / GPT-4o-mini は画像入力に対応しています。ユーザーが画像をアップロードし、その画像についてAIに質問できる機能を追加できます。

```javascript
// メッセージの content を配列形式に変更
{
  role: "user",
  content: [
    { type: "text", text: "この画像は何？" },
    { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
  ]
}
```

ファイルを Base64 エンコードしてAPIに送る方式と、URLを渡す方式の2通りがあります。Base64 方式ならサーバー側にファイルアップロード機能を追加する必要があり、`multer` パッケージなどを使うことになります。

### 6-3. 認証機能の追加

APIキーの不正利用を防ぐため、ユーザー認証を入れたい場合の選択肢を挙げます。

- シンプルなパスワード認証: 環境変数に `APP_PASSWORD` を設定し、ブラウザからのリクエストにパスワードヘッダーを付ける方式です。手軽ですがセキュリティは限定的といえます。
- JWT 認証: ログインAPIでトークンを発行し、以降のリクエストに Bearer トークンとして付与します。`jsonwebtoken` パッケージを使います。
- OAuth: Google や GitHub のアカウントで認証する方式です。`passport.js` + 各プロバイダの Strategy を使います。個人開発では大げさですが、チーム利用なら検討に値するでしょう。

### 6-4. デプロイ方法

ローカルで動くアプリをインターネットに公開する場合の選択肢です。

Render (https://render.com): `render.yaml` を書くか、GitHub リポジトリを接続するだけでデプロイできます。無料プランがあり、Node.js アプリのホスティングに向いています。

Railway (https://railway.app): GitHub 連携でデプロイできます。環境変数の設定画面が分かりやすいのが特長です。月5ドルのHobbyプランから利用可能です。

Vercel (https://vercel.com): フロントエンド特化ですが、Serverless Functions で API ルートも動かせます。`server.js` を `/api` ディレクトリ内の Serverless Function に書き換える必要があるため、構成変更が発生します。

いずれのサービスも、環境変数（`OPENAI_API_KEY`）はダッシュボードから設定します。ソースコードにキーを含めてはならない点はローカル開発と同じです。
