// ============================================================
// emo1 - ヘルスチェック API（Vercel Serverless Function）
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
  res.status(200).json({
    status: "ok",
    apiKeyConfigured: hasApiKey,
    timestamp: new Date().toISOString(),
  });
};
