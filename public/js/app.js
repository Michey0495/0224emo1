/**
 * emo1 - AI Chat Application
 * ブラウザで動くAIチャットアプリのクライアントサイドロジック
 */

// ==========================================================
// アプリケーション状態
// ==========================================================
const state = {
  messages: [],            // { role: 'user' | 'assistant', content: string } の配列
  isStreaming: false,       // AI応答のストリーミング中かどうか
  systemPrompt: '',         // カスタムシステムプロンプト
  model: 'gpt-4o-mini'     // 使用するモデル名
}

// ==========================================================
// DOM要素のキャッシュ
// ==========================================================
let dom = {}

// ==========================================================
// 初期化
// ==========================================================

/** アプリ全体の初期化処理 */
function initApp() {
  // 利用確認画面の処理（チャット初期化より先に実行）
  setupConsent()

  // DOM要素を取得してキャッシュ
  dom = {
    chatContainer: document.getElementById('chat-container'),
    welcome: document.getElementById('welcome'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalClose: document.getElementById('modal-close'),
    systemPrompt: document.getElementById('system-prompt'),
    modelSelect: document.getElementById('model-select'),
    clearChat: document.getElementById('clear-chat')
  }

  // メッセージ表示用のコンテナを生成
  dom.messagesArea = document.createElement('div')
  dom.messagesArea.className = 'messages-area'
  dom.chatContainer.appendChild(dom.messagesArea)

  setupEventListeners()
}

// ==========================================================
// 利用確認画面
// ==========================================================

const CONSENT_KEY = 'emo1-consent-accepted'

/** 利用確認画面の初期化 */
function setupConsent() {
  const overlay = document.getElementById('consent-overlay')
  const btn = document.getElementById('consent-btn')
  const privacyBtn = document.getElementById('open-privacy')
  const privacyOverlay = document.getElementById('privacy-overlay')
  const privacyClose = document.getElementById('privacy-close')

  // 同意済みなら確認画面を非表示
  if (localStorage.getItem(CONSENT_KEY) === 'true') {
    overlay.classList.add('hidden')
    return
  }

  // 同意ボタン
  btn.addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'true')
    overlay.classList.add('hidden')
  })

  // プライバシーポリシーの開閉
  privacyBtn.addEventListener('click', () => {
    privacyOverlay.classList.add('open')
  })

  privacyClose.addEventListener('click', () => {
    privacyOverlay.classList.remove('open')
  })

  privacyOverlay.addEventListener('click', (e) => {
    if (e.target === privacyOverlay) privacyOverlay.classList.remove('open')
  })
}

/** イベントリスナーの一括登録 */
function setupEventListeners() {
  // 送信ボタン
  dom.sendBtn.addEventListener('click', handleSend)

  // テキストエリアの入力監視
  dom.messageInput.addEventListener('input', () => {
    autoResizeTextarea()
    updateSendButton()
  })

  // キーボード操作
  dom.messageInput.addEventListener('keydown', handleKeydown)

  // サンプルプロンプトカード
  document.querySelectorAll('.welcome-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt
      if (prompt) {
        dom.messageInput.value = prompt
        autoResizeTextarea()
        updateSendButton()
        dom.messageInput.focus()
      }
    })
  })

  // 設定モーダルの開閉
  dom.settingsBtn.addEventListener('click', openSettings)
  dom.modalClose.addEventListener('click', closeSettings)
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) closeSettings()
  })

  // 設定値の反映
  dom.systemPrompt.addEventListener('change', () => {
    state.systemPrompt = dom.systemPrompt.value.trim()
  })

  dom.modelSelect.addEventListener('change', () => {
    state.model = dom.modelSelect.value
  })

  // 会話クリア
  dom.clearChat.addEventListener('click', clearConversation)

  // 利用同意リセット
  const resetConsent = document.getElementById('reset-consent')
  if (resetConsent) {
    resetConsent.addEventListener('click', () => {
      localStorage.removeItem(CONSENT_KEY)
      closeSettings()
      document.getElementById('consent-overlay').classList.remove('hidden')
    })
  }

  // Escapeキーでモーダルを閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings()
  })
}

// ==========================================================
// メッセージ送信
// ==========================================================

/** 送信ボタンまたはEnterキーからの送信処理 */
function handleSend() {
  if (state.isStreaming) return

  const text = dom.messageInput.value.trim()
  if (!text) return

  // 文字数制限チェック
  if (text.length > 4000) {
    showError('メッセージは4000文字以内で入力してください')
    return
  }

  sendMessage(text)
}

/** メッセージの送信からAI応答取得までの一連の処理 */
function sendMessage(text) {
  // ウェルカム画面を非表示にする
  hideWelcome()

  // ユーザーメッセージを画面に追加
  renderMessage('user', text)

  // 状態を更新
  state.messages = [...state.messages, { role: 'user', content: text }]

  // 入力欄をクリア
  dom.messageInput.value = ''
  autoResizeTextarea()
  updateSendButton()

  // タイピングインジケーターを表示
  const typingEl = showTypingIndicator()

  // ストリーミング応答を取得
  state.isStreaming = true
  fetchStreamResponse(typingEl)
}

/** キーボードイベントのハンドラ */
function handleKeydown(e) {
  // IME変換中は無視
  if (e.isComposing || e.keyCode === 229) return

  // Enterキー（Shift+Enterでなければ送信）
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// ==========================================================
// ストリーミング応答
// ==========================================================

/** SSEストリーミングでAI応答を受信する */
async function fetchStreamResponse(typingEl) {
  // AIメッセージ用のバブルを先に作成
  const bubbleEl = createMessageBubble('assistant')
  let fullContent = ''

  try {
    // APIリクエスト（システムプロンプトとモデルをサーバーに渡す）
    const body = {
      messages: state.messages,
      systemPrompt: state.systemPrompt || undefined,
      model: state.model
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`APIエラー: ${response.status} ${response.statusText}`)
    }

    // タイピングインジケーターを除去し、バブルを挿入
    removeTypingIndicator(typingEl)
    dom.messagesArea.appendChild(bubbleEl.wrapper)

    // ReadableStreamからSSEデータを読み取る
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE形式のパース（data: ...）
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()

        // 空行やSSEコメントはスキップ
        if (!trimmed || trimmed.startsWith(':')) continue

        // data: プレフィックスを処理
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6)

          // ストリーム終了シグナル
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)

            // エラーレスポンスの処理
            if (parsed.error) {
              throw new Error(parsed.error)
            }

            // サーバーから送られる { content: "..." } 形式を処理
            if (parsed.content) {
              fullContent += parsed.content
              bubbleEl.bubble.innerHTML = parseMarkdown(fullContent)
              scrollToBottom()
            }
          } catch (parseError) {
            // JSONパース失敗は無視（部分データの可能性）
            if (parseError.message && !parseError.message.includes('JSON')) {
              throw parseError
            }
          }
        }
      }
    }

    // 応答完了: 状態を更新
    state.messages = [...state.messages, { role: 'assistant', content: fullContent }]

    // コードブロックにコピーボタンを付与
    attachCopyButtons(bubbleEl.bubble)

  } catch (error) {
    // エラー発生時の処理
    removeTypingIndicator(typingEl)

    // 空のバブルが残っていたら除去
    if (bubbleEl.wrapper.parentNode && !fullContent) {
      bubbleEl.wrapper.remove()
    }

    showError(`応答の取得に失敗しました: ${error.message}`)
    console.error('ストリーミングエラー:', error)
  } finally {
    state.isStreaming = false
    scrollToBottom()
  }
}

// ==========================================================
// メッセージ描画
// ==========================================================

/** メッセージのDOM要素を生成してチャットエリアに追加する */
function renderMessage(role, content) {
  const wrapper = document.createElement('div')
  wrapper.className = `message-wrapper ${role}`

  const bubble = document.createElement('div')
  bubble.className = 'message-bubble'

  if (role === 'user') {
    // ユーザーメッセージはHTMLエスケープしてそのまま表示
    bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br>')
  } else {
    // AIメッセージはマークダウンをパースして表示
    bubble.innerHTML = parseMarkdown(content)
  }

  wrapper.appendChild(bubble)
  dom.messagesArea.appendChild(wrapper)

  // AIメッセージのコードブロックにコピーボタンを付与
  if (role === 'assistant') {
    attachCopyButtons(bubble)
  }

  scrollToBottom()
}

/** ストリーミング用にメッセージバブルを先行生成する */
function createMessageBubble(role) {
  const wrapper = document.createElement('div')
  wrapper.className = `message-wrapper ${role}`

  const bubble = document.createElement('div')
  bubble.className = 'message-bubble'

  wrapper.appendChild(bubble)

  return { wrapper, bubble }
}

// ==========================================================
// タイピングインジケーター
// ==========================================================

/** タイピングインジケーター（3つのドット）を表示する */
function showTypingIndicator() {
  const wrapper = document.createElement('div')
  wrapper.className = 'message-wrapper assistant'

  const bubble = document.createElement('div')
  bubble.className = 'message-bubble'

  const indicator = document.createElement('div')
  indicator.className = 'typing-indicator'
  indicator.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'

  bubble.appendChild(indicator)
  wrapper.appendChild(bubble)
  dom.messagesArea.appendChild(wrapper)

  scrollToBottom()
  return wrapper
}

/** タイピングインジケーターを除去する */
function removeTypingIndicator(el) {
  if (el && el.parentNode) {
    el.remove()
  }
}

// ==========================================================
// マークダウンパーサー（簡易版）
// ==========================================================

/**
 * マークダウンテキストをHTMLに変換する
 * 外部ライブラリを使わない自前の簡易実装
 */
function parseMarkdown(text) {
  // まずコードブロックを退避させる（内部がパースされないように）
  const codeBlocks = []
  let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length
    codeBlocks.push({ lang, code })
    return `%%CODEBLOCK_${index}%%`
  })

  // HTMLエスケープ（コードブロック以外の部分）
  processed = escapeHtml(processed)

  // 見出し（h1-h3）
  processed = processed.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  processed = processed.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  processed = processed.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // 引用
  processed = processed.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // テーブル
  processed = parseTable(processed)

  // 順序なしリスト
  processed = parseUnorderedList(processed)

  // 順序付きリスト
  processed = parseOrderedList(processed)

  // インライン要素
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>')
  processed = processed.replace(/`(.+?)`/g, '<code>$1</code>')
  processed = processed.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

  // 段落の処理（連続する改行を段落区切りに）
  processed = processed
    .split(/\n\n+/)
    .map(block => {
      const trimmed = block.trim()
      if (!trimmed) return ''
      // すでにブロック要素のタグで始まっている場合はそのまま
      if (/^<(h[1-3]|ul|ol|blockquote|table|div|pre)/.test(trimmed)) {
        return trimmed
      }
      // コードブロックのプレースホルダーはそのまま
      if (/^%%CODEBLOCK_\d+%%$/.test(trimmed)) {
        return trimmed
      }
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`
    })
    .join('\n')

  // コードブロックを復元
  processed = processed.replace(/%%CODEBLOCK_(\d+)%%/g, (_, index) => {
    const block = codeBlocks[parseInt(index, 10)]
    const langLabel = block.lang || 'code'
    const escapedCode = escapeHtml(block.code.replace(/\n$/, ''))
    return `<div class="code-block-wrapper">` +
      `<div class="code-block-header">` +
      `<span class="code-block-lang">${escapeHtml(langLabel)}</span>` +
      `<button class="copy-btn" type="button">コピー</button>` +
      `</div>` +
      `<pre><code class="language-${escapeHtml(block.lang)}">${escapedCode}</code></pre>` +
      `</div>`
  })

  return processed
}

/** 順序なしリストをパースする */
function parseUnorderedList(text) {
  return text.replace(/((?:^[-*] .+\n?)+)/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      const content = line.replace(/^[-*] /, '')
      return `<li>${content}</li>`
    })
    return `<ul>${items.join('')}</ul>`
  })
}

/** 順序付きリストをパースする */
function parseOrderedList(text) {
  return text.replace(/((?:^\d+\. .+\n?)+)/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      const content = line.replace(/^\d+\. /, '')
      return `<li>${content}</li>`
    })
    return `<ol>${items.join('')}</ol>`
  })
}

/** テーブル記法をHTMLテーブルに変換する */
function parseTable(text) {
  const lines = text.split('\n')
  const result = []
  let i = 0

  while (i < lines.length) {
    // テーブルヘッダー行の検出（|で区切られた行 + 次行がセパレータ）
    if (
      lines[i].includes('|') &&
      i + 1 < lines.length &&
      /^\|?[\s-:|]+\|?$/.test(lines[i + 1])
    ) {
      const headerCells = parseTableRow(lines[i])
      let tableHtml = '<table><thead><tr>'
      headerCells.forEach(cell => {
        tableHtml += `<th>${cell.trim()}</th>`
      })
      tableHtml += '</tr></thead><tbody>'

      i += 2 // ヘッダーとセパレータをスキップ

      // データ行を処理
      while (i < lines.length && lines[i].includes('|')) {
        const cells = parseTableRow(lines[i])
        tableHtml += '<tr>'
        cells.forEach(cell => {
          tableHtml += `<td>${cell.trim()}</td>`
        })
        tableHtml += '</tr>'
        i++
      }

      tableHtml += '</tbody></table>'
      result.push(tableHtml)
    } else {
      result.push(lines[i])
      i++
    }
  }

  return result.join('\n')
}

/** テーブルの1行をセル配列に分割する */
function parseTableRow(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
}

// ==========================================================
// コードブロックのコピー機能
// ==========================================================

/** バブル内のコピーボタンにイベントを付与する */
function attachCopyButtons(bubbleEl) {
  const copyBtns = bubbleEl.querySelectorAll('.copy-btn')
  copyBtns.forEach(btn => {
    btn.addEventListener('click', handleCopy)
  })
}

/** コードブロックの内容をクリップボードにコピーする */
async function handleCopy(e) {
  const btn = e.currentTarget
  const codeBlock = btn.closest('.code-block-wrapper')
  const code = codeBlock?.querySelector('code')?.textContent || ''

  try {
    await navigator.clipboard.writeText(code)
    btn.textContent = 'コピーしました'
    btn.classList.add('copied')

    // 2秒後にラベルを戻す
    setTimeout(() => {
      btn.textContent = 'コピー'
      btn.classList.remove('copied')
    }, 2000)
  } catch {
    btn.textContent = '失敗'
    setTimeout(() => { btn.textContent = 'コピー' }, 2000)
  }
}

// ==========================================================
// UI操作
// ==========================================================

/** テキストエリアの高さを内容に合わせて自動調整する */
function autoResizeTextarea() {
  const el = dom.messageInput
  el.style.height = 'auto'
  // 最大4行分の高さに制限
  const maxHeight = parseFloat(getComputedStyle(el).lineHeight) * 4 + 4
  el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'

  // 最大高さを超えた場合はスクロール可能にする
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

/** 送信ボタンの有効/無効を切り替える */
function updateSendButton() {
  const hasText = dom.messageInput.value.trim().length > 0
  const canSend = hasText && !state.isStreaming

  if (canSend) {
    dom.sendBtn.classList.add('active')
    dom.sendBtn.disabled = false
  } else {
    dom.sendBtn.classList.remove('active')
    dom.sendBtn.disabled = true
  }
}

/** ウェルカム画面を非表示にする */
function hideWelcome() {
  if (dom.welcome) {
    dom.welcome.classList.add('hidden')
  }
}

/** チャットエリアを最下部にスクロールする */
function scrollToBottom() {
  requestAnimationFrame(() => {
    dom.chatContainer.scrollTop = dom.chatContainer.scrollHeight
  })
}

/** エラーメッセージをチャット内に表示する */
function showError(message) {
  const el = document.createElement('div')
  el.className = 'error-message'
  el.textContent = message
  dom.messagesArea.appendChild(el)
  scrollToBottom()
}

// ==========================================================
// 設定モーダル
// ==========================================================

/** 設定モーダルを開く */
function openSettings() {
  dom.systemPrompt.value = state.systemPrompt
  dom.modelSelect.value = state.model
  dom.modalOverlay.classList.add('open')
}

/** 設定モーダルを閉じる */
function closeSettings() {
  dom.modalOverlay.classList.remove('open')
  // 閉じる際に値を反映
  state.systemPrompt = dom.systemPrompt.value.trim()
  state.model = dom.modelSelect.value
}

/** 会話履歴をすべてクリアする */
function clearConversation() {
  state.messages = []
  dom.messagesArea.innerHTML = ''
  dom.welcome.classList.remove('hidden')
  closeSettings()
}

// ==========================================================
// セキュリティ
// ==========================================================

/** HTMLの特殊文字をエスケープしてXSSを防ぐ */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, (char) => map[char])
}

// ==========================================================
// 起動
// ==========================================================
document.addEventListener('DOMContentLoaded', initApp)
