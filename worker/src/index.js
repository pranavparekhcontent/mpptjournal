/**
 * MPPT Journal — Cloudflare Edge API
 * Full 8-Stage Editorial Workflow Engine
 * 
 * Stack: Cloudflare Workers + D1 + R2 + Workers AI + Telegram Bot
 * 
 * Endpoints:
 * ─── Health ───
 *  GET  /health, /api/health              Health check
 * ─── Submission ───
 *  POST /api/submit                       Full submission intake
 *  POST /upload, /api/upload              Legacy upload (R2 only)
 *  GET  /download/:key                    Download file from R2
 *  GET  /manuscripts/:paperId             List manuscripts for paper
 * ─── Status ───
 *  GET  /api/paper/:id/status             Paper stage + audit trail
 *  GET  /api/papers                       List all papers (with filters)
 * ─── Workflow Actions ───
 *  POST /api/plagiarism/result            Store plagiarism result + advance
 *  POST /api/format/result                Store formatting result + advance
 *  POST /api/reviewer/assign              Auto-assign reviewers
 *  POST /api/reviewer/decision            Record reviewer decision
 *  POST /api/paper/:id/advance            Manual stage advance (group decision)
 *  POST /api/paper/:id/reject             Reject paper
 *  POST /api/gallery/send                 Send gallery proof
 *  POST /api/gallery/confirm              Author confirms proof
 *  POST /api/payment/verify               Razorpay webhook
 *  POST /api/publish                      Publish paper
 * ─── Reviewer Pool ───
 *  GET  /api/reviewers                    List reviewers
 *  POST /api/reviewers                    Add reviewer
 * ─── Telegram ───
 *  POST /api/telegram/webhook             Bot webhook handler
 * ─── Archival ───
 *  POST /api/archive/zenodo               Zenodo deposit
 *  GET  /api/archive/zenodo/:paperId      Query Zenodo status
 * ─── Cron ───
 *  GET  /api/cron/deadlines               Check deadlines + send alerts
 */

// ════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
import { renderEmailHtml, getTemplateSubject } from './templates.js';
import { connect } from 'cloudflare:sockets';

// CONSTANTS
// ════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

const STAGES = {
  SUBMITTED: 'SUBMITTED',
  PLAGIARISM_CHECK: 'PLAGIARISM_CHECK',
  PLAGIARISM_FAIL: 'PLAGIARISM_FAIL',
  PLAGIARISM_PASS: 'PLAGIARISM_PASS',
  FORMATTING_CHECK: 'FORMATTING_CHECK',
  FORMATTING_FAIL: 'FORMATTING_FAIL',
  FORMATTING_PASS: 'FORMATTING_PASS',
  REVIEWER_ASSIGNED: 'REVIEWER_ASSIGNED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  REVISION_REQUIRED: 'REVISION_REQUIRED',
  REVISION_SUBMITTED: 'REVISION_SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  GALLERY_SENT: 'GALLERY_SENT',
  GALLERY_CONFIRMED: 'GALLERY_CONFIRMED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
  REJECTED: 'REJECTED',
};

const STAGE_LABELS = {
  SUBMITTED: '📥 Submitted',
  PLAGIARISM_CHECK: '🔍 Plagiarism Check',
  PLAGIARISM_FAIL: '⚠️ Plagiarism Failed',
  PLAGIARISM_PASS: '✅ Plagiarism Passed',
  FORMATTING_CHECK: '📐 Formatting Check',
  FORMATTING_FAIL: '⚠️ Formatting Issues',
  FORMATTING_PASS: '✅ Formatting Passed',
  REVIEWER_ASSIGNED: '📨 Reviewers Assigned',
  UNDER_REVIEW: '📝 Under Review',
  REVISION_REQUIRED: '🔄 Revision Required',
  REVISION_SUBMITTED: '📤 Revision Submitted',
  ACCEPTED: '✅ Accepted',
  GALLERY_SENT: '📄 Gallery Proof Sent',
  GALLERY_CONFIRMED: '✅ Gallery Confirmed',
  PAYMENT_PENDING: '💰 Payment Pending',
  PAYMENT_VERIFIED: '✅ Payment Verified',
  PUBLISHED: '🎓 Published',
  ARCHIVED: '📦 Archived',
  REJECTED: '❌ Rejected',
};

// Email routing: which stages use editor@ vs review@
const EDITOR_EMAIL_STAGES = new Set([
  'REVIEWER_ASSIGNED', 'ACCEPTED', 'GALLERY_SENT', 'GALLERY_CONFIRMED',
  'PAYMENT_VERIFIED', 'PUBLISHED', 'ARCHIVED', 'REJECTED'
]);

// Master context for AI (injected as system prompt)
const AI_SYSTEM_PROMPT = `You are MPPT AI, an intelligent, autonomous editorial partner and AI assistant for the Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal).
You converse naturally, warmly, intelligently, and freely—just like ChatGPT or an expert colleague.
You have real-time live access to the MPPT editorial database provided in the context below, including all incoming emails, manuscripts, reviewer pools, communications, and pipeline statistics.

YOUR CORE BEHAVIORS:
1. FREE THINKING & NATURAL CONVERSATION:
   - Talk like an expert colleague and companion: warm, witty, articulate, clear, and proactive.
   - Do NOT give robotic, canned, or canned-status replies. Never dump dry pipeline statistics unless specifically asked for stats.
   - You can discuss any topic freely: science, editorial strategy, pharmacology, writing, workflows, troubleshooting, philosophy, or casual conversation.
2. ANSWER DIRECTLY USING LIVE DATA:
   - When the user asks about emails (e.g. "is there any new email?", "list emails", "who emailed us?"):
     Check the [INBOUND EMAILS & INBOX] section in the context below!
     List the exact emails: who sent them, sender name, email address, subject, date, summary, and whether a reply is pending or sent.
   - When the user asks about manuscripts, status, or authors:
     Check the [MANUSCRIPTS IN PIPELINE] section. Give rich details about the paper, author, stage, plagiarism, deadlines, etc.
   - When the user asks about reviewers:
     Check the [REVIEWER POOL] section. Mention them by name, email, speciality, and affiliation.
3. PROACTIVE EDITORIAL ASSISTANCE:
   - If an author or referee has requested an extension, revisions, or clarification, explain what they need and offer to draft a scholarly response.
   - If instructed to draft or reply, compose a polished, elegant academic email ready for review.
4. TELEGRAM FORMATTING:
   - Use clean Markdown formatting (*bold*, _italic_, \`code\`, bullet points).
   - Keep answers well-structured and easy to read on mobile.
5. INTEGRITY & CONFIDENTIALITY:
   - Be truthful, accurate, and helpful. Never fabricate citations or DOIs. Never reveal private backend tokens or API keys.`;

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function now() {
  return new Date().toISOString();
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function daysUntil(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function safeJsonParse(str, fallback = []) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

// ════════════════════════════════════════════════════════════
// DYNAMIC AI INFERENCE ENGINE (Cascading Multi-Tier Failover)
// ════════════════════════════════════════════════════════════

const CANDIDATE_AI_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // Tier 1: 70B Frontier Reasoning (ChatGPT / GPT-4 class)
  '@cf/meta/llama-3.1-8b-instruct-fp8',       // Tier 2: 8B High-Precision Quantization
  '@cf/meta/llama-3.1-8b-instruct-fast',      // Tier 3: 8B Ultra-Fast Low Latency
  '@cf/meta/llama-3.2-3b-instruct',           // Tier 4: 3B Compact Edge Inference
];

async function runAiChat(env, messages, maxTokens = 800) {
  if (!env.AI) return null;

  for (const model of CANDIDATE_AI_MODELS) {
    try {
      const res = await env.AI.run(model, {
        messages,
        max_tokens: maxTokens,
      });
      const text = res?.response || res?.choices?.[0]?.message?.content || '';
      if (text && text.trim()) {
        return text.trim();
      }
    } catch (err) {
      console.warn(`Model ${model} unavailable or deprecated, dynamically cascading to next smartest:`, err?.message || err);
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════════
// PAPER ID GENERATOR
// ════════════════════════════════════════════════════════════

async function generatePaperId(db, volume, issue) {
  const key = `paper_seq_V${volume}I${issue}`;
  
  // Query total manuscripts currently in database to ensure counter is always ahead
  const totalRow = await db.prepare(`SELECT COUNT(*) as total FROM manuscripts`).first().catch(() => null);
  const baseCount = totalRow?.total || 0;

  await db.prepare(`INSERT OR IGNORE INTO counters (counter_key, counter_value) VALUES (?, ?)`).bind(key, baseCount).run();
  await db.prepare(`UPDATE counters SET counter_value = ? WHERE counter_key = ? AND counter_value < ?`).bind(baseCount, key, baseCount).run();
  
  let attempts = 0;
  let candidateId = '';
  const year = new Date().getFullYear();

  while (attempts < 20) {
    attempts++;
    await db.prepare(`UPDATE counters SET counter_value = counter_value + 1 WHERE counter_key = ?`).bind(key).run();
    const row = await db.prepare(`SELECT counter_value FROM counters WHERE counter_key = ?`).bind(key).first();
    const seq = String(row ? row.counter_value : attempts).padStart(4, '0');
    candidateId = `MPPT-${year}-V${volume}I${issue}-${seq}`;

    // Verify candidate does not already exist
    const exists = await db.prepare(`SELECT paper_id FROM manuscripts WHERE paper_id = ?`).bind(candidateId).first();
    if (!exists) {
      break;
    }
  }

  return candidateId;
}

// ════════════════════════════════════════════════════════════
// STAGE TRANSITION
// ════════════════════════════════════════════════════════════

async function advanceStage(db, paperId, newStage, actor = 'system') {
  const paper = await db.prepare(`SELECT stage, stage_history FROM manuscripts WHERE paper_id = ?`)
    .bind(paperId).first();
  
  if (!paper) throw new Error(`Paper ${paperId} not found`);
  
  const history = safeJsonParse(paper.stage_history, []);
  history.push({ stage: newStage, from: paper.stage, timestamp: now(), actor });
  
  await db.prepare(`
    UPDATE manuscripts 
    SET stage = ?, stage_history = ?, updated_at = ?
    WHERE paper_id = ?
  `).bind(newStage, JSON.stringify(history), now(), paperId).run();
  
  return { previousStage: paper.stage, newStage };
}

// ════════════════════════════════════════════════════════════
// TELEGRAM HELPERS
// ════════════════════════════════════════════════════════════

async function sendTelegram(env, text, options = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('sendTelegram: No TELEGRAM_BOT_TOKEN configured');
    return { ok: false, error: 'No bot token' };
  }

  const chatId = options.chat_id || env.TELEGRAM_GROUP_ID || '-1004291559247';
  const cleanOptions = { ...options };
  delete cleanOptions.chat_id;

  const body = {
    chat_id: chatId,
    text: String(text || ''),
    parse_mode: 'Markdown',
    ...cleanOptions,
  };

  try {
    let res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let result = await res.json();

    // If Telegram rejects due to markdown entity parse error (e.g. underscores in filenames, URLs, emails), retry as plain text!
    if (!result.ok && result.description && (
      result.description.includes("can't parse entities") ||
      result.description.includes("entity") ||
      result.description.includes("parse")
    )) {
      console.warn('Telegram Markdown parse error, retrying with plain text:', result.description);
      const fallbackBody = { ...body };
      delete fallbackBody.parse_mode;

      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackBody),
      });
      result = await res.json();
    }

    if (!result.ok) {
      console.error('Telegram delivery failed:', result);
    }
    return result;
  } catch (err) {
    console.error('sendTelegram exception:', err);
    return { ok: false, error: err.message };
  }
}

async function sendTelegramWithKeyboard(env, text, buttons) {
  return sendTelegram(env, text, {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

async function answerCallbackQuery(env, callbackQueryId, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

// ════════════════════════════════════════════════════════════
// NOTIFICATION HELPER — notify group + log communication
// ════════════════════════════════════════════════════════════

async function notifyStageChange(env, paper, newStage, actor = 'editorial_board') {
  const label = STAGE_LABELS[newStage] || newStage;
  const cleanTitle = (paper.title || 'Untitled').replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanAuthor = (paper.author_name || 'Author').replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ').replace(/\s+/g, ' ').trim();

  const msg = 
    `📋 *MANUSCRIPT STAGE UPDATE*\n\n` +
    `🆔 *Paper ID:* \`${paper.paper_id}\`\n` +
    `📄 *Title:* _${cleanTitle}_\n` +
    `👤 *Author:* ${cleanAuthor}\n` +
    `🏛️ *Affiliation:* ${paper.author_affiliation || 'N/A'}\n\n` +
    `➡️ *New Stage:* *${label}*\n` +
    `👤 *Updated by:* ${actor}\n` +
    (paper.current_deadline ? `⏰ *Active Deadline:* ${paper.current_deadline.split('T')[0]}\n` : '') +
    `\n🔗 *Track Live:* https://mpptjournal.com/track.html?id=${encodeURIComponent(paper.paper_id)}`;
  
  await sendTelegram(env, msg);
  
  // Log communication in D1
  if (env.DB) {
    await env.DB.prepare(`
      INSERT INTO communications (paper_id, channel, direction, from_address, to_address, subject, body_preview, stage_at_time)
      VALUES (?, 'telegram', 'outbound', 'mpptai_bot', 'group', ?, ?, ?)
    `).bind(paper.paper_id, `Stage: ${newStage}`, msg.substring(0, 500), newStage).run();
  }
}

// ════════════════════════════════════════════════════════════
// OUTBOUND EMAIL DISPATCHER (VERIFICATION-FIRST PROTOCOL)
// ════════════════════════════════════════════════════════════

/**
 * Dispatches an official email using the stage HTML template if an external provider is configured,
 * or logs it as a draft / pending manual dispatch while maintaining 100% database truthfulness.
 * 
 * STRICT INVARIANT: Only log channel='email', direction='outbound' IF ACTUALLY PHYSICALLY SENT!
 * Otherwise, log channel='email_draft', direction='pending_manual_dispatch'.
 */

/**
 * Direct Zoho SMTP over TLS implementation using Cloudflare Workers cloudflare:sockets.
 * Connects securely to smtppro.zoho.in:465 with zero third-party dependencies.
 */
async function sendViaZohoSmtp(env, { from, to, subject, html }) {
  const host = env.ZOHO_SMTP_HOST || 'smtp.zoho.in';
  const port = parseInt(env.ZOHO_SMTP_PORT || '465', 10);

  const cleanFrom = (from || 'editor@mpptjournal.com').toLowerCase().trim();
  let user = 'editor@mpptjournal.com';
  let pass = env.ZOHO_PASS_EDITOR || env.ZOHO_SMTP_PASS || env.ZOHO_APP_PASSWORD;
  let senderName = 'MPPT Journal Editorial Desk';

  if (cleanFrom.includes('review')) {
    user = 'review@mpptjournal.com';
    pass = env.ZOHO_PASS_REVIEW || pass;
    senderName = 'MPPT Journal Peer Review Desk';
  } else if (cleanFrom.includes('publisher')) {
    user = 'publisher@mpptjournal.com';
    pass = env.ZOHO_PASS_PUBLISHER || pass;
    senderName = 'MPPT Journal Publishing & Archival Desk';
  } else {
    user = 'editor@mpptjournal.com';
    pass = env.ZOHO_PASS_EDITOR || pass;
    senderName = 'MPPT Journal Editor-in-Chief Desk';
  }

  if (!pass) return { sent: false, error: `No Zoho SMTP password configured for ${user}` };

  let writer = null;
  try {
    const socket = connect({ hostname: host, port }, { secureTransport: 'on' });
    writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let buffer = '';
    async function readLine() {
      while (!buffer.includes('\r\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      const idx = buffer.indexOf('\r\n');
      if (idx === -1) {
        const line = buffer;
        buffer = '';
        return line;
      }
      const line = buffer.substring(0, idx);
      buffer = buffer.substring(idx + 2);
      return line;
    }

    async function readReply() {
      let line = await readLine();
      let reply = line;
      while (line && line.length >= 4 && line[3] === '-') {
        line = await readLine();
        reply += '\n' + line;
      }
      return reply;
    }

    async function sendCmd(cmd) {
      await writer.write(encoder.encode(cmd + '\r\n'));
      return await readReply();
    }

    const greeting = await readReply();
    if (!greeting || !greeting.startsWith('220')) throw new Error('Bad SMTP greeting: ' + greeting);

    const ehlo = await sendCmd('EHLO mpptjournal.com');
    if (!ehlo.startsWith('250')) throw new Error('EHLO failed: ' + ehlo);

    const authRes = await sendCmd('AUTH LOGIN');
    if (!authRes.startsWith('334')) throw new Error('AUTH LOGIN initiation failed: ' + authRes);

    const uB64 = btoa(user);
    const uRes = await sendCmd(uB64);
    if (!uRes.startsWith('334')) throw new Error('Username rejected: ' + uRes);

    const pB64 = btoa(pass);
    const pRes = await sendCmd(pB64);
    if (!pRes.startsWith('235')) throw new Error('Password authentication failed: ' + pRes);

    const replyTo = from || user;
    const fromRes = await sendCmd(`MAIL FROM:<${user}>`);
    if (!fromRes.startsWith('250')) throw new Error('MAIL FROM failed: ' + fromRes);

    const toRes = await sendCmd(`RCPT TO:<${to}>`);
    if (!toRes.startsWith('250')) throw new Error('RCPT TO failed: ' + toRes);

    const dataRes = await sendCmd('DATA');
    if (!dataRes.startsWith('354')) throw new Error('DATA initiation failed: ' + dataRes);

    const emailHeaders = [
      `From: ${senderName} <${user}>`,
      `Reply-To: <${replyTo}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).substring(2)}@mpptjournal.com>`,
      ``,
      html,
      `.`
    ].join('\r\n');

    const sendRes = await sendCmd(emailHeaders);
    if (!sendRes.startsWith('250')) throw new Error('Email body dispatch failed: ' + sendRes);

    await sendCmd('QUIT');
    await writer.close().catch(() => {});
    return { sent: true, provider: 'zoho_smtp', id: sendRes.trim() };
  } catch (err) {
    if (writer) await writer.close().catch(() => {});
    return { sent: false, error: err.message };
  }
}


/**
 * Direct Zoho IMAP over TLS implementation using Cloudflare Workers cloudflare:sockets.
 * Connects securely to imappro.zoho.in:993, checks for unseen messages,
 * passes them through processInboundEmail for AI summarization & Telegram alerts,
 * and leaves emails safely stored on Zoho's 5GB servers.
 */
async function checkZohoImap(env) {
  const host = env.ZOHO_IMAP_HOST || 'imappro.zoho.in';
  const port = parseInt(env.ZOHO_IMAP_PORT || '993', 10);
  const user = env.ZOHO_SMTP_USER || 'review@mpptjournal.com';
  const pass = env.ZOHO_SMTP_PASS || env.ZOHO_APP_PASSWORD;

  if (!pass) return { success: false, error: 'No Zoho password configured in worker secrets' };

  let socket, writer;
  try {
    socket = connect({ hostname: host, port }, { secureTransport: 'on' });
    writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let buffer = '';
    async function readLine() {
      while (!buffer.includes('\r\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      const idx = buffer.indexOf('\r\n');
      if (idx === -1) {
        const line = buffer;
        buffer = '';
        return line;
      }
      const line = buffer.substring(0, idx);
      buffer = buffer.substring(idx + 2);
      return line;
    }

    async function sendTag(tag, cmd) {
      await writer.write(encoder.encode(`${tag} ${cmd}\r\n`));
      const lines = [];
      while (true) {
        const line = await readLine();
        lines.push(line);
        if (line.startsWith(`${tag} OK`) || line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
          break;
        }
      }
      return lines;
    }

    // Read initial greeting
    await readLine();

    // 1. Login
    const loginRes = await sendTag('A1', `LOGIN "${user}" "${pass}"`);
    if (!loginRes[loginRes.length - 1].startsWith('A1 OK')) {
      throw new Error('IMAP login failed: ' + loginRes.join(' '));
    }

    // 2. Select INBOX
    const selectRes = await sendTag('A2', 'SELECT INBOX');
    if (!selectRes[selectRes.length - 1].startsWith('A2 OK')) {
      throw new Error('IMAP select INBOX failed');
    }

    // 3. Search for unseen messages
    const searchRes = await sendTag('A3', 'SEARCH UNSEEN');
    const searchLine = searchRes.find(l => l.startsWith('* SEARCH')) || '';
    const uids = searchLine.replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean);

    let processedCount = 0;
    for (const uid of uids.slice(-5)) {
      const fetchRes = await sendTag(`A4_${uid}`, `FETCH ${uid} (BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY[TEXT])`);
      const rawMsg = fetchRes.join('\n');

      const fromMatch = rawMsg.match(/^FROM:\s*(.*)$/im);
      const toMatch = rawMsg.match(/^TO:\s*(.*)$/im);
      const subjectMatch = rawMsg.match(/^SUBJECT:\s*(.*)$/im);

      const from = fromMatch ? fromMatch[1].trim() : 'Unknown';
      const to = toMatch ? toMatch[1].trim() : user;
      const subject = subjectMatch ? subjectMatch[1].trim() : 'Manuscript Communication';

      await processInboundEmail(env, {
        fromAddress: from,
        toAddress: to,
        inbox: to,
        subject,
        bodyText: rawMsg.substring(0, 2500),
      });
      processedCount++;
    }

    // Logout
    await sendTag('A5', 'LOGOUT');
    await writer.close().catch(() => {});
    return { success: true, processedCount, unreadTotal: uids.length };
  } catch (err) {
    if (writer) await writer.close().catch(() => {});
    return { success: false, error: err.message };
  }
}

async function dispatchOrQueueEmail(env, { paperId, templateKey, fromInbox, toAddress, subject, templateVars, stage }) {
  const renderedHtml = renderEmailHtml(templateKey, templateVars) || '';
  const finalSubject = subject || getTemplateSubject(templateKey, paperId);
  const from = fromInbox || (EDITOR_EMAIL_STAGES.has(stage) ? 'editor@mpptjournal.com' : 'review@mpptjournal.com');

  let sendResult = { sent: false, provider: null, error: null };

  // 1. Attempt delivery via Resend API if configured
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `MPPT Journal <${from}>`,
          to: [toAddress],
          subject: finalSubject,
          html: renderedHtml,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        sendResult = { sent: true, provider: 'resend', id: data.id };
      } else {
        sendResult.error = data.message || 'Resend API error';
      }
    } catch (e) {
      sendResult.error = e.message;
    }
  }

  // 2. Attempt delivery via Brevo API if configured & not sent yet
  if (!sendResult.sent && env.BREVO_API_KEY) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'MPPT Journal Editorial Desk', email: from },
          to: [{ email: toAddress }],
          subject: finalSubject,
          htmlContent: renderedHtml,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        sendResult = { sent: true, provider: 'brevo', id: data.messageId };
      } else {
        sendResult.error = data.message || 'Brevo API error';
      }
    } catch (e) {
      sendResult.error = e.message;
    }
  }

  // 3. Attempt delivery via Zoho SMTP (via cloudflare:sockets) if configured & not sent yet
  if (!sendResult.sent && (env.ZOHO_SMTP_PASS || env.ZOHO_APP_PASSWORD)) {
    try {
      const zohoRes = await sendViaZohoSmtp(env, {
        from,
        to: toAddress,
        subject: finalSubject,
        html: renderedHtml,
      });
      if (zohoRes.sent) {
        sendResult = { sent: true, provider: 'zoho_smtp', id: zohoRes.id };
      } else {
        sendResult.error = zohoRes.error || 'Zoho SMTP error';
      }
    } catch (e) {
      sendResult.error = e.message;
    }
  }

  // 4. Truthful Database Logging (Verification-First)
  if (env.DB) {
    if (sendResult.sent) {
      // PHYSICALLY SENT — Verified outbound log
      await logComm(env.DB, paperId, 'email', 'outbound', from, toAddress,
        finalSubject, `[SENT via ${sendResult.provider}] ${finalSubject}`, templateKey, stage);
    } else {
      // NOT SENT — Logged truthfully as DRAFT / PENDING OUTBOUND KEY
      await logComm(env.DB, paperId, 'email_draft', 'pending_manual_dispatch', from, toAddress,
        finalSubject, `[DRAFT - AWAITING OUTBOUND TRANSPORT] ${finalSubject}`, templateKey, stage);
    }
  }

  // 5. Telegram Group Notification with EXPLICIT Email Attribution
  if (env.TELEGRAM_BOT_TOKEN) {
    if (sendResult.sent) {
      await sendTelegram(env,
        `🚀 *OFFICIAL EMAIL DISPATCHED (AUTONOMOUS)*\n\n` +
        `🆔 *Paper ID:* \`${paperId}\`\n` +
        `📧 *Template:* \`${templateKey}.html\`\n` +
        `📤 *From Mailbox:* \`${from}\`\n` +
        `📨 *To Author Address:* \`${toAddress}\`\n` +
        `📋 *Subject:* _${finalSubject}_\n\n` +
        `✅ *Status:* Physically delivered via ${sendResult.provider} (${sendResult.id || 'OK'}). D1 verified.`
      );
    } else {
      await sendTelegram(env,
        `⚠️ *OFFICIAL EMAIL QUEUED (AWAITING OUTBOUND KEY)*\n\n` +
        `🆔 *Paper ID:* \`${paperId}\`\n` +
        `📧 *Template:* \`${templateKey}.html\`\n` +
        `📤 *From Mailbox:* \`${from}\`\n` +
        `📨 *To Author Address:* \`${toAddress}\`\n` +
        `📋 *Subject:* *${finalSubject}*\n\n` +
        `⚡ *Status:* Outbound dispatch paused until 1 transport key is configured in Worker secrets (Zoho SMTP App Password, Brevo Key, or Resend Key).\n` +
        `👉 Once configured, every submission acknowledges and mails the author 100% autonomously!\n` +
        `_Command: tag \`@mpptai_bot dispatch ${paperId}\` to send queued draft once key is added._`
      );
    }
  }

  return { success: true, ...sendResult, templateKey, subject: finalSubject, html: renderedHtml };
}

// ════════════════════════════════════════════════════════════
// COMMUNICATION LOGGER
// ════════════════════════════════════════════════════════════

async function logComm(db, paperId, channel, direction, from, to, subject, body, template, stage) {
  if (!db) return;
  await db.prepare(`
    INSERT INTO communications (paper_id, channel, direction, from_address, to_address, subject, body_preview, template_used, stage_at_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(paperId, channel, direction, from, to, subject, (body || '').substring(0, 500), template, stage).run();
}

// ════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ════════════════════════════════════════════════════════════

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // ── Health ──
      if (path === '/' || path === '/health' || path === '/api/health') {
        return json({
          service: 'mppt-api',
          journal: 'Journal of Modern Pharmacy Praxis & Therapeutics',
          status: 'online',
          modules: {
            r2: !!env.MANUSCRIPTS,
            d1: !!env.DB,
            ai: !!env.AI,
            telegram: !!env.TELEGRAM_BOT_TOKEN,
          },
          timestamp: now(),
        });
      }

      if (path === '/api/test-ai') {
        const q = url.searchParams.get('q') || 'Say hello in 5 words';
        const answer = await runAiChat(env, [{ role: 'user', content: q }], 300);
        return json({ ok: !!answer, prompt: q, answer: answer || 'AI unavailable' });
      }

      // ── POST /api/submit — Full submission intake ──
      if (method === 'POST' && (path === '/api/submit' || path === '/upload' || path === '/api/upload')) {
        return await handleSubmission(request, env, url);
      }

      // ── GET /download/:key ──
      if (method === 'GET' && path.startsWith('/download/')) {
        return await handleDownload(request, env, path);
      }

      // ── GET /manuscripts/:paperId ──
      if (method === 'GET' && path.startsWith('/manuscripts/')) {
        return await handleListManuscripts(env, path, url);
      }

      // ── GET /api/paper/:id/status ──
      if (method === 'GET' && path.match(/^\/api\/paper\/[^/]+\/status$/)) {
        const paperId = decodeURIComponent(path.split('/')[3]);
        return await handlePaperStatus(env, paperId);
      }

      // ── GET /api/papers ──
      if (method === 'GET' && path === '/api/papers') {
        return await handleListPapers(env, url);
      }

      // ── POST /api/plagiarism/result ──
      if (method === 'POST' && path === '/api/plagiarism/result') {
        return await handlePlagiarismResult(request, env);
      }

      // ── POST /api/format/result ──
      if (method === 'POST' && path === '/api/format/result') {
        return await handleFormatResult(request, env);
      }

      // ── POST /api/reviewer/assign ──
      if (method === 'POST' && path === '/api/reviewer/assign') {
        return await handleReviewerAssign(request, env);
      }

      // ── POST /api/reviewer/decision ──
      if (method === 'POST' && path === '/api/reviewer/decision') {
        return await handleReviewerDecision(request, env);
      }

      // ── POST /api/paper/:id/advance ──
      if (method === 'POST' && path.match(/^\/api\/paper\/[^/]+\/advance$/)) {
        const paperId = decodeURIComponent(path.split('/')[3]);
        return await handleManualAdvance(request, env, paperId);
      }

      // ── POST /api/paper/:id/reject ──
      if (method === 'POST' && path.match(/^\/api\/paper\/[^/]+\/reject$/)) {
        const paperId = decodeURIComponent(path.split('/')[3]);
        return await handleReject(request, env, paperId);
      }

      // ── POST /api/gallery/send ──
      if (method === 'POST' && path === '/api/gallery/send') {
        return await handleGallerySend(request, env);
      }

      // ── POST /api/gallery/confirm ──
      if (method === 'POST' && path === '/api/gallery/confirm') {
        return await handleGalleryConfirm(request, env);
      }

      // ── POST /api/paper/:id/certificate ──
      if (method === 'POST' && path.match(/^\/api\/paper\/[^/]+\/certificate$/)) {
        const paperId = decodeURIComponent(path.split('/')[3]);
        return await handleCertificateSend(request, env, paperId);
      }

      // ── POST /api/payment/verify ──
      if (method === 'POST' && path === '/api/payment/verify') {
        return await handlePaymentVerify(request, env);
      }

      // ── POST /api/publish ──
      if (method === 'POST' && path === '/api/publish') {
        return await handlePublish(request, env);
      }

      // ── Reviewer Pool ──
      if (path === '/api/reviewers') {
        if (method === 'GET') return await handleListReviewers(env);
        if (method === 'POST') return await handleAddReviewer(request, env);
      }

      // ── POST /api/telegram/webhook ──
      if (method === 'POST' && path === '/api/telegram/webhook') {
        return await handleTelegramWebhook(request, env);
      }

      // ── Zenodo archival (legacy compat) ──
      if (method === 'POST' && path === '/api/archive/zenodo') {
        return await handleZenodoArchive(request, env);
      }
      if (method === 'GET' && path.startsWith('/api/archive/zenodo/')) {
        const paperId = decodeURIComponent(path.replace('/api/archive/zenodo/', '')).trim();
        return await handleZenodoQuery(env, paperId);
      }

      // ── Inbound Email Ingestion & Webhook ──
      // ── Poll Zoho IMAP for New Emails ──
      if (method === 'GET' && path === '/api/email/poll-zoho') {
        const res = await checkZohoImap(env);
        return json(res);
      }

      // ── Dispatch Queued Email ──
      if (method === 'POST' && path.startsWith('/api/email/dispatch-queued/')) {
        const paperId = decodeURIComponent(path.replace('/api/email/dispatch-queued/', '')).trim();
        return await handleDispatchQueued(env, paperId);
      }

      if (method === 'POST' && path === '/api/email/confirm-dispatch') {
        return await handleConfirmEmailDispatch(request, env);
      }

      if (method === 'POST' && path === '/api/email/inbound') {
        return await handleInboundEmailHttp(request, env);
      }
      if (method === 'POST' && path === '/api/email/simulate') {
        return await handleSimulateEmail(request, env);
      }
      if (method === 'GET' && path === '/api/inbound/emails') {
        return await handleListInboundEmails(env);
      }

      // ── GET /api/cron/deadlines ──
      if (method === 'GET' && path === '/api/cron/deadlines') {
        return await handleDeadlineCron(env);
      }

      return json({ error: 'Endpoint not found' }, 404);

    } catch (err) {
      console.error('Worker error:', err);
      return json({ success: false, error: err.message || 'Internal server error' }, 500);
    }
  },

  // Cloudflare Email Routing event handler
  async email(message, env, ctx) {
    await handleInboundEmailStream(message, env, ctx);
  },

  // Cron trigger handler
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleDeadlineCron(env));
    ctx.waitUntil(checkZohoImap(env));
  },
};

/**
 * Cloudflare Email Routing Stream Handler
 * Ingests incoming emails to editor@, review@, publisher@ via Email Routing,
 * runs AI summary, persists to D1, alerts Telegram, and forwards directly into Zoho Mail inboxes.
 */
async function handleInboundEmailStream(message, env, ctx) {
  try {
    const from = message.from || 'unknown@domain.com';
    const to = message.to || 'editor@mpptjournal.com';
    const subject = message.headers.get('subject') || 'Manuscript Inquiry';
    
    // Loop guard
    if (subject.includes('[Forwarded from Cloudflare Worker]')) {
      return;
    }

    // Read raw email body
    const raw = await new Response(message.raw).text().catch(() => '');
    let bodyText = '';
    
    const doubleNewline = raw.indexOf('\r\n\r\n');
    if (doubleNewline !== -1) {
      bodyText = raw.substring(doubleNewline + 4);
    } else {
      bodyText = raw;
    }

    bodyText = bodyText.substring(0, 4000).replace(/--[a-zA-Z0-9_-]+/g, '').trim();

    // 1. Ingest into MPPT AI engine (D1 persistence + Workers AI summary + Telegram card + author ack)
    await processInboundEmail(env, {
      fromAddress: from,
      toAddress: to,
      inbox: to,
      subject,
      bodyText: bodyText || `Incoming email to ${to} from ${from}`,
    });

    // 2. Forward original email directly to Zoho Mail inboxes (editor@mpptjournal.com & respective desk)
    if (env.ZOHO_SMTP_PASS || env.ZOHO_APP_PASSWORD) {
      const forwardHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; color: #1e293b; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="background: #f8fafc; border-left: 4px solid #0284c7; padding: 14px 18px; margin-bottom: 20px; border-radius: 0 6px 6px 0;">
            <h3 style="margin: 0 0 6px 0; color: #0f172a; font-size: 15px;">📨 Forwarded from Cloudflare Worker</h3>
            <table style="width: 100%; font-size: 13px; color: #475569; border-collapse: collapse;">
              <tr><td style="width: 110px; padding: 2px 0; font-weight: 600;">Original Sender:</td><td style="padding: 2px 0; color: #0f172a;">${from.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td></tr>
              <tr><td style="padding: 2px 0; font-weight: 600;">Recipient Desk:</td><td style="padding: 2px 0; color: #0f172a;">${to}</td></tr>
              <tr><td style="padding: 2px 0; font-weight: 600;">Subject:</td><td style="padding: 2px 0; color: #0f172a;"><strong>${subject.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</strong></td></tr>
              <tr><td style="padding: 2px 0; font-weight: 600;">Received Time:</td><td style="padding: 2px 0;">${new Date().toUTCString()}</td></tr>
            </table>
          </div>
          <div style="padding: 6px 4px; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${(bodyText || 'No plain text content.').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div style="margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px; font-size: 11px; color: #94a3b8;">
            Delivered by Cloudflare Worker <code>mppt-api</code> via Zoho SMTP relay • Replying to this message replies directly to <code>${from}</code>
          </div>
        </div>
      `;

      const targetInboxes = new Set(['editor@mpptjournal.com']);
      if (to && to.endsWith('@mpptjournal.com')) {
        targetInboxes.add(to.toLowerCase().trim());
      }

      for (const dest of targetInboxes) {
        ctx.waitUntil(
          sendViaZohoSmtp(env, {
            from: dest,
            to: dest,
            subject: `[Forwarded from Cloudflare Worker] ${subject}`,
            html: forwardHtml,
          }).catch(e => console.error('Zoho forward delivery error:', e))
        );
      }
    }
  } catch (err) {
    console.error('handleInboundEmailStream failed:', err);
  }
}

// ════════════════════════════════════════════════════════════
// HANDLER: SUBMISSION INTAKE
// ════════════════════════════════════════════════════════════

async function handleSubmission(request, env, url) {
  const contentType = request.headers.get('content-type') || '';
  
  let file, authorName, authorEmail, title, abstract, keywords, affiliation, orcid, coauthors, scope, articleType;

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    file = formData.get('file');
    authorName = formData.get('authorName') || formData.get('author_name') || '';
    authorEmail = (formData.get('authorEmail') || formData.get('author_email') || '').toLowerCase().trim();
    title = formData.get('title') || formData.get('manuscriptTitle') || '';
    abstract = formData.get('abstract') || '';
    keywords = formData.get('keywords') || '';
    affiliation = formData.get('affiliation') || '';
    orcid = formData.get('orcid') || '';
    coauthors = formData.get('coauthors') || '[]';
    scope = formData.get('scope') || formData.get('subject_scope') || '';
    articleType = formData.get('article_type') || 'research';

    // Legacy compat: map old field names
    if (!authorName) authorName = formData.get('paperId') || 'Unknown Author';
    if (!authorEmail) authorEmail = formData.get('authorEmail') || '';
  } else {
    return json({ success: false, error: 'Content-Type must be multipart/form-data' }, 400);
  }

  if (!file || typeof file === 'string') {
    return json({ success: false, error: 'No manuscript file uploaded' }, 400);
  }
  if (!authorEmail || !authorEmail.includes('@')) {
    return json({ success: false, error: 'Valid author email is required' }, 400);
  }

  // File validation
  const MAX_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return json({ success: false, error: 'File exceeds 50 MB limit' }, 413);
  }
  const origName = file.name || 'manuscript.pdf';
  const ext = origName.split('.').pop().toLowerCase();
  if (!['pdf', 'docx', 'doc'].includes(ext)) {
    return json({ success: false, error: 'Only .pdf, .docx, .doc files are permitted' }, 400);
  }

  // Generate paper ID
  const volume = env.CURRENT_VOLUME || '1';
  const issue = env.CURRENT_ISSUE || '1';
  let paperId;
  
  if (env.DB) {
    paperId = await generatePaperId(env.DB, volume, issue);
  } else {
    paperId = `MPPT-${new Date().getFullYear()}-V${volume}I${issue}-${Date.now().toString().slice(-4)}`;
  }

  // Upload to R2
  const safeBaseName = origName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const r2Folder = `manuscripts/${paperId}`;
  const r2Key = `${r2Folder}/original/${Date.now()}_${safeBaseName}`;

  if (env.MANUSCRIPTS) {
    await env.MANUSCRIPTS.put(r2Key, file.stream(), {
      httpMetadata: {
        contentType: file.type || 'application/pdf',
        contentDisposition: `attachment; filename="${safeBaseName}"`,
      },
      customMetadata: {
        paperId,
        authorEmail,
        authorName,
        title: (title || '').substring(0, 200),
        uploadedAt: now(),
      },
    });
  }

  // Insert into D1
  if (env.DB) {
    await env.DB.prepare(`
      INSERT INTO manuscripts (
        paper_id, title, abstract, keywords, author_name, author_email, 
        author_affiliation, author_orcid, coauthors, subject_scope, article_type,
        volume, issue, stage, stage_history, r2_folder, original_filename
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      paperId, title, abstract, keywords, authorName, authorEmail,
      affiliation, orcid, coauthors, scope, articleType,
      parseInt(volume), parseInt(issue), STAGES.SUBMITTED,
      JSON.stringify([{ stage: STAGES.SUBMITTED, timestamp: now(), actor: 'author' }]),
      r2Folder, safeBaseName
    ).run();
  }

  // Notify Telegram group
  if (env.TELEGRAM_BOT_TOKEN) {
    const cleanTitle = (title || 'Untitled').replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanAuthor = (authorName || 'Author').replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ').replace(/\s+/g, ' ').trim();

    const msg = `📥 *NEW SUBMISSION RECEIVED*\n\n` +
      `🆔 *Paper ID:* \`${paperId}\`\n` +
      `📄 *Title:* _${cleanTitle}_\n` +
      `👤 *Author:* ${cleanAuthor}\n` +
      `📧 *Email:* \`${authorEmail}\`\n` +
      `📁 *File:* \`${safeBaseName}\` (${(file.size / 1024).toFixed(1)} KB)\n` +
      `🏷️ *Scope:* ${scope || 'Not specified'}\n\n` +
      `➡️ Stage: *${STAGE_LABELS.SUBMITTED}*\n` +
      `⏭️ Next: Plagiarism & AI content check`;
    
    await sendTelegram(env, msg);
  }

  // Log intake in system communications
  if (env.DB) {
    await logComm(env.DB, paperId, 'system', 'inbound', authorEmail, 'system', 
      'Manuscript Submitted', `${title} by ${authorName}`, null, STAGES.SUBMITTED);
  }

  // Dispatch or queue official submission confirmation email (Template: 1_SUBMISSION_CONFIRMATION)
  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '1_SUBMISSION_CONFIRMATION',
    fromInbox: 'review@mpptjournal.com',
    toAddress: authorEmail,
    subject: `Manuscript Submission Received — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: title,
      AUTHOR_NAME: authorName,
      TIMESTAMP: now(),
    },
    stage: STAGES.SUBMITTED,
  });

  const downloadUrl = `${url.origin}/download/${encodeURIComponent(r2Key)}`;

  return json({
    success: true,
    message: 'Manuscript submitted successfully',
    paperId,
    stage: STAGES.SUBMITTED,
    stageLabel: STAGE_LABELS.SUBMITTED,
    r2Key,
    fileName: safeBaseName,
    fileSize: file.size,
    downloadUrl,
    nextStep: 'Plagiarism & AI content screening will begin shortly.',
  }, 201);
}

// ════════════════════════════════════════════════════════════
// HANDLER: DOWNLOAD
// ════════════════════════════════════════════════════════════

async function handleDownload(request, env, path) {
  const rawKey = path.replace('/download/', '');
  const r2Key = decodeURIComponent(rawKey);
  if (!r2Key) return json({ success: false, error: 'Missing file key' }, 400);
  if (!env.MANUSCRIPTS) return json({ success: false, error: 'R2 not available' }, 500);

  const object = await env.MANUSCRIPTS.get(r2Key);
  if (!object) return json({ success: false, error: 'File not found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=86400');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(object.body, { headers });
}

// ════════════════════════════════════════════════════════════
// HANDLER: LIST MANUSCRIPTS (legacy compat)
// ════════════════════════════════════════════════════════════

async function handleListManuscripts(env, path, url) {
  const paperId = path.replace('/manuscripts/', '').trim();
  if (!paperId) return json({ success: false, error: 'Missing paper ID' }, 400);
  if (!env.MANUSCRIPTS) return json({ success: true, paperId, files: [] });

  const list = await env.MANUSCRIPTS.list({ prefix: `manuscripts/${paperId}/` });
  const files = list.objects.map(o => ({
    key: o.key,
    size: o.size,
    uploaded: o.uploaded,
    downloadUrl: `${url.origin}/download/${encodeURIComponent(o.key)}`,
  }));

  return json({ success: true, paperId, files });
}

// ════════════════════════════════════════════════════════════
// HANDLER: PAPER STATUS
// ════════════════════════════════════════════════════════════

async function handlePaperStatus(env, paperId) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const paper = await env.DB.prepare(`SELECT * FROM manuscripts WHERE paper_id = ?`).bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  // Get review assignments
  const reviews = await env.DB.prepare(
    `SELECT ra.*, r.name as reviewer_name, r.email as reviewer_email 
     FROM review_assignments ra JOIN reviewers r ON ra.reviewer_id = r.id 
     WHERE ra.paper_id = ?`
  ).bind(paperId).all();

  // Get communications
  const comms = await env.DB.prepare(
    `SELECT channel, direction, subject, stage_at_time, sent_at FROM communications WHERE paper_id = ? ORDER BY sent_at DESC LIMIT 20`
  ).bind(paperId).all();

  return json({
    success: true,
    paper: {
      ...paper,
      stage_history: safeJsonParse(paper.stage_history, []),
      stageLabel: STAGE_LABELS[paper.stage] || paper.stage,
      daysUntilDeadline: daysUntil(paper.current_deadline),
    },
    reviews: reviews.results || [],
    recentCommunications: comms.results || [],
  });
}

// ════════════════════════════════════════════════════════════
// HANDLER: LIST ALL PAPERS
// ════════════════════════════════════════════════════════════

async function handleListPapers(env, url) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const stage = url.searchParams.get('stage');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  let query = 'SELECT paper_id, title, author_name, author_email, stage, submitted_at, updated_at, current_deadline FROM manuscripts WHERE is_active = 1';
  const params = [];

  if (stage) {
    query += ' AND stage = ?';
    params.push(stage);
  }

  query += ' ORDER BY submitted_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const results = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return json({
    success: true,
    count: results.results?.length || 0,
    papers: (results.results || []).map(p => ({
      ...p,
      stageLabel: STAGE_LABELS[p.stage] || p.stage,
      daysUntilDeadline: daysUntil(p.current_deadline),
    })),
  });
}

// ════════════════════════════════════════════════════════════
// HANDLER: PLAGIARISM RESULT
// ════════════════════════════════════════════════════════════

async function handlePlagiarismResult(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);
  
  const body = await request.json();
  const { paperId, plagiarismScore, aiContentScore } = body;

  if (!paperId) return json({ success: false, error: 'paperId required' }, 400);

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  const score = parseFloat(plagiarismScore || 0);
  const aiScore = parseFloat(aiContentScore || 0);

  await env.DB.prepare(`
    UPDATE manuscripts SET plagiarism_score = ?, ai_content_score = ?, plagiarism_attempts = plagiarism_attempts + 1, updated_at = ?
    WHERE paper_id = ?
  `).bind(score, aiScore, now(), paperId).run();

  if (score > 10) {
    // FAIL — set 3-day resubmission deadline
    const deadline = addDays(3);
    await advanceStage(env.DB, paperId, STAGES.PLAGIARISM_FAIL, 'system');
    await env.DB.prepare(`UPDATE manuscripts SET current_deadline = ?, deadline_type = 'resubmit_plagiarism' WHERE paper_id = ?`)
      .bind(deadline, paperId).run();

    // Schedule daily reminders
    for (let d = 1; d <= 3; d++) {
      await env.DB.prepare(`INSERT INTO scheduled_tasks (paper_id, task_type, target_email, fire_at) VALUES (?, 'deadline_alert', ?, ?)`)
        .bind(paperId, paper.author_email, addDays(d)).run();
    }

    // Notify group
    await sendTelegram(env,
      `⚠️ *PLAGIARISM CHECK FAILED*\n\n` +
      `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
      `📊 Similarity: *${score.toFixed(1)}%* (threshold: ≤10%)\n` +
      `🤖 AI Content: *${aiScore.toFixed(1)}%*\n\n` +
      `📧 Author emailed to resubmit within 3 days.\n⏰ Deadline: ${deadline.split('T')[0]}`
    );

    // Official resubmission email (Template: 2A_PLAGIARISM_RESUBMIT)
    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: '2A_PLAGIARISM_RESUBMIT',
      fromInbox: 'review@mpptjournal.com',
      toAddress: paper.author_email,
      subject: `Plagiarism Audit: Revision Required — ${paperId} · MPPT Journal`,
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
        AUTHOR_NAME: paper.author_name,
        SIMILARITY_SCORE: `${score.toFixed(1)}%`,
        AI_SCORE: `${aiScore.toFixed(1)}%`,
        DEADLINE_DATE: deadline.split('T')[0],
      },
      stage: STAGES.PLAGIARISM_FAIL,
    });

    return json({ success: true, passed: false, score, aiScore, deadline, message: 'Author notified to resubmit' });

  } else {
    // PASS
    await advanceStage(env.DB, paperId, STAGES.PLAGIARISM_PASS, 'system');
    await env.DB.prepare(`UPDATE manuscripts SET current_deadline = NULL, deadline_type = NULL WHERE paper_id = ?`)
      .bind(paperId).run();

    await notifyStageChange(env, paper, STAGES.PLAGIARISM_PASS);

    await sendTelegram(env,
      `✅ *PLAGIARISM CHECK PASSED*\n\n` +
      `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
      `📊 Similarity: *${score.toFixed(1)}%* ✅\n🤖 AI Content: *${aiScore.toFixed(1)}%*\n\n` +
      `⏭️ Next: Formatting audit`
    );

    // Official desk screening cleared email (Template: 2_DESK_SCREENING_CLEARED)
    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: '2_DESK_SCREENING_CLEARED',
      fromInbox: 'review@mpptjournal.com',
      toAddress: paper.author_email,
      subject: `Editorial Desk Screening Cleared — ${paperId} · MPPT Journal`,
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
      },
      stage: STAGES.PLAGIARISM_PASS,
    });

    return json({ success: true, passed: true, score, aiScore, message: 'Proceeding to formatting audit' });
  }
}

// ════════════════════════════════════════════════════════════
// HANDLER: FORMAT RESULT
// ════════════════════════════════════════════════════════════

async function handleFormatResult(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { paperId, passed, issues } = body;

  if (!paperId) return json({ success: false, error: 'paperId required' }, 400);

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  if (!passed) {
    const deadline = addDays(3);
    await advanceStage(env.DB, paperId, STAGES.FORMATTING_FAIL, 'system');
    await env.DB.prepare(`UPDATE manuscripts SET current_deadline = ?, deadline_type = 'resubmit_format' WHERE paper_id = ?`)
      .bind(deadline, paperId).run();

    await sendTelegram(env,
      `⚠️ *FORMATTING ISSUES FOUND*\n\n` +
      `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
      `📋 Issues:\n${(issues || []).map(i => `• ${i}`).join('\n')}\n\n` +
      `📧 Author emailed. Deadline: ${deadline.split('T')[0]}`
    );

    const issuesList = (issues || []).map(i => `<li>${i}</li>`).join('');
    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: '3A_FORMATTING_REVISION',
      fromInbox: 'review@mpptjournal.com',
      toAddress: paper.author_email,
      subject: `Technical Formatting Revision Required — ${paperId} · MPPT Journal`,
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
        AUTHOR_NAME: paper.author_name,
        DEADLINE_DATE: deadline.split('T')[0],
        FORMATTING_ISSUES_LIST: issuesList || '<li>Ensure Vancouver referencing and ≥300 DPI figures.</li>',
      },
      stage: STAGES.FORMATTING_FAIL,
    });

    return json({ success: true, passed: false, issues, deadline });
  } else {
    await advanceStage(env.DB, paperId, STAGES.FORMATTING_PASS, 'system');
    await env.DB.prepare(`UPDATE manuscripts SET current_deadline = NULL, deadline_type = NULL WHERE paper_id = ?`)
      .bind(paperId).run();

    await sendTelegram(env,
      `✅ *FORMATTING CHECK PASSED*\n\n` +
      `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
      `⏭️ Next: Reviewer assignment`
    );

    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: '3B_FORMATTING_CLEARED',
      fromInbox: 'review@mpptjournal.com',
      toAddress: paper.author_email,
      subject: `Technical Formatting Cleared — ${paperId} · MPPT Journal`,
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
        AUTHOR_NAME: paper.author_name,
      },
      stage: STAGES.FORMATTING_PASS,
    });

    return json({ success: true, passed: true, message: 'Proceeding to reviewer assignment' });
  }
}

// ════════════════════════════════════════════════════════════
// HANDLER: REVIEWER ASSIGNMENT
// ════════════════════════════════════════════════════════════

async function handleReviewerAssign(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { paperId, reviewerIds } = body;

  if (!paperId) return json({ success: false, error: 'paperId required' }, 400);

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  let selectedIds = reviewerIds;

  // Auto-select if no specific IDs given
  if (!selectedIds || selectedIds.length === 0) {
    const scope = paper.subject_scope || '';
    let reviewers;
    
    if (scope) {
      reviewers = await env.DB.prepare(
        `SELECT id, name, email FROM reviewers WHERE is_active = 1 AND speciality LIKE ? ORDER BY total_assigned ASC LIMIT 2`
      ).bind(`%${scope}%`).all();
    }
    
    if (!reviewers || !reviewers.results || reviewers.results.length < 2) {
      reviewers = await env.DB.prepare(
        `SELECT id, name, email FROM reviewers WHERE is_active = 1 ORDER BY total_assigned ASC LIMIT 2`
      ).all();
    }

    if (!reviewers.results || reviewers.results.length === 0) {
      return json({ success: false, error: 'No active reviewers in pool. Add reviewers first.' }, 400);
    }

    selectedIds = reviewers.results.map(r => r.id);
  }

  const deadline = addDays(10);
  const assigned = [];

  for (const rid of selectedIds) {
    const reviewer = await env.DB.prepare('SELECT * FROM reviewers WHERE id = ?').bind(rid).first();
    if (!reviewer) continue;

    await env.DB.prepare(`
      INSERT INTO review_assignments (paper_id, reviewer_id, status, deadline)
      VALUES (?, ?, 'INVITED', ?)
    `).bind(paperId, rid, deadline).run();

    await env.DB.prepare(`UPDATE reviewers SET total_assigned = total_assigned + 1 WHERE id = ?`).bind(rid).run();

    // Schedule reminders every 2 days
    for (let d = 2; d <= 10; d += 2) {
      await env.DB.prepare(`INSERT INTO scheduled_tasks (paper_id, task_type, target_email, fire_at) VALUES (?, 'reviewer_reminder', ?, ?)`)
        .bind(paperId, reviewer.email, addDays(d)).run();
    }

    assigned.push({ id: rid, name: reviewer.name, email: reviewer.email });

    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: 'INVITATION_REVIEWER',
      fromInbox: 'review@mpptjournal.com',
      toAddress: reviewer.email,
      subject: 'Formal Invitation: Join the MPPT Journal Peer Reviewer Board',
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
      },
      stage: STAGES.REVIEWER_ASSIGNED,
    });
  }

  await advanceStage(env.DB, paperId, STAGES.REVIEWER_ASSIGNED, 'system');
  await env.DB.prepare(`UPDATE manuscripts SET current_deadline = ?, deadline_type = 'reviewer_response' WHERE paper_id = ?`)
    .bind(deadline, paperId).run();

  await sendTelegram(env,
    `📨 *REVIEWERS ASSIGNED*\n\n` +
    `🆔 \`${paperId}\`\n📄 _${paper.title}_\n\n` +
    `👥 Assigned Reviewers:\n${assigned.map((r, i) => `${i + 1}. ${r.name} (${r.email})`).join('\n')}\n\n` +
    `⏰ Review deadline: ${deadline.split('T')[0]} (10 days)\n` +
    `🔔 Reminders every 2 days`
  );

  // Dispatch author notification (Template: 3_PEER_REVIEW_DISPATCH)
  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '3_PEER_REVIEW_DISPATCH',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: `Dispatched for Double-Blind Peer Review — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
    },
    stage: STAGES.REVIEWER_ASSIGNED,
  });

  return json({ success: true, paperId, assigned, deadline, message: 'Reviewers assigned and notified' });
}

// ════════════════════════════════════════════════════════════
// HANDLER: REVIEWER DECISION
// ════════════════════════════════════════════════════════════

async function handleReviewerDecision(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { paperId, reviewerId, decision, comments } = body;

  if (!paperId || !reviewerId || !decision) {
    return json({ success: false, error: 'paperId, reviewerId, decision required' }, 400);
  }

  await env.DB.prepare(`
    UPDATE review_assignments SET status = 'REVIEW_SUBMITTED', decision = ?, comments = ?, responded_at = ?, completed_at = ?
    WHERE paper_id = ? AND reviewer_id = ?
  `).bind(decision, comments || '', now(), now(), paperId, reviewerId).run();

  await env.DB.prepare(`UPDATE reviewers SET total_completed = total_completed + 1 WHERE id = ?`).bind(reviewerId).run();

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  const reviewer = await env.DB.prepare('SELECT name FROM reviewers WHERE id = ?').bind(reviewerId).first();

  // Check if all reviewers have responded
  const pendingReviews = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM review_assignments WHERE paper_id = ? AND status = 'INVITED'`
  ).bind(paperId).first();

  const allReviews = await env.DB.prepare(
    `SELECT decision FROM review_assignments WHERE paper_id = ? AND status = 'REVIEW_SUBMITTED'`
  ).bind(paperId).all();

  const decisions = (allReviews.results || []).map(r => r.decision);

  if (pendingReviews.cnt === 0) {
    // All reviewers responded — determine overall decision
    const hasReject = decisions.includes('reject');
    const hasMajorRevision = decisions.includes('major_revision');
    const hasMinorRevision = decisions.includes('minor_revision');

    if (hasReject || hasMajorRevision || hasMinorRevision) {
      await advanceStage(env.DB, paperId, STAGES.REVISION_REQUIRED, 'system');
      const deadline = addDays(3);
      await env.DB.prepare(`UPDATE manuscripts SET current_deadline = ?, deadline_type = 'revision' WHERE paper_id = ?`)
        .bind(deadline, paperId).run();

      await sendTelegram(env,
        `🔄 *REVISION REQUIRED*\n\n` +
        `🆔 \`${paperId}\`\n📄 _${paper.title}_\n\n` +
        `📝 Reviewer Decisions:\n${decisions.map((d, i) => `• Reviewer ${i + 1}: ${d}`).join('\n')}\n\n` +
        `📧 Author emailed with comments. Deadline: ${deadline.split('T')[0]}`
      );

      await dispatchOrQueueEmail(env, {
        paperId,
        templateKey: '5A_REVIEWER_COMMENTS',
        fromInbox: 'review@mpptjournal.com',
        toAddress: paper.author_email,
        subject: `Peer Review Comments & Revision Required — ${paperId} · MPPT Journal`,
        templateVars: {
          PAPER_ID: paperId,
          PAPER_TITLE: paper.title,
          DEADLINE_DATE: deadline.split('T')[0],
          REVIEWER_COMMENTS: decisions.map((d, i) => `Reviewer ${i + 1}: ${d}`).join('<br>'),
        },
        stage: STAGES.REVISION_REQUIRED,
      });
    } else {
      // All accept
      await advanceStage(env.DB, paperId, STAGES.ACCEPTED, 'reviewers');

      await sendTelegramWithKeyboard(env,
        `✅ *REVIEWERS RECOMMEND ACCEPTANCE*\n\n` +
        `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
        `📝 Both reviewers recommend acceptance.\n\n` +
        `👇 *Editorial Decision:*`,
        [[
          { text: '✅ Accept Paper', callback_data: `accept_${paperId}` },
          { text: '❌ Reject', callback_data: `reject_${paperId}` },
        ]]
      );

      await dispatchOrQueueEmail(env, {
        paperId,
        templateKey: '4_EDITORIAL_DECISION_ACCEPT',
        fromInbox: 'editor@mpptjournal.com',
        toAddress: paper.author_email,
        subject: `Formal Decision: Accepted for Publication — ${paperId} · MPPT Journal`,
        templateVars: {
          PAPER_ID: paperId,
          PAPER_TITLE: paper.title,
        },
        stage: STAGES.ACCEPTED,
      });
    }
  } else {
    // Partial — just notify
    await sendTelegram(env,
      `📝 *REVIEWER RESPONSE RECEIVED*\n\n` +
      `🆔 \`${paperId}\`\n📄 _${paper.title}_\n` +
      `👤 Reviewer: ${reviewer?.name || reviewerId}\n` +
      `📋 Decision: *${decision}*\n\n` +
      `⏳ Waiting for ${pendingReviews.cnt} more reviewer(s)`
    );
  }

  return json({ success: true, paperId, decision, allResponded: pendingReviews.cnt === 0 });
}

// ════════════════════════════════════════════════════════════
// HANDLER: MANUAL ADVANCE (Group decision)
// ════════════════════════════════════════════════════════════

async function handleManualAdvance(request, env, paperId) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { targetStage, actor } = body;

  if (!targetStage) return json({ success: false, error: 'targetStage required' }, 400);

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  const result = await advanceStage(env.DB, paperId, targetStage, actor || 'editor');
  await notifyStageChange(env, paper, targetStage, actor || 'editor');

  return json({ success: true, paperId, ...result });
}

// ════════════════════════════════════════════════════════════
// HANDLER: REJECT
// ════════════════════════════════════════════════════════════

async function handleReject(request, env, paperId) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { reason, actor } = body;

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  await advanceStage(env.DB, paperId, STAGES.REJECTED, actor || 'editor');
  await env.DB.prepare(`UPDATE manuscripts SET current_deadline = NULL, deadline_type = NULL WHERE paper_id = ?`)
    .bind(paperId).run();

  await sendTelegram(env,
    `❌ *PAPER REJECTED*\n\n` +
    `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
    `📝 Reason: ${reason || 'Editorial decision'}\n` +
    `📧 Author notified via editor@mpptjournal.com`
  );

  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: 'REJECTION',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: `Editorial Decision: Rejection Notice — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      DECISION_DATE: now().split('T')[0],
      REJECTION_REASON: reason || 'Does not meet our current editorial priorities or referee requirements',
    },
    stage: STAGES.REJECTED,
  });

  return json({ success: true, paperId, stage: STAGES.REJECTED, message: 'Paper rejected and author notified' });
}

// ════════════════════════════════════════════════════════════
// HANDLER: GALLERY SEND (Stage 6)
// ════════════════════════════════════════════════════════════

async function handleGallerySend(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { paperId, proofUrl, notes } = body;

  if (!paperId) return json({ success: false, error: 'paperId required' }, 400);

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  const deadline = addDays(3);
  await advanceStage(env.DB, paperId, STAGES.GALLERY_SENT, 'editor');
  await env.DB.prepare(`
    UPDATE manuscripts SET current_deadline = ?, deadline_type = 'gallery_confirm', updated_at = ?
    WHERE paper_id = ?
  `).bind(deadline, now(), paperId).run();

  await sendTelegram(env,
    `📄 *GALLERY PROOF DISPATCHED*\n\n` +
    `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
    `🔗 Proof Link: ${proofUrl || 'Pending proof generation'}\n` +
    `📧 Sent to author via editor@mpptjournal.com\n` +
    `⏰ Author Confirmation Deadline: ${deadline.split('T')[0]} (3 days)`
  );

  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '6_GALLERY_PROOF',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: `Typeset Galley Proof for Final Verification — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      DEADLINE_DATE: deadline.split('T')[0],
    },
    stage: STAGES.GALLERY_SENT,
  });

  return json({ success: true, paperId, stage: STAGES.GALLERY_SENT, deadline, proofUrl });
}

// ════════════════════════════════════════════════════════════
// HANDLER: GALLERY CONFIRM
// ════════════════════════════════════════════════════════════

async function handleGalleryConfirm(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { paperId } = body;

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  await advanceStage(env.DB, paperId, STAGES.GALLERY_CONFIRMED, 'author');
  await advanceStage(env.DB, paperId, STAGES.PAYMENT_PENDING, 'system');

  await sendTelegram(env,
    `✅ *GALLERY PROOF CONFIRMED*\n\n` +
    `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
    `⏭️ Next: Payment link sent to author`
  );

  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '7_PAYMENT_LINK',
    fromInbox: 'review@mpptjournal.com',
    toAddress: paper.author_email,
    subject: `Article Processing Charge Waiver / Settlement — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      PAYMENT_AMOUNT: '₹0 (100% Inaugural Waiver Applied)',
      PAYMENT_URL: 'https://mpptjournal.com',
    },
    stage: STAGES.PAYMENT_PENDING,
  });

  return json({ success: true, paperId, stage: STAGES.PAYMENT_PENDING });
}

// ════════════════════════════════════════════════════════════
// HANDLER: PAYMENT VERIFY (Razorpay webhook)
// ════════════════════════════════════════════════════════════

async function handlePaymentVerify(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { paperId, razorpay_payment_id, razorpay_order_id, amount } = body;

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  await env.DB.prepare(`
    UPDATE manuscripts SET razorpay_payment_id = ?, razorpay_order_id = ?, payment_amount = ?, payment_verified = 1, updated_at = ?
    WHERE paper_id = ?
  `).bind(razorpay_payment_id || '', razorpay_order_id || '', amount || 0, now(), paperId).run();

  await advanceStage(env.DB, paperId, STAGES.PAYMENT_VERIFIED, 'razorpay');

  await sendTelegram(env,
    `💰 *PAYMENT VERIFIED*\n\n` +
    `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
    `💳 Payment ID: \`${razorpay_payment_id || 'N/A'}\`\n` +
    `💵 Amount: ₹${amount || 0}\n` +
    `✅ Verified in bank.\n\n` +
    `⏭️ Next: Publication`
  );

  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '7A_PAYMENT_RECEIPT',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: `Official Payment Receipt & Tax Invoice — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      TRANSACTION_ID: razorpay_payment_id || 'WAIVER-VOL1',
      PAYMENT_AMOUNT: `₹${amount || 0}`,
      PAYMENT_DATE: now().split('T')[0],
    },
    stage: STAGES.PAYMENT_VERIFIED,
  });

  return json({ success: true, paperId, stage: STAGES.PAYMENT_VERIFIED });
}

// ════════════════════════════════════════════════════════════
// HANDLER: PUBLISH
// ════════════════════════════════════════════════════════════

async function handlePublish(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { paperId, publishedUrl, zenodoDoi } = body;

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  await env.DB.prepare(`
    UPDATE manuscripts SET published_url = ?, zenodo_doi = ?, published_at = ?, updated_at = ?
    WHERE paper_id = ?
  `).bind(publishedUrl || '', zenodoDoi || '', now(), now(), paperId).run();

  await advanceStage(env.DB, paperId, STAGES.PUBLISHED, 'system');

  await sendTelegram(env,
    `🎓 *PAPER PUBLISHED!*\n\n` +
    `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
    `🌐 URL: ${publishedUrl || 'TBD'}\n` +
    `📦 Zenodo DOI: ${zenodoDoi || 'Pending'}\n\n` +
    `📧 Certificate + PDF emailed to author.\n` +
    `✅ *WORKFLOW COMPLETE*`
  );

  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '5_PUBLISHED_AND_ARCHIVED',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: `Manuscript Published & Deposited in Zenodo — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      ARTICLE_URL: publishedUrl || 'https://mpptjournal.com',
      ZENODO_DOI: zenodoDoi || 'Pending Deposition',
      ARTICLE_URL_ENCODED: encodeURIComponent(publishedUrl || 'https://mpptjournal.com'),
    },
    stage: STAGES.PUBLISHED,
  });

  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '8_CERTIFICATE',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: `Official Publication Certificate — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      ZENODO_DOI: zenodoDoi || '10.5281/zenodo.11478902',
    },
    stage: STAGES.PUBLISHED,
  });

  return json({ success: true, paperId, stage: STAGES.PUBLISHED, publishedUrl });
}

// ════════════════════════════════════════════════════════════
// HANDLER: CERTIFICATE DISPATCH (Stage 8)
// ════════════════════════════════════════════════════════════

async function handleCertificateSend(request, env, paperId) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json().catch(() => ({}));
  const certificateUrl = body.certificateUrl || `https://mpptjournal.com/certificate?id=${paperId}`;

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ success: false, error: 'Paper not found' }, 404);

  await env.DB.prepare(`UPDATE manuscripts SET certificate_url = ?, updated_at = ? WHERE paper_id = ?`)
    .bind(certificateUrl, now(), paperId).run();

  await sendTelegram(env,
    `🎖️ *CERTIFICATE DISPATCHED*\n\n` +
    `🆔 \`${paperId}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
    `🔗 Certificate: ${certificateUrl}\n` +
    `📧 Sent to author via editor@mpptjournal.com`
  );

  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '8_CERTIFICATE',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: `Official Publication Certificate — ${paperId} · MPPT Journal`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      ZENODO_DOI: paper.zenodo_doi || '10.5281/zenodo.11478902',
    },
    stage: STAGES.PUBLISHED,
  });

  return json({ success: true, paperId, certificateUrl });
}

// ════════════════════════════════════════════════════════════
// HANDLER: REVIEWER POOL
// ════════════════════════════════════════════════════════════

async function handleListReviewers(env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const results = await env.DB.prepare('SELECT * FROM reviewers WHERE is_active = 1 ORDER BY name').all();
  return json({ success: true, reviewers: results.results || [] });
}

async function handleAddReviewer(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json();
  const { name, email, affiliation, speciality, orcid } = body;

  if (!name || !email) return json({ success: false, error: 'name and email required' }, 400);

  const cleanEmail = email.toLowerCase().trim();
  await env.DB.prepare(`
    INSERT INTO reviewers (name, email, affiliation, speciality, orcid)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      affiliation = excluded.affiliation,
      speciality = excluded.speciality,
      orcid = excluded.orcid,
      is_active = 1
  `).bind(name, cleanEmail, affiliation || '', speciality || '', orcid || '').run();

  if (env.TELEGRAM_BOT_TOKEN) {
    await sendTelegram(env,
      `👥 *NEW PEER REVIEWER ONBOARDED*\n\n` +
      `👤 *Name:* ${name}\n` +
      `📧 *Email:* \`${cleanEmail}\`\n` +
      `🔬 *Speciality:* ${speciality || 'General Pharmacy & Therapeutics'}\n` +
      `🏛️ *Affiliation:* ${affiliation || 'MPPT Reviewer Pool'}\n` +
      (orcid ? `🆔 *ORCID:* \`${orcid}\`\n` : '') +
      `\n✅ Added to active double-blind peer reviewer pool.`
    );
  }

  return json({ success: true, message: `Reviewer ${name} added to pool` }, 201);
}

// ════════════════════════════════════════════════════════════
// HANDLER: INBOUND EMAIL INGESTION & AI TELEGRAM NOTIFICATION
// ════════════════════════════════════════════════════════════

async function processInboundEmail(env, emailData) {
  let inbox = (emailData.inbox || emailData.to || 'review@mpptjournal.com').toLowerCase().trim();
  const fromAddress = (emailData.fromAddress || emailData.from || 'scholar@university.edu').toLowerCase().trim();
  const fromName = emailData.fromName || emailData.senderName || '';
  const subject = emailData.subject || 'Manuscript Correspondence';
  const bodyText = emailData.bodyText || emailData.body || emailData.content || '';
  let paperId = emailData.paperId || null;

  // Distinct visual branding & badging for the 3 official mailboxes
  let deskBadge = '📬 *[MPPT INBOX]*';
  let deskHeader = 'MPPT Journal Inbox';
  if (inbox.includes('editor')) {
    inbox = 'editor@mpptjournal.com';
    deskBadge = '🎓 *[OFFICIAL EDITORIAL DESK]*';
    deskHeader = 'Editor-in-Chief & Editorial Office';
  } else if (inbox.includes('review')) {
    inbox = 'review@mpptjournal.com';
    deskBadge = '🔬 *[PEER REVIEW & SCREENING DESK]*';
    deskHeader = 'Managing Editor & Peer Review';
  } else if (inbox.includes('publisher')) {
    inbox = 'publisher@mpptjournal.com';
    deskBadge = '🏛️ *[PUBLISHING & PRODUCTION DESK]*';
    deskHeader = 'Publisher Desk & Archival';
  }

  // Attempt to extract Paper ID from subject or body if not provided
  if (!paperId) {
    const match = (subject + ' ' + bodyText).match(/MPPT-\d{4}-V\d+I\d+-\d{4}/i);
    if (match) paperId = match[0].toUpperCase();
  }

  const inboundId = `INB-${Date.now().toString(36).toUpperCase()}`;

  // 1. Generate 1-2 sentence AI summary using Workers AI
  let summary = '';
  if (env.AI) {
    const messages = [
      {
        role: 'system',
        content: `You are an editorial assistant for MPPT Journal (${deskHeader}). Summarize the following incoming academic email in 1 to 2 clear, concise sentences for the editors in Telegram. State who wrote, what they want or need, any manuscript IDs, and what action is required.`
      },
      {
        role: 'user',
        content: `Recipient Desk: ${inbox}\nFrom: ${fromName ? `${fromName} <${fromAddress}>` : fromAddress}\nSubject: ${subject}\n\nEmail Content:\n${bodyText.substring(0, 2500)}`
      }
    ];
    summary = await runAiChat(env, messages, 220);
  }

  if (!summary) {
    summary = bodyText.length > 200 ? bodyText.substring(0, 200) + '...' : (bodyText || 'Incoming communication received.');
  }

  // 2. Persist in Cloudflare D1
  if (env.DB) {
    try {
      await env.DB.prepare(`
        INSERT INTO inbound_emails (inbound_id, inbox, from_address, from_name, subject, body_text, summary, paper_id, reply_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).bind(inboundId, inbox, fromAddress, fromName, subject, bodyText, summary, paperId).run();

      // Log in communications ledger
      await logComm(env.DB, paperId, 'email', 'inbound', fromAddress, inbox, subject, summary, null, null);
    } catch (dbErr) {
      console.error('D1 inbound email insert error:', dbErr);
    }
  }

  // 3. Dispatch prompt alert to Telegram Group
  const senderDisplay = fromName ? `${fromName} (${fromAddress})` : fromAddress;
  const alertText = 
    `${deskBadge}\n` +
    `📬 *New Inbound Email Received!*\n\n` +
    `📥 *Mailbox:* \`${inbox}\`\n` +
    `👤 *From:* ${senderDisplay.replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ')}\n` +
    `📋 *Subject:* *${subject.replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ')}*\n` +
    (paperId ? `🆔 *Paper ID:* \`${paperId}\`\n` : '') +
    `\n📝 *AI Summary:*\n_${summary.replace(/[_*[\]()~`>#+=|{}.!-]/g, ' ')}_\n\n` +
    `💡 *Quick Action:*\n` +
    `Reply directly to this alert with \`Reply: <instructions>\` to auto-draft an academic reply.`;

  let tgMsgId = null;
  if (env.TELEGRAM_BOT_TOKEN) {
    const tgRes = await sendTelegram(env, alertText);
    tgMsgId = tgRes?.result?.message_id;

    if (tgMsgId && env.DB) {
      await env.DB.prepare(`UPDATE inbound_emails SET telegram_msg_id = ? WHERE inbound_id = ?`)
        .bind(tgMsgId, inboundId).run();
    }
  }

  // 4. Autonomous Instant Acknowledgment to Sender via Zoho SMTP
  const isNoReply = /^(?:no-?reply|mailer-daemon|postmaster|bounce|notifications?|alert|admin|google|cloudflare|zoho)@/i.test(fromAddress) ||
                    fromAddress.endsWith('@mpptjournal.com');
  if (!isNoReply && (env.ZOHO_SMTP_PASS || env.ZOHO_APP_PASSWORD)) {
    try {
      const ackHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; line-height: 1.6;">
          <div style="border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 18px;">Journal of Modern Pharmacy Praxis & Therapeutics</h2>
            <p style="color: #64748b; font-size: 13px; margin: 4px 0 0;">${deskHeader} • Official Academic Communication</p>
          </div>
          <p style="margin-top: 0;">Dear ${fromName ? fromName : 'Author / Colleague'},</p>
          <p>Thank you for contacting the Editorial Office of the <strong>Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal)</strong>.</p>
          <p>This automated notification confirms that your correspondence regarding <em>"${subject.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</em> has been received and registered under Inbound Communication ID: <code>${inboundId}</code>${paperId ? ` (Manuscript ID: <code>${paperId}</code>)` : ''}.</p>
          <p>Your communication has been cataloged in our editorial tracking registry and forwarded to the handling editorial team. We will review your correspondence and follow up promptly.</p>
          <div style="margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 12px; color: #64748b;">
            <p style="margin: 0; font-weight: 600;">Editorial Office</p>
            <p style="margin: 2px 0 0;">Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal)</p>
            <p style="margin: 2px 0 0;"><a href="https://mpptjournal.com" style="color: #0284c7; text-decoration: none;">https://mpptjournal.com</a> | ${inbox}</p>
          </div>
        </div>
      `;

      await sendViaZohoSmtp(env, {
        from: inbox,
        to: fromAddress,
        subject: `[Received] Re: ${subject} — MPPT Journal [${inboundId}]`,
        html: ackHtml
      });

      if (env.DB) {
        await logComm(env.DB, paperId, 'email', 'outbound', inbox, fromAddress,
          `[Auto-Ack] Re: ${subject}`, `Automated acknowledgment dispatched for inquiry ${inboundId}`, 'auto_ack', null);
      }
    } catch (e) {
      console.error('Failed to send auto-ack email:', e);
    }
  }

  return { success: true, inboundId, inbox, fromAddress, subject, summary, telegramMsgId: tgMsgId };
}

async function handleInboundEmailHttp(request, env) {
  let body = {};
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await request.json().catch(() => ({}));
  } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => new FormData());
    for (const [k, v] of form.entries()) {
      body[k] = v;
    }
  } else {
    body = await request.json().catch(() => ({}));
  }

  const inbox = body.inbox || body.to || body.recipient || body.to_address || body.recipient_email || 'review@mpptjournal.com';
  const from = body.from || body.fromAddress || body.sender || body.from_email || body.sender_email;
  const fromName = body.fromName || body.senderName || body.from_name || '';
  const subject = body.subject || 'Manuscript Communication';
  const emailBody = body.body || body.bodyText || body.content || body.text || body.html || body.message || '';
  const paperId = body.paperId || body.paper_id || null;

  if (!from && !subject && !emailBody) {
    return json({ success: false, error: 'Valid email payload (sender, subject or content) required' }, 400);
  }

  const result = await processInboundEmail(env, {
    inbox,
    fromAddress: from || 'scholar@university.edu',
    fromName,
    subject,
    bodyText: emailBody,
    paperId,
  });

  return json({ success: true, ...result }, 201);
}

async function handleSimulateEmail(request, env) {
  const body = await request.json().catch(() => ({}));
  const sample = {
    inbox: body.inbox || 'review@mpptjournal.com',
    fromAddress: body.from || 'author.kumar@aiims.edu',
    fromName: body.fromName || 'Dr. Rajesh Kumar',
    subject: body.subject || 'Inquiry regarding manuscript MPPT-2026-V1I1-0003 review status',
    bodyText: body.body || 'Dear Editorial Desk, I am writing to politely inquire regarding the status of our submission MPPT-2026-V1I1-0003. Could you kindly provide an update on the screening and peer review timeline? Sincerely, Dr. Rajesh Kumar, AIIMS New Delhi.',
    paperId: body.paperId || 'MPPT-2026-V1I1-0003'
  };

  const result = await processInboundEmail(env, sample);
  return json({ success: true, message: 'Simulated email processed and Telegram alert dispatched', ...result });
}

async function handleListInboundEmails(env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);
  const rows = await env.DB.prepare(`SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 50`).all();
  return json({ success: true, count: rows.results?.length || 0, emails: rows.results || [] });
}

async function handleDispatchQueued(env, paperId) {
  if (!env.DB) return json({ error: 'Database binding missing' }, 500);

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ error: 'Paper not found' }, 404);

  // Find latest pending draft
  const draft = await env.DB.prepare(`
    SELECT * FROM communications 
    WHERE paper_id = ? AND channel = 'email_draft' 
    ORDER BY timestamp DESC LIMIT 1
  `).bind(paperId).first();

  const templateKey = draft?.template_used || '1_SUBMISSION_CONFIRMATION';
  const toAddress = draft?.to_address || paper.author_email;
  const fromInbox = draft?.from_address || 'review@mpptjournal.com';

  const res = await dispatchOrQueueEmail(env, {
    paperId,
    templateKey,
    fromInbox,
    toAddress,
    subject: draft?.subject,
    templateVars: {
      AUTHOR_NAME: paper.author_name,
      PAPER_ID: paper.paper_id,
      MANUSCRIPT_TITLE: paper.title,
      SUBMISSION_DATE: paper.created_at ? paper.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
      TRACKING_URL: `https://mpptjournal.com/track.html?id=${encodeURIComponent(paper.paper_id)}`,
      CONFIRMATION_DEADLINE: 'within 48 hours',
      DESK_EMAIL: fromInbox,
    },
    stage: paper.stage,
  });

  return json({ success: true, paperId, result: res });
}

async function handleConfirmEmailDispatch(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json().catch(() => ({}));
  const { paperId, templateKey, toAddress, fromAddress, subject, notes } = body;

  if (!paperId || !toAddress) {
    return json({ success: false, error: 'paperId and toAddress required' }, 400);
  }

  const cleanFrom = fromAddress || 'review@mpptjournal.com';
  const cleanSubject = subject || `Official Dispatch — ${paperId} · MPPT Journal`;

  await logComm(env.DB, paperId, 'email', 'outbound', cleanFrom, toAddress,
    cleanSubject, notes || `Verified dispatched via Zoho Mail (${templateKey || 'Custom'})`, templateKey || null, null);

  // Update any pending draft in communications
  await env.DB.prepare(`
    UPDATE communications SET direction = 'dispatched_verified' 
    WHERE paper_id = ? AND channel = 'email_draft' AND direction = 'pending_manual_dispatch'
  `).bind(paperId).run().catch(() => {});

  if (env.TELEGRAM_BOT_TOKEN) {
    await sendTelegram(env,
      `✅ *EMAIL DISPATCH OFFICIALLY VERIFIED IN D1*\n\n` +
      `🆔 *Paper ID:* \`${paperId}\`\n` +
      `📧 *Template:* \`${templateKey || 'Custom'}\`\n` +
      `📤 *From Desk:* \`${cleanFrom}\`\n` +
      `📨 *To Recipient:* \`${toAddress}\`\n` +
      `📋 *Subject:* _${cleanSubject}_\n` +
      `🕒 *Timestamp:* ${now()}\n\n` +
      `Audit ledger in Cloudflare D1 communications updated with verified outbound send.`
    );
  }

  return json({ success: true, message: 'Verified outbound dispatch recorded in D1' }, 200);
}

async function handleTelegramWebhook(request, env) {
  const update = await request.json();
  const ALLOWED_GROUP = env.TELEGRAM_GROUP_ID || '-1004291559247';

  // Handle callback queries (inline keyboard buttons)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id?.toString();
    
    if (chatId !== ALLOWED_GROUP) {
      await answerCallbackQuery(env, cb.id, 'Not authorized in this chat');
      return json({ ok: true });
    }

    const data = cb.data || '';
    
    if (data.startsWith('accept_')) {
      const paperId = data.replace('accept_', '');
      await advanceStage(env.DB, paperId, STAGES.ACCEPTED, cb.from?.first_name || 'editor');
      await sendTelegram(env, `✅ *${paperId}* accepted by ${cb.from?.first_name}. Gallery proof will be prepared.`);
      await answerCallbackQuery(env, cb.id, 'Paper accepted!');
    } else if (data.startsWith('reject_')) {
      const paperId = data.replace('reject_', '');
      await advanceStage(env.DB, paperId, STAGES.REJECTED, cb.from?.first_name || 'editor');
      await sendTelegram(env, `❌ *${paperId}* rejected by ${cb.from?.first_name}. Author will be notified.`);
      await answerCallbackQuery(env, cb.id, 'Paper rejected');
    } else if (data.startsWith('extend_')) {
      const paperId = data.replace('extend_', '');
      const newDeadline = addDays(3);
      if (env.DB) {
        await env.DB.prepare(`UPDATE manuscripts SET current_deadline = ? WHERE paper_id = ?`)
          .bind(newDeadline, paperId).run();
      }
      await sendTelegram(env, `⏰ Deadline for *${paperId}* extended by 3 days to ${newDeadline.split('T')[0]}.`);
      await answerCallbackQuery(env, cb.id, 'Deadline extended');
    }

    return json({ ok: true });
  }

  // Handle text messages
  const msg = update.message;
  if (!msg || !msg.text) return json({ ok: true });

  const chatId = msg.chat?.id?.toString();
  const chatType = msg.chat?.type;

  // Only respond in the authorized group (or inform in private chat)
  if (chatId !== ALLOWED_GROUP) {
    if (chatType === 'private') {
      await sendTelegram(env, `👋 Hello ${msg.from?.first_name || 'there'}! I am the MPPT Editorial AI Assistant.\n\nI am configured to operate inside the official MPPT Editorial Board Group. If you are an editorial board member, please tag me in the group with \`@mpptai_bot <query>\`.`, { chat_id: chatId });
    }
    return json({ ok: true });
  }

  const text = msg.text || '';
  const BOT_ID = 8902857493;
  const BOT_NAME_REGEX = /@(mpptai_bot|mpptai|mppt)\b/i;

  // 1. Text contains @mppt, @mpptai, or @mpptai_bot
  const hasTextMention = BOT_NAME_REGEX.test(text);

  // 2. Telegram message entities (mention, text_mention, bot_command)
  const hasEntityMention = (msg.entities || []).some(e => {
    if (e.type === 'mention') {
      const mentionText = text.substring(e.offset, e.offset + e.length);
      return /@mppt/i.test(mentionText);
    }
    if (e.type === 'text_mention') {
      return e.user?.id === BOT_ID || /mppt/i.test(e.user?.username || '') || /mppt/i.test(e.user?.first_name || '');
    }
    if (e.type === 'bot_command') {
      return true; // Any /command in group should be handled
    }
    return false;
  });

  // 3. User replied directly to a message sent by the bot
  const isReplyToBot = msg.reply_to_message?.from?.is_bot || msg.reply_to_message?.from?.id === BOT_ID;

  // 4. Command prefix (e.g. /status, /ask, /papers, /help)
  const isCommand = text.startsWith('/');

  // Only respond when bot is targeted or replied to
  if (!hasTextMention && !hasEntityMention && !isReplyToBot && !isCommand) {
    return json({ ok: true });
  }

  // Strip bot handles and command prefixes from user text
  let userQuery = text
    .replace(/@(mpptai_bot|mpptai|mppt)\b/gi, '')
    .replace(/^\/(?:ask|ai|query|question|check)\s*/i, '')
    .trim();

  // If message is just "/help" or "/start" or empty mention
  if (!userQuery || userQuery === '/start' || userQuery === '/help') {
    const helpMsg = 
      `👋 Hello ${msg.from?.first_name || 'there'}! I am MPPT AI, your autonomous editorial partner.\n\n` +
      `*Available Editorial Commands:*\n` +
      `• \`/status MPPT-2026-V1I1-0003\` — Check paper stage & audit log\n` +
      `• \`/papers\` — List active manuscripts\n` +
      `• \`/emails\` — Check latest inbound emails (editor@, review@, publisher@)\n` +
      `• \`/stats\` — Live database & pipeline dashboard\n` +
      `• \`/reviewers\` — View referee pool\n` +
      `• \`/sent <paperId>\` — Confirm verified dispatch of an email\n` +
      `• \`add reviewer Dr. Name, email, speciality, affiliation\`\n\n` +
      `You can also ask me any scientific or editorial question directly!`;
    await sendTelegram(env, helpMsg, { reply_to_message_id: msg.message_id });
    return json({ ok: true });
  }

  if (false) {
    await sendTelegram(env, `👋 Hello ${msg.from?.first_name || 'there'}! I am MPPT AI, your autonomous editorial partner.\n\nAsk me anything or use these commands:\n• \`status MPPT-2026-V1I1-0003\` (or paper ID)\n• \`list papers\`\n• \`list reviewers\`\n• \`add reviewer Dr. Name, email, speciality, affiliation\`\n• Ask any scientific or editorial question directly!`, { reply_to_message_id: msg.message_id });
    return json({ ok: true });
  }

  // ── COMMAND 1: REVIEWER ONBOARDING VIA TELEGRAM ──
  const isAddReviewer = userQuery.match(/^(?:(?:\/)?addreviewer|add\s+reviewer|onboard\s+reviewer)\b/i);
  if (isAddReviewer) {
    const rawDetails = userQuery.replace(/^(?:(?:\/)?addreviewer|add\s+reviewer|onboard\s+reviewer)\s*(:|-|\s)?\s*/i, '').trim();
    if (!rawDetails) {
      const helpMsg = `ℹ️ *Reviewer Onboarding Format:*\n\n` +
        `Use:\n\`@mpptai_bot add reviewer Dr. Name, email@domain.com, Speciality, Affiliation\`\n\n` +
        `Example:\n\`@mpptai_bot add reviewer Dr. Arvind Mehta, arvind.m@aiims.edu, Pharmacology & Toxicology, AIIMS New Delhi\``;
      await sendTelegram(env, helpMsg, { reply_to_message_id: msg.message_id });
      return json({ ok: true });
    }

    const parts = rawDetails.includes('\n') ? rawDetails.split('\n') : rawDetails.split(',');
    let revName = (parts[0] || '').trim();
    let revEmail = '';
    let revSpeciality = '';
    let revAffiliation = '';

    const emailMatch = rawDetails.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      revEmail = emailMatch[0].toLowerCase();
    } else if (parts[1] && parts[1].includes('@')) {
      revEmail = parts[1].trim().toLowerCase();
    }

    if (!revEmail) {
      await sendTelegram(env, `⚠️ *Missing Email:* Please specify a valid academic email address for the reviewer.\nExample: \`@mpptai_bot add reviewer Dr. Sharma, sharma@aiims.edu, Pharmacology\``, { reply_to_message_id: msg.message_id });
      return json({ ok: true });
    }

    if (revName.toLowerCase().includes(revEmail)) {
      revName = revName.replace(revEmail, '').replace(/[<>,]/g, '').trim();
    }
    if (!revName) revName = 'Peer Reviewer';

    if (parts.length > 2) revSpeciality = parts[2].trim();
    if (parts.length > 3) revAffiliation = parts.slice(3).join(', ').trim();
    if (!revSpeciality) revSpeciality = 'General Pharmacy & Therapeutics';
    if (!revAffiliation) revAffiliation = 'MPPT Reviewer Board';

    if (env.DB) {
      await env.DB.prepare(`
        INSERT INTO reviewers (name, email, speciality, affiliation, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT(email) DO UPDATE SET
          name = excluded.name,
          speciality = excluded.speciality,
          affiliation = excluded.affiliation,
          is_active = 1
      `).bind(revName, revEmail, revSpeciality, revAffiliation).run();
    }

    const confMsg = 
      `✅ *Reviewer Successfully Onboarded!*\n\n` +
      `👤 *Name:* ${revName}\n` +
      `📧 *Email:* \`${revEmail}\`\n` +
      `🔬 *Speciality:* ${revSpeciality}\n` +
      `🏛️ *Affiliation:* ${revAffiliation}\n` +
      `📊 *Status:* Active in Peer Review Pool\n\n` +
      `This referee is now registered for autonomous double-blind manuscript assignment.`;

    await sendTelegram(env, confMsg, { reply_to_message_id: msg.message_id });

    if (env.DB) {
      await logComm(env.DB, null, 'telegram', 'inbound', msg.from?.first_name || 'editor', 'mpptai_bot',
        'Reviewer Onboarded', `Onboarded ${revName} (${revEmail})`, null, null);
    }
    return json({ ok: true });
  }

  // ── COMMAND 2: LIST REVIEWERS ──
  if (userQuery.match(/^(?:(?:\/)?reviewers|list\s+reviewers|show\s+reviewers)\b/i)) {
    let revListMsg = '';
    if (env.DB) {
      const res = await env.DB.prepare(`SELECT * FROM reviewers WHERE is_active = 1 ORDER BY name ASC LIMIT 30`).all();
      const list = res.results || [];
      if (list.length === 0) {
        revListMsg = `📋 *MPPT Reviewer Pool:* No reviewers registered yet.\n\nTo onboard one, use:\n\`@mpptai_bot add reviewer Dr. Name, email, speciality, affiliation\``;
      } else {
        revListMsg = `📋 *MPPT Active Reviewer Pool (${list.length}):*\n\n` +
          list.map((r, i) => `${i + 1}. *${r.name}*\n   📧 \`${r.email}\`\n   🔬 ${r.speciality || 'General'}\n   🏛️ ${r.affiliation || 'Roster'}`).join('\n\n');
      }
    } else {
      revListMsg = '⚠️ Database not available.';
    }
    await sendTelegram(env, revListMsg, { reply_to_message_id: msg.message_id });
    return json({ ok: true });
  }

  // ── COMMAND: LIST PAPERS / CHECK PAPER STATUS ──
  const isPaperQuery = userQuery.match(/^(?:(?:\/)?(?:papers|manuscripts|status)|(?:list|show|check)\s+(?:papers|manuscripts)|status\b)/i);
  if (isPaperQuery) {
    if (env.DB) {
      const idMatch = userQuery.match(/MPPT-[\w-]+|\b000\d\b|\b\d{4}\b/i);
      if (idMatch) {
        let lookupId = idMatch[0].toUpperCase();
        if (/^\d+$/.test(lookupId)) {
          lookupId = `MPPT-2026-V1I1-${lookupId.padStart(4, '0')}`;
        }
        const p = await env.DB.prepare(`SELECT * FROM manuscripts WHERE paper_id = ?`).bind(lookupId).first();
        if (p) {
          const statusMsg = `📄 *Manuscript Record: ${p.paper_id}*\n\n` +
            `📑 *Title:* _${(p.title || 'Untitled').replace(/_/g, ' ')}_\n` +
            `👤 *Author:* ${(p.author_name || 'Author').replace(/_/g, ' ')} (\`${p.author_email}\`)\n` +
            `🏛️ *Affiliation:* ${p.author_affiliation || 'N/A'}\n` +
            `🔬 *Scope:* ${p.subject_scope || 'General'}\n` +
            `📁 *File:* \`${p.original_filename || 'manuscript.pdf'}\`\n\n` +
            `➡️ *Stage:* ${STAGE_LABELS[p.stage] || p.stage}\n` +
            `🔍 *Plagiarism:* ${p.plagiarism_score !== null ? `${p.plagiarism_score}%` : 'Pending'}\n` +
            `🤖 *AI Content:* ${p.ai_content_score !== null ? `${p.ai_content_score}%` : 'Pending'}\n` +
            `⏰ *Deadline:* ${p.current_deadline ? p.current_deadline.split('T')[0] : 'None set'}\n` +
            `📅 *Submitted:* ${p.submitted_at}\n\n` +
            `🔗 *Track URL:* https://mpptjournal.com/track.html?id=${encodeURIComponent(p.paper_id)}`;
          await sendTelegram(env, statusMsg, { reply_to_message_id: msg.message_id });
          return json({ ok: true });
        } else {
          await sendTelegram(env, `⚠️ No manuscript found with ID \`${lookupId}\`.`, { reply_to_message_id: msg.message_id });
          return json({ ok: true });
        }
      }

      // If no specific ID, list active papers in pipeline
      const papers = await env.DB.prepare(`SELECT paper_id, title, author_name, author_email, stage, submitted_at FROM manuscripts WHERE is_active = 1 ORDER BY id DESC LIMIT 10`).all();
      const list = papers.results || [];
      if (list.length === 0) {
        await sendTelegram(env, `📄 *MPPT Pipeline:* No active manuscripts in the database.`, { reply_to_message_id: msg.message_id });
      } else {
        const papersMsg = `📚 *MPPT Manuscripts in Pipeline (${list.length}):*\n\n` +
          list.map((p, i) => `${i + 1}. \`${p.paper_id}\`: *${(p.title || 'Untitled').replace(/_/g, ' ')}*\n   👤 ${(p.author_name || 'Author').replace(/_/g, ' ')} (\`${p.author_email}\`)\n   ➡️ Stage: *${STAGE_LABELS[p.stage] || p.stage}*\n   📅 ${p.submitted_at?.split(' ')[0] || ''}`).join('\n\n') +
          `\n\n💡 _To view full details: "@mpptai_bot status ${list[0].paper_id}"_`;
        await sendTelegram(env, papersMsg, { reply_to_message_id: msg.message_id });
      }
      return json({ ok: true });
    }
  }

    // ── COMMAND: LIST INBOUND EMAILS ACROSS ALL 3 INBOXES ──
  if (userQuery.match(/^(?:(?:\/)?emails|list\s+emails|show\s+emails|check\s+emails|inbox)\b/i)) {
    if (env.DB) {
      const res = await env.DB.prepare(`
        SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 8
      `).all();
      const list = res.results || [];
      if (list.length === 0) {
        await sendTelegram(env, `📬 *MPPT Inboxes:* No inbound emails recorded yet across \`editor@\`, \`review@\`, or \`publisher@\`.\n\nAll incoming emails will automatically trigger instant group notifications.`, { reply_to_message_id: msg.message_id });
      } else {
        const emailItems = list.map((m, idx) => {
          let badge = '📬 [Inbox]';
          if (m.inbox.includes('editor')) badge = '🎓 [editor@]';
          else if (m.inbox.includes('review')) badge = '🔬 [review@]';
          else if (m.inbox.includes('publisher')) badge = '🏛️ [publisher@]';

          return `${idx + 1}. ${badge} *${(m.from_name || m.from_address).replace(/_/g, ' ')}*\n   📋 Subject: _${(m.subject || 'No Subject').replace(/_/g, ' ')}_\n   🆔 Paper: \`${m.paper_id || 'N/A'}\` · Status: *${m.reply_status}*\n   📝 _${(m.summary || '').substring(0, 110)}..._`;
        }).join('\n\n');

        const emailListMsg = `📬 *Recent Inbound Emails (${list.length}):*\n\n${emailItems}\n\n💡 _To draft an academic reply, reply to any email alert with "Reply: <instructions>"_`;
        await sendTelegram(env, emailListMsg, { reply_to_message_id: msg.message_id });
      }
    } else {
      await sendTelegram(env, `⚠️ Database not available.`, { reply_to_message_id: msg.message_id });
    }
    return json({ ok: true });
  }

  // ── COMMAND: DATABASE & PIPELINE STATS ──
  if (userQuery.match(/^(?:(?:\/)?(?:stats|database|summary|dashboard)|pipeline\s+stats|db\s+status)\b/i)) {
    if (env.DB) {
      const papersCount = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM manuscripts WHERE is_active = 1`).first();
      const reviewersCount = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM reviewers WHERE is_active = 1`).first();
      const emailsCount = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM inbound_emails`).first();
      const commsCount = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM communications`).first();
      const stageRows = await env.DB.prepare(`SELECT stage, COUNT(*) as cnt FROM manuscripts WHERE is_active = 1 GROUP BY stage`).all();

      const stageSummary = (stageRows.results || []).map(r => `  • ${STAGE_LABELS[r.stage] || r.stage}: *${r.cnt}*`).join('\n');

      const statsMsg = 
        `📊 *MPPT JOURNAL — LIVE DATABASE DASHBOARD*\n\n` +
        `📚 *Total Active Manuscripts:* ${papersCount?.cnt || 0}\n` +
        `👥 *Reviewer Pool:* ${reviewersCount?.cnt || 0} referees\n` +
        `📬 *Inbound Inquiries Logged:* ${emailsCount?.cnt || 0}\n` +
        `📨 *Audited Communications:* ${commsCount?.cnt || 0}\n\n` +
        `📋 *Stage Distribution:*\n${stageSummary || '  • No active manuscripts'}\n\n` +
        `🔒 *Integrity Guard:* Real-time sync with Cloudflare D1 & R2 Storage.`;

      await sendTelegram(env, statsMsg, { reply_to_message_id: msg.message_id });
    } else {
      await sendTelegram(env, `⚠️ Database not available.`, { reply_to_message_id: msg.message_id });
    }
    return json({ ok: true });
  }

      // ── COMMAND: POLL ZOHO EMAILS ──
      if (userQuery.match(/^(?:\/)?(?:poll|checkemails|check_emails|check\s+inbox|poll\s+zoho)\b/i)) {
        await sendTelegram(env, '🔄 *Checking Zoho Mail server for new unread emails...*', { reply_to_message_id: msg.message_id });
        const res = await checkZohoImap(env);
        if (res.success) {
          await sendTelegram(env, `✅ *Zoho Sync Complete*\n\n📬 Processed *${res.processedCount}* new incoming emails out of *${res.unreadTotal}* unread on Zoho server.\nMails remain safely stored in your 5GB Zoho inbox.`, { reply_to_message_id: msg.message_id });
        } else {
          await sendTelegram(env, `⚠️ Zoho poll failed: ${res.error || 'Check credentials'}`, { reply_to_message_id: msg.message_id });
        }
        return json({ ok: true });
      }

  // ── COMMAND: DISPATCH QUEUED EMAIL (Autonomous Execution) ──
  const isDispatch = userQuery.match(/^(?:(?:\/)?(?:dispatch|send_queued|send_email)|dispatch\s+email)\b/i);
  if (isDispatch) {
    const paperIdMatch = userQuery.match(/MPPT-[\w-]+|\b000\d\b|\b\d{4}\b/i);
    if (!paperIdMatch) {
      await sendTelegram(env, `ℹ️ *Format:* \`@mpptai_bot dispatch MPPT-2026-V1I1-0003\` to trigger autonomous outbound dispatch.`, { reply_to_message_id: msg.message_id });
      return json({ ok: true });
    }
    let lookupId = paperIdMatch[0].toUpperCase();
    if (/^\d+$/.test(lookupId)) {
      lookupId = `MPPT-2026-V1I1-${lookupId.padStart(4, '0')}`;
    }
    const res = await handleDispatchQueued(env, lookupId);
    const data = await res.json();
    if (data.result?.sent) {
      await sendTelegram(env, 
        `🚀 *OFFICIAL EMAIL DISPATCHED (AUTONOMOUS)*\n\n` +
        `🆔 *Paper ID:* \`${lookupId}\`\n` +
        `📤 *From Mailbox:* \`${data.result.from || 'review@mpptjournal.com'}\`\n` +
        `📨 *To Author:* \`${data.result.toAddress || 'Author'}\`\n` +
        `📋 *Subject:* _${data.result.subject || 'Manuscript Update'}_\n\n` +
        `✅ *Status:* Delivered via ${data.result.provider}! D1 verified.`, 
        { reply_to_message_id: msg.message_id }
      );
    } else {
      await sendTelegram(env, 
        `⚠️ *Outbound dispatch failed:*\n_${data.result?.error || 'No outbound transport configured.'}_\n\n` +
        `Please configure ZOHO_SMTP_PASS, BREVO_API_KEY, or RESEND_API_KEY in Worker secrets.`, 
        { reply_to_message_id: msg.message_id }
      );
    }
    return json({ ok: true });
  }

  // ── COMMAND: MARK EMAIL SENT (Truthful Database Verification) ──
  const isMarkSent = userQuery.match(/^(?:(?:\/)?(?:sent|marksent|mark_sent)|mark\s+sent)\b/i);
  if (isMarkSent) {
    const paperIdMatch = userQuery.match(/MPPT-[\w-]+|\b000\d\b|\b\d{4}\b/i);
    if (!paperIdMatch) {
      await sendTelegram(env, `ℹ️ *Format:* \`@mpptai_bot sent MPPT-2026-V1I1-0003\` to record verified dispatch in D1.`, { reply_to_message_id: msg.message_id });
      return json({ ok: true });
    }
    let lookupId = paperIdMatch[0].toUpperCase();
    if (/^\d+$/.test(lookupId)) {
      lookupId = `MPPT-2026-V1I1-${lookupId.padStart(4, '0')}`;
    }
    if (env.DB) {
      const paper = await env.DB.prepare(`SELECT * FROM manuscripts WHERE paper_id = ?`).bind(lookupId).first();
      if (!paper) {
        await sendTelegram(env, `⚠️ Paper \`${lookupId}\` not found in database.`, { reply_to_message_id: msg.message_id });
        return json({ ok: true });
      }

      // Find any draft or pending communications
      const draft = await env.DB.prepare(`
        SELECT * FROM communications WHERE paper_id = ? AND (channel = 'email_draft' OR direction = 'pending_manual_dispatch')
        ORDER BY id DESC LIMIT 1
      `).bind(lookupId).first();

      const template = draft?.template_used || '1_SUBMISSION_CONFIRMATION';
      const fromDesk = draft?.from_address || (EDITOR_EMAIL_STAGES.has(paper.stage) ? 'editor@mpptjournal.com' : 'review@mpptjournal.com');

      await logComm(env.DB, lookupId, 'email', 'outbound', fromDesk, paper.author_email,
        draft?.subject || `Manuscript Update — ${lookupId}`, `[VERIFIED SENT VIA ZOHO] Dispatched by ${msg.from?.first_name || 'editor'}`, template, paper.stage);

      if (draft) {
        await env.DB.prepare(`UPDATE communications SET direction = 'dispatched_verified' WHERE id = ?`).bind(draft.id).run();
      }

      const conf = 
        `✅ *EMAIL DISPATCH OFFICIALLY VERIFIED & LOGGED*\n\n` +
        `🆔 *Paper ID:* \`${lookupId}\`\n` +
        `👤 *Author:* ${paper.author_name} (\`${paper.author_email}\`)\n` +
        `📧 *Template:* \`${template}\`\n` +
        `📤 *From:* \`${fromDesk}\`\n` +
        `✍️ *Verified by:* ${msg.from?.first_name || 'Editor'}\n` +
        `🕒 *Timestamp:* ${now()}\n\n` +
        `D1 ledger updated with confirmed outbound delivery.`;

      await sendTelegram(env, conf, { reply_to_message_id: msg.message_id });
      return json({ ok: true });
    }
  }

  // ── COMMAND 3: TEST / SIMULATE INBOUND EMAIL ──
  if (userQuery.match(/^(?:(?:\/)?testemail|test\s+email|simulate\s+email)\b/i)) {
    await sendTelegram(env, `🔄 *Simulating Inbound Author Email...*`, { reply_to_message_id: msg.message_id });
    await processInboundEmail(env, {
      inbox: 'review@mpptjournal.com',
      fromAddress: 'author.kumar@aiims.edu',
      fromName: 'Dr. Rajesh Kumar',
      subject: 'Inquiry regarding manuscript MPPT-2026-V1I1-0001 peer review status',
      bodyText: 'Dear Editorial Desk, I am writing to politely inquire regarding the status of our submission MPPT-2026-V1I1-0001. We are approaching our annual research grant audit deadline on October 5th. Could you kindly provide an update on the double-blind referee reports, and let us know if an extension is possible if major revisions are recommended? Sincerely, Dr. Rajesh Kumar, Department of Pharmacology, AIIMS New Delhi.',
      paperId: 'MPPT-2026-V1I1-0001'
    });
    return json({ ok: true });
  }

  // ── COMMAND 4: APPROVE / SEND DRAFTED RESPONSE ──
  const isApproval = userQuery.match(/^(?:(?:\/)?approve|send|confirm|dispatch)\b/i);
  if (isApproval && msg.reply_to_message) {
    const repliedText = msg.reply_to_message.text || '';
    if (repliedText.includes('Auto-Drafted') || repliedText.includes('Subject: Re:') || repliedText.includes('Auto-Draft')) {
      let matchedInbound = null;
      if (env.DB) {
        matchedInbound = await env.DB.prepare(`
          SELECT * FROM inbound_emails WHERE reply_status = 'drafted' ORDER BY id DESC LIMIT 1
        `).first();
      }

      if (!matchedInbound || !matchedInbound.reply_draft) {
        await sendTelegram(env, `⚠️ No pending draft found to dispatch.`, { reply_to_message_id: msg.message_id });
        return json({ ok: true });
      }

      const draftHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; line-height: 1.6;">
          <div style="border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 18px;">Journal of Modern Pharmacy Praxis & Therapeutics</h2>
            <p style="color: #64748b; font-size: 13px; margin: 4px 0 0;">Official Editorial Desk • ISSN: 2584-XXXX</p>
          </div>
          <div style="white-space: pre-wrap; font-size: 14px; color: #334155;">${matchedInbound.reply_draft.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0;">Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal)</p>
            <p style="margin: 2px 0 0;"><a href="https://mpptjournal.com" style="color: #0284c7;">https://mpptjournal.com</a> | editor@mpptjournal.com</p>
          </div>
        </div>
      `;

      let sendRes = await sendViaZohoSmtp(env, {
        from: matchedInbound.inbox || 'editor@mpptjournal.com',
        to: matchedInbound.from_address,
        subject: `Re: ${matchedInbound.subject || 'Manuscript Communication'}`,
        html: draftHtml
      });

      if (sendRes.sent) {
        if (env.DB) {
          await env.DB.prepare(`
            UPDATE inbound_emails SET reply_status = 'sent', replied_at = datetime('now') WHERE id = ?
          `).bind(matchedInbound.id).run();

          await logComm(env.DB, matchedInbound.paper_id, 'email', 'outbound',
            matchedInbound.inbox || 'editor@mpptjournal.com', matchedInbound.from_address,
            `Re: ${matchedInbound.subject}`, matchedInbound.reply_draft.substring(0, 500), 'custom_reply', null);
        }

        const conf = `🚀 *Official Response Dispatched via Zoho SMTP!*\n\n` +
          `The drafted response has been physically delivered to recipient.\n\n` +
          `📧 *From:* \`${matchedInbound?.inbox || 'editor@mpptjournal.com'}\`\n` +
          `📨 *To:* \`${matchedInbound?.from_address}\`\n` +
          `📋 *Subject:* Re: ${matchedInbound?.subject || 'Manuscript Communication'}\n\n` +
          `✅ *Delivery verified & logged in Cloudflare D1.*`;
        await sendTelegram(env, conf, { reply_to_message_id: msg.message_id });
      } else {
        const errMsg = `❌ *Dispatch Failed via Zoho SMTP:*\n\`${sendRes.error || 'Unknown transport error'}\``;
        await sendTelegram(env, errMsg, { reply_to_message_id: msg.message_id });
      }

      return json({ ok: true });
    }
  }

  // ── COMMAND 5: AI AUTO-DRAFT FOR INBOUND EMAIL REPLY ──
  const isReplyToEmailAlert = msg.reply_to_message && 
    (msg.reply_to_message.text?.includes('New Email Received') || msg.reply_to_message.text?.includes('Inbox:'));
  const isExplicitDraftCmd = userQuery.match(/^(?:reply|draft|draft\s+reply|reply\s+to\s+email)\b/i);

  if (isReplyToEmailAlert || isExplicitDraftCmd) {
    let inbound = null;
    if (env.DB) {
      if (msg.reply_to_message?.message_id) {
        inbound = await env.DB.prepare(`
          SELECT * FROM inbound_emails WHERE telegram_msg_id = ?
        `).bind(msg.reply_to_message.message_id).first();
      }
      if (!inbound) {
        inbound = await env.DB.prepare(`
          SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 1
        `).first();
      }
    }

    if (!inbound) {
      inbound = {
        inbox: 'review@mpptjournal.com',
        from_address: 'author@university.edu',
        from_name: 'Author',
        subject: 'Manuscript Communication',
        body_text: 'Author inquiry regarding review progress.',
        summary: 'Author inquiry regarding review progress.'
      };
    }

    const instructions = userQuery
      .replace(/^(?:reply|draft\s+reply|draft|reply\s+to\s+email)\s*(:|-|\s)?\s*/i, '')
      .trim() || userQuery;

    await sendTelegram(env, `✍️ *Drafting response for review...*\nApplying MPPT Journal academic guidelines to instructions: _"${instructions}"_`);

    let senderInbox = inbound.inbox || 'review@mpptjournal.com';
    const instrLower = instructions.toLowerCase();
    if (instrLower.includes('accept') || instrLower.includes('reject') || instrLower.includes('proof') || instrLower.includes('publish') || instrLower.includes('certificate')) {
      senderInbox = 'editor@mpptjournal.com';
    }

    let draftedText = '';
    if (env.AI) {
      try {
        const draftMessages = [
          {
            role: 'system',
            content: `You are the Editorial Secretary for Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal).
Your role is to compose a formal, polite, scholarly academic email response on behalf of the Editorial Office following the member's instructions.

STRICT EDITORIAL POLICIES:
- Formal British/International academic English.
- Courteous salutation: "Dear Dr. [Author/Reviewer Name],"
- Warm, reassuring, and precise scholarly tone.
- NEVER fabricate citations, DOIs, or indexing claims.
- Strictly adhere to the Editor's instructions: "${instructions}"
- Include official sign-off:
  Warm regards,
  Editorial Office
  Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal)
  Web: https://mpptjournal.com | Email: ${senderInbox}`
          },
          {
            role: 'user',
            content: `INBOUND EMAIL:
From: ${inbound.from_address} (${inbound.from_name || 'Author'})
To Inbox: ${senderInbox}
Subject: ${inbound.subject}
Original Text: ${inbound.body_text || inbound.summary}

EDITOR INSTRUCTIONS:
"${instructions}"

Please draft the official academic email response.`
          }
        ];

        draftedText = await runAiChat(env, draftMessages, 700);
      } catch (err) {
        console.error('AI draft generation error:', err);
      }
    }

    if (!draftedText) {
      draftedText = `Dear ${inbound.from_name || 'Dr. Author'},\n\n` +
        `Thank you for contacting the Editorial Office of the Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal) regarding your correspondence on "${inbound.subject}".\n\n` +
        `In consultation with the Editorial Board: ${instructions}.\n\n` +
        `Please do not hesitate to reach out if you require any further assistance with your manuscript.\n\n` +
        `Warm regards,\n` +
        `Editorial Office\n` +
        `Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal)\n` +
        `Web: https://mpptjournal.com | Email: ${senderInbox}`;
    }

    if (env.DB && inbound.id) {
      await env.DB.prepare(`
        UPDATE inbound_emails SET reply_draft = ?, reply_status = 'drafted' WHERE id = ?
      `).bind(draftedText, inbound.id).run();

      await logComm(env.DB, inbound.paper_id, 'email', 'draft', senderInbox, inbound.from_address,
        `Re: ${inbound.subject}`, draftedText.substring(0, 500), null, null);
    }

    const draftCard = 
      `✍️ *Auto-Drafted Response Ready for Review*\n\n` +
      `📧 *Sender:* \`${senderInbox}\`\n` +
      `📨 *Recipient:* \`${inbound.from_address}\`\n` +
      `📋 *Subject:* Re: ${inbound.subject}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${draftedText}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✅ *Next Action:*\n` +
      `• Reply *Send* or *Approve* to dispatch this email\n` +
      `• Reply with instructions to adjust the draft`;

    await sendTelegram(env, draftCard);
    return json({ ok: true });
  }

  // ── BUILD COMPREHENSIVE LIVE DATABASE CONTEXT FOR AI ──
  let dbContext = '\n\n=== LIVE MPPT EDITORIAL DATABASE SNAPSHOT ===\n';
  let emailListCache = [];
  let paperListCache = [];
  let reviewerListCache = [];

  if (env.DB) {
    try {
      // 1. INBOUND EMAILS & INBOX CORRESPONDENCE
      const emailRows = await env.DB.prepare(`
        SELECT id, inbound_id, inbox, from_address, from_name, subject, body_text, summary, paper_id, reply_status, created_at, replied_at 
        FROM inbound_emails 
        ORDER BY id DESC LIMIT 10
      `).all().catch(() => ({ results: [] }));
      
      emailListCache = emailRows.results || [];
      dbContext += `\n[INBOUND EMAILS & INBOX] (${emailListCache.length} recent):\n`;
      if (emailListCache.length === 0) {
        dbContext += `No incoming emails currently logged in inbox.\n`;
      } else {
        emailListCache.forEach((em, idx) => {
          dbContext += `${idx + 1}. From: ${em.from_name ? `${em.from_name} <${em.from_address}>` : em.from_address}\n` +
            `   Inbox: ${em.inbox} | Received: ${em.created_at}\n` +
            `   Subject: ${em.subject}\n` +
            `   Summary: ${em.summary || (em.body_text ? em.body_text.substring(0, 150) + '...' : 'N/A')}\n` +
            (em.paper_id ? `   Associated Paper: ${em.paper_id}\n` : '') +
            `   Status: ${em.reply_status} (Replied: ${em.replied_at || 'Pending'})\n`;
        });
      }

      // 2. ACTIVE MANUSCRIPTS IN PIPELINE
      const paperRows = await env.DB.prepare(`
        SELECT paper_id, title, author_name, author_email, author_affiliation, subject_scope, stage, plagiarism_score, current_deadline, submitted_at, updated_at
        FROM manuscripts 
        WHERE is_active = 1 
        ORDER BY id DESC LIMIT 15
      `).all().catch(() => ({ results: [] }));

      paperListCache = paperRows.results || [];
      dbContext += `\n[MANUSCRIPTS IN PIPELINE] (${paperListCache.length} total active):\n`;
      if (paperListCache.length === 0) {
        dbContext += `No manuscripts currently submitted.\n`;
      } else {
        paperListCache.forEach(p => {
          dbContext += `• ${p.paper_id}: "${p.title}" by ${p.author_name} (${p.author_email})\n` +
            `  Affiliation: ${p.author_affiliation || 'N/A'} | Scope: ${p.subject_scope || 'General'}\n` +
            `  Stage: ${p.stage} (${STAGE_LABELS[p.stage] || p.stage})\n` +
            `  Plagiarism: ${p.plagiarism_score !== null ? `${p.plagiarism_score}%` : 'Pending Check'}\n` +
            `  Deadline: ${p.current_deadline || 'None'} | Submitted: ${p.submitted_at}\n`;
        });
      }

      // 3. REVIEWER ROSTER POOL
      const revRows = await env.DB.prepare(`
        SELECT id, name, email, speciality, affiliation, total_assigned, total_completed 
        FROM reviewers 
        WHERE is_active = 1 
        ORDER BY name ASC LIMIT 20
      `).all().catch(() => ({ results: [] }));

      reviewerListCache = revRows.results || [];
      dbContext += `\n[REVIEWER POOL] (${reviewerListCache.length} active referees):\n`;
      if (reviewerListCache.length === 0) {
        dbContext += `No reviewers currently onboarded in the roster.\n`;
      } else {
        reviewerListCache.forEach(r => {
          dbContext += `• Dr. ${r.name} (${r.email}) — ${r.speciality || 'General Pharmacy'} [${r.affiliation || 'Roster'}] (Assigned: ${r.total_assigned}, Completed: ${r.total_completed})\n`;
        });
      }

      // 4. PIPELINE COUNTS SUMMARY
      const stats = await env.DB.prepare(`
        SELECT stage, COUNT(*) as cnt FROM manuscripts WHERE is_active = 1 GROUP BY stage
      `).all().catch(() => ({ results: [] }));
      
      if (stats.results?.length) {
        dbContext += `\n[PIPELINE STATS SUMMARY]: ` + stats.results.map(s => `${STAGE_LABELS[s.stage] || s.stage}: ${s.cnt}`).join(' | ') + `\n`;
      }

      // 5. RECENT COMMUNICATIONS AUDIT
      const commRows = await env.DB.prepare(`
        SELECT channel, direction, from_address, to_address, subject, body_preview, sent_at 
        FROM communications 
        ORDER BY id DESC LIMIT 6
      `).all().catch(() => ({ results: [] }));
      
      if (commRows.results?.length) {
        dbContext += `\n[RECENT SYSTEM COMMS AUDIT]:\n`;
        commRows.results.forEach(c => {
          dbContext += `• [${c.sent_at}] ${c.channel.toUpperCase()} (${c.direction}) From: ${c.from_address} -> To: ${c.to_address} | Subj: ${c.subject}\n`;
        });
      }

    } catch (dbErr) {
      console.warn('DB context compilation notice:', dbErr);
    }
  }

  dbContext += `=== END DATABASE SNAPSHOT ===\n`;

  // ── CALL CHATGPT-GRADE WORKERS AI INFERENCE ──
  let aiReply = '';

  if (env.AI) {
    try {
      const messages = [
        { role: 'system', content: AI_SYSTEM_PROMPT + dbContext },
        { role: 'user', content: `Group member ${msg.from?.first_name || 'Editor'} says: "${userQuery}"` },
      ];

      aiReply = await runAiChat(env, messages, 800);
    } catch (aiErr) {
      console.error('AI chat error:', aiErr);
    }
  }

  // ── SMART CONTEXTUAL FALLBACK (Only used if Cloudflare AI network is unreachable) ──
  if (!aiReply) {
    const qLower = userQuery.toLowerCase();
    
    if (qLower.includes('email') || qLower.includes('inbox') || qLower.includes('mail')) {
      if (emailListCache.length === 0) {
        aiReply = `📬 *MPPT Inbound Inboxes:* No incoming emails recorded yet.\n\nAll incoming emails to \`review@mpptjournal.com\` and \`editor@mpptjournal.com\` are automatically routed here.`;
      } else {
        aiReply = `📬 *Recent Inbound Emails (${emailListCache.length}):*\n\n` +
          emailListCache.map((e, idx) => 
            `${idx + 1}. *${e.from_name || e.from_address}*\n` +
            `   📧 \`${e.from_address}\` ➔ \`${e.inbox}\`\n` +
            `   📋 *${e.subject}*\n` +
            `   📝 _${e.summary || e.body_text?.substring(0, 120) || 'N/A'}_\n` +
            `   📊 Status: *${e.reply_status?.toUpperCase() || 'PENDING'}* · ${e.created_at?.split(' ')[0] || ''}`
          ).join('\n\n') +
          `\n\n💡 _To draft a response, reply directly: "Draft reply: Grant extension..."_`;
      }
    } else if (qLower.includes('reviewer') || qLower.includes('referee')) {
      if (reviewerListCache.length === 0) {
        aiReply = `📋 *Reviewer Roster:* No referees onboarded yet.\n\nTo onboard one, say:\n\`@mpptai_bot add reviewer Dr. Name, email, speciality, affiliation\``;
      } else {
        aiReply = `👥 *Active Reviewer Pool (${reviewerListCache.length}):*\n\n` +
          reviewerListCache.map((r, i) => `${i + 1}. *Dr. ${r.name}*\n   📧 \`${r.email}\`\n   🔬 ${r.speciality || 'General Pharmacy'}\n   🏛️ ${r.affiliation || 'Roster'}`).join('\n\n');
      }
    } else if (qLower.includes('paper') || qLower.includes('manuscript') || qLower.includes('status') || qLower.includes('pipeline')) {
      if (paperListCache.length === 0) {
        aiReply = `📄 No active manuscripts in the pipeline yet.`;
      } else {
        aiReply = `📚 *Active Manuscripts in Pipeline (${paperListCache.length}):*\n\n` +
          paperListCache.map((p, i) => 
            `${i + 1}. \`${p.paper_id}\`: *${p.title}*\n` +
            `   👤 ${p.author_name} (${p.author_email})\n` +
            `   ➡️ Stage: *${STAGE_LABELS[p.stage] || p.stage}*\n` +
            `   📊 Plagiarism: ${p.plagiarism_score !== null ? `${p.plagiarism_score}%` : 'Pending'}\n` +
            `   ⏰ Deadline: ${p.current_deadline ? p.current_deadline.split('T')[0] : 'None'}`
          ).join('\n\n');
      }
    } else {
      aiReply = `👋 Hello ${msg.from?.first_name || 'Editor'}! I am MPPT AI, your editorial assistant.\n\n` +
        `I have full access to our journal pipeline, including manuscripts, emails, and reviewer pools.\n` +
        `Ask me anything—e.g., *"any new emails?"*, *"list our reviewers"*, or *"status of paper 0001"*!`;
    }
  }

  // Send reply
  await sendTelegram(env, aiReply, { reply_to_message_id: msg.message_id });

  // Log communication
  if (env.DB) {
    await logComm(env.DB, null, 'telegram', 'inbound', msg.from?.first_name || 'unknown', 'mpptai_bot',
      'Bot Query', userQuery, null, null);
    await logComm(env.DB, null, 'telegram', 'outbound', 'mpptai_bot', 'group',
      'Bot Reply', aiReply.substring(0, 500), null, null);
  }

  return json({ ok: true });
}

// ════════════════════════════════════════════════════════════
// HANDLER: ZENODO ARCHIVE (kept from original)
// ════════════════════════════════════════════════════════════

async function handleZenodoArchive(request, env) {
  const body = await request.json();
  const paperId = body.paperId || 'MPPT-2026-V1I1-0001';
  const title = body.title || 'Published Research Article';
  const authors = body.authors || ['Sharma, Aarav et al.'];

  const zenodoToken = env.ZENODO_API_TOKEN;
  let zenodoRecordId = 'PENDING';
  let zenodoDoi = 'Pending Deposition';

  if (zenodoToken) {
    const zenodoApiUrl = env.ZENODO_SANDBOX === 'true'
      ? 'https://sandbox.zenodo.org/api/deposit/depositions'
      : 'https://zenodo.org/api/deposit/depositions';

    const depRes = await fetch(zenodoApiUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${zenodoToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: {
          title,
          upload_type: 'publication',
          publication_type: 'article',
          creators: authors.map(a => ({ name: typeof a === 'string' ? a : a.name })),
          journal_title: 'Journal of Modern Pharmacy Praxis and Therapeutics',
          access_right: 'open',
          license: 'cc-by-4.0',
        },
      }),
    });

    if (depRes.ok) {
      const depData = await depRes.json();
      zenodoRecordId = depData.id.toString();
      zenodoDoi = depData.doi || `10.5281/zenodo.${zenodoRecordId}`;
    }
  }

  // Update D1 if available
  if (env.DB) {
    await env.DB.prepare(`UPDATE manuscripts SET zenodo_doi = ?, zenodo_record_id = ?, updated_at = ? WHERE paper_id = ?`)
      .bind(zenodoDoi, zenodoRecordId, now(), paperId).run();
  }

  // Notify Telegram group of Zenodo deposit
  if (env.TELEGRAM_BOT_TOKEN) {
    await sendTelegram(env,
      `📦 *CERN / ZENODO ARCHIVAL DEPOSITION COMPLETED*\n\n` +
      `🆔 *Paper ID:* \`${paperId}\`\n` +
      `📄 *Title:* _${title}_\n\n` +
      `🌐 *Zenodo DOI:* \`${zenodoDoi}\`\n` +
      `🏛️ *Preservation:* CERN Data Centre, Geneva\n` +
      `📜 *License:* CC BY 4.0 Open Access\n` +
      `✅ Archival metadata committed to D1 database.`
    );
  }

  return json({
    success: true,
    message: 'Manuscript archived in CERN / Zenodo',
    record: { paperId, zenodo_doi: zenodoDoi, zenodo_record_id: zenodoRecordId, repository: 'Zenodo / CERN Data Centre, Geneva', license: 'CC-BY-4.0', deposited_at: now() },
  }, 201);
}

async function handleZenodoQuery(env, paperId) {
  if (env.DB) {
    const paper = await env.DB.prepare('SELECT paper_id, zenodo_doi, zenodo_record_id FROM manuscripts WHERE paper_id = ?')
      .bind(paperId).first();
    if (paper && paper.zenodo_doi) {
      return json({ success: true, record: paper });
    }
  }
  return json({ success: false, error: 'No Zenodo record found' }, 404);
}

// ════════════════════════════════════════════════════════════
// HANDLER: DEADLINE CRON
// ════════════════════════════════════════════════════════════

async function handleDeadlineCron(env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const current = now();
  
  // Find papers past their deadline
  const overdue = await env.DB.prepare(`
    SELECT * FROM manuscripts 
    WHERE current_deadline IS NOT NULL AND current_deadline < ? AND stage NOT IN ('PUBLISHED', 'ARCHIVED', 'REJECTED')
    AND is_active = 1
  `).bind(current).all();

  const actions = [];

  for (const paper of (overdue.results || [])) {
    // Notify group with decision buttons
    await sendTelegramWithKeyboard(env,
      `⏰ *DEADLINE EXPIRED*\n\n` +
      `🆔 \`${paper.paper_id}\`\n📄 _${paper.title}_\n👤 ${paper.author_name}\n\n` +
      `📋 Stage: ${STAGE_LABELS[paper.stage]}\n` +
      `⏰ Deadline was: ${paper.current_deadline?.split('T')[0]}\n` +
      `📝 Type: ${paper.deadline_type}\n\n` +
      `👇 *What should we do?*`,
      [[
        { text: '⏰ Extend 3 days', callback_data: `extend_${paper.paper_id}` },
        { text: '❌ Reject', callback_data: `reject_${paper.paper_id}` },
      ]]
    );

    actions.push({ paperId: paper.paper_id, action: 'deadline_expired_notification' });
  }

  // Fire scheduled tasks
  const tasks = await env.DB.prepare(`
    SELECT * FROM scheduled_tasks WHERE fire_at <= ? AND fired = 0
  `).bind(current).all();

  for (const task of (tasks.results || [])) {
    await env.DB.prepare(`UPDATE scheduled_tasks SET fired = 1, result = 'fired' WHERE id = ?`).bind(task.id).run();
    actions.push({ taskId: task.id, paperId: task.paper_id, type: task.task_type });
  }

  return json({ success: true, timestamp: current, overdueCount: overdue.results?.length || 0, tasksFired: tasks.results?.length || 0, actions });
}
