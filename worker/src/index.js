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
const AI_SYSTEM_PROMPT = `You are MPPT AI, the Editorial Intelligence Assistant for Journal of Modern Pharmacy Praxis & Therapeutics (MPPT Journal).
You assist editors in the Telegram group with paper status queries, workflow decisions, reviewer management, and deadline tracking.

RULES:
- NEVER reveal API keys, tokens, passwords, or internal credentials
- NEVER modify or rewrite any author's scientific text
- NEVER fabricate DOIs, citations, or indexing claims
- For destructive actions (reject, reassign), always ask for confirmation
- Be concise, professional, and helpful
- Reference papers by their tracking ID (e.g., MPPT-2026-V1I1-0001)
- Include relevant stage info and deadlines in responses
- Use markdown formatting for Telegram (bold, italic)`;

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
// PAPER ID GENERATOR
// ════════════════════════════════════════════════════════════

async function generatePaperId(db, volume, issue) {
  const key = `paper_seq_V${volume}I${issue}`;
  
  // Ensure counter row exists
  await db.prepare(`INSERT OR IGNORE INTO counters (counter_key, counter_value) VALUES (?, 0)`)
    .bind(key).run();
  
  // Atomic increment
  await db.prepare(`UPDATE counters SET counter_value = counter_value + 1 WHERE counter_key = ?`)
    .bind(key).run();
  
  const row = await db.prepare(`SELECT counter_value FROM counters WHERE counter_key = ?`)
    .bind(key).first();
  
  const seq = String(row.counter_value).padStart(4, '0');
  const year = new Date().getFullYear();
  return `MPPT-${year}-V${volume}I${issue}-${seq}`;
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
  const chatId = env.TELEGRAM_GROUP_ID || '-1004291559247';
  
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    ...options,
  };
  
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  return res.json();
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

async function notifyStageChange(env, paper, newStage) {
  const label = STAGE_LABELS[newStage] || newStage;
  const msg = `📋 *${paper.paper_id}*\n👤 ${paper.author_name}\n📄 _${paper.title}_\n\n➡️ Stage: *${label}*`;
  
  await sendTelegram(env, msg);
  
  // Log communication
  if (env.DB) {
    await env.DB.prepare(`
      INSERT INTO communications (paper_id, channel, direction, from_address, to_address, subject, body_preview, stage_at_time)
      VALUES (?, 'telegram', 'outbound', 'mpptai_bot', 'group', ?, ?, ?)
    `).bind(paper.paper_id, `Stage: ${newStage}`, msg.substring(0, 500), newStage).run();
  }
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
  },
};

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
    const msg = `📥 *NEW SUBMISSION RECEIVED*\n\n` +
      `🆔 *Paper ID:* \`${paperId}\`\n` +
      `📄 *Title:* _${title || 'Untitled'}_\n` +
      `👤 *Author:* ${authorName}\n` +
      `📧 *Email:* ${authorEmail}\n` +
      `📁 *File:* ${safeBaseName} (${(file.size / 1024).toFixed(1)} KB)\n` +
      `🏷️ *Scope:* ${scope || 'Not specified'}\n\n` +
      `➡️ Stage: *${STAGE_LABELS.SUBMITTED}*\n` +
      `⏭️ Next: Plagiarism & AI content check`;
    
    await sendTelegram(env, msg);
  }

  // Log communication
  if (env.DB) {
    await logComm(env.DB, paperId, 'system', 'inbound', authorEmail, 'system', 
      'Manuscript Submitted', `${title} by ${authorName}`, null, STAGES.SUBMITTED);
    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', authorEmail,
      `Submission Confirmation — ${paperId}`, `Manuscript received: ${title}`, '1_SUBMISSION_CONFIRMATION', STAGES.SUBMITTED);
  }

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

    // Log
    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
      `Plagiarism Check: Resubmission Required — ${paperId}`, `Score: ${score}%`, '2A_PLAGIARISM_RESUBMIT', STAGES.PLAGIARISM_FAIL);

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

    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
      `Desk Screening Cleared — ${paperId}`, `Score: ${score}%`, '2_DESK_SCREENING_CLEARED', STAGES.PLAGIARISM_PASS);

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

    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
      `Formatting Revision Required — ${paperId}`, (issues || []).join('; '), '3A_FORMATTING_REVISION', STAGES.FORMATTING_FAIL);

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

    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
      `Formatting Cleared — ${paperId}`, 'All formatting checks passed', '3B_FORMATTING_CLEARED', STAGES.FORMATTING_PASS);

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

    await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', reviewer.email,
      `Peer Review Invitation — ${paperId}`, `Review requested for: ${paper.title}`, '3_PEER_REVIEW_DISPATCH', STAGES.REVIEWER_ASSIGNED);
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

      await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
        `Reviewer Comments — ${paperId}`, `Decisions: ${decisions.join(', ')}`, '5A_REVIEWER_COMMENTS', STAGES.REVISION_REQUIRED);
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

      await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
        `Accepted for Publication — ${paperId}`, 'Paper accepted after peer review', '4_EDITORIAL_DECISION_ACCEPT', STAGES.ACCEPTED);
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
  await notifyStageChange(env, paper, targetStage);

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

  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    `Editorial Decision: Rejected — ${paperId}`, reason || 'Editorial decision', 'REJECTION', STAGES.REJECTED);

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

  // Gallery Proof dispatched strictly from editor@mpptjournal.com
  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    `Gallery Proof for Final Verification — ${paperId}`, notes || `Gallery proof link: ${proofUrl || ''}`, '6_GALLERY_PROOF', STAGES.GALLERY_SENT);

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

  await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
    `Payment Link — ${paperId}`, 'Gallery proof confirmed, payment pending', '7_PAYMENT_LINK', STAGES.PAYMENT_PENDING);

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

  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    `Payment Receipt — ${paperId}`, `Payment ₹${amount} verified`, '7A_PAYMENT_RECEIPT', STAGES.PAYMENT_VERIFIED);

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

  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    `Published & Archived — ${paperId}`, `Published at ${publishedUrl}`, '5_PUBLISHED_AND_ARCHIVED', STAGES.PUBLISHED);

  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    `Official Publication Certificate — ${paperId}`, `Certificate generated for ${paperId}`, '8_CERTIFICATE', STAGES.PUBLISHED);

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

  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    `Official Publication Certificate — ${paperId}`, `Certificate link: ${certificateUrl}`, '8_CERTIFICATE', STAGES.PUBLISHED);

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

  await env.DB.prepare(`
    INSERT OR IGNORE INTO reviewers (name, email, affiliation, speciality, orcid)
    VALUES (?, ?, ?, ?, ?)
  `).bind(name, email.toLowerCase().trim(), affiliation || '', speciality || '', orcid || '').run();

  return json({ success: true, message: `Reviewer ${name} added to pool` }, 201);
}

// ════════════════════════════════════════════════════════════
// HANDLER: INBOUND EMAIL INGESTION & AI TELEGRAM NOTIFICATION
// ════════════════════════════════════════════════════════════

async function processInboundEmail(env, emailData) {
  const inbox = (emailData.inbox || 'review@mpptjournal.com').toLowerCase().trim();
  const fromAddress = (emailData.fromAddress || 'author@university.edu').toLowerCase().trim();
  const fromName = emailData.fromName || '';
  const subject = emailData.subject || 'Manuscript Correspondence';
  const bodyText = emailData.bodyText || '';
  let paperId = emailData.paperId || null;

  // Attempt to extract Paper ID from subject or body if not provided
  if (!paperId) {
    const match = (subject + ' ' + bodyText).match(/MPPT-\d{4}-V\d+I\d+-\d{4}/i);
    if (match) paperId = match[0].toUpperCase();
  }

  const inboundId = `INB-${Date.now().toString(36).toUpperCase()}`;

  // 1. Generate 1-2 sentence AI summary using Workers AI (Llama 3.1 8B)
  let summary = '';
  if (env.AI) {
    try {
      const messages = [
        {
          role: 'system',
          content: 'You are an editorial assistant for MPPT Journal. Summarize the following incoming academic email in 1 to 2 clear, concise sentences for the editors. Highlight any core requests, manuscript IDs, or urgent decisions needed.'
        },
        {
          role: 'user',
          content: `Recipient Inbox: ${inbox}\nFrom: ${fromName ? `${fromName} <${fromAddress}>` : fromAddress}\nSubject: ${subject}\n\nEmail Body:\n${bodyText.substring(0, 2000)}`
        }
      ];
      const aiRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages, max_tokens: 160 });
      summary = (aiRes.response || '').trim();
    } catch (aiErr) {
      console.error('AI summary error:', aiErr);
    }
  }

  if (!summary) {
    summary = bodyText.length > 180 ? bodyText.substring(0, 180) + '...' : (bodyText || 'Incoming communication received.');
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

  // 3. Dispatch alert to Telegram Group
  const senderDisplay = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
  const alertText = 
    `📬 *New Email Received!*\n\n` +
    `📥 *Inbox:* \`${inbox}\`\n` +
    `👤 *From:* \`${senderDisplay}\`\n` +
    `📋 *Subject:* *${subject}*\n` +
    (paperId ? `🆔 *Paper ID:* \`${paperId}\`\n` : '') +
    `\n📝 *Summary:*\n_${summary}_\n\n` +
    `💡 *What next?*\n` +
    `Reply directly to this Telegram message with your instructions, e.g.:\n` +
    `• \`Reply: Grant 5-day extension for revised figures\`\n` +
    `• \`Reply: Request point-by-point rebuttal file and updated citations\`\n` +
    `MPPT AI will automatically draft the official academic response for you.`;

  let tgMsgId = null;
  if (env.TELEGRAM_BOT_TOKEN) {
    const tgRes = await sendTelegram(env, alertText);
    tgMsgId = tgRes?.result?.message_id;

    if (tgMsgId && env.DB) {
      await env.DB.prepare(`UPDATE inbound_emails SET telegram_msg_id = ? WHERE inbound_id = ?`)
        .bind(tgMsgId, inboundId).run();
    }
  }

  return { success: true, inboundId, inbox, fromAddress, subject, summary, telegramMsgId: tgMsgId };
}

async function handleInboundEmailHttp(request, env) {
  const body = await request.json().catch(() => ({}));
  const { inbox, from, fromName, subject, body: emailBody, paperId } = body;
  if (!from || !subject) {
    return json({ success: false, error: 'from and subject are required' }, 400);
  }

  const result = await processInboundEmail(env, {
    inbox: inbox || 'review@mpptjournal.com',
    fromAddress: from,
    fromName: fromName || '',
    subject: subject,
    bodyText: emailBody || '',
    paperId: paperId || null
  });

  return json({ success: true, ...result }, 201);
}

async function handleSimulateEmail(request, env) {
  const body = await request.json().catch(() => ({}));
  const sample = {
    inbox: body.inbox || 'review@mpptjournal.com',
    fromAddress: body.from || 'author.kumar@aiims.edu',
    fromName: body.fromName || 'Dr. Rajesh Kumar',
    subject: body.subject || 'Inquiry regarding manuscript MPPT-2026-V1I1-0001 peer review status',
    bodyText: body.body || 'Dear Editorial Desk, I am writing to politely inquire regarding the status of our submission MPPT-2026-V1I1-0001. We are approaching our annual research grant audit deadline on October 5th. Could you kindly provide an update on the double-blind referee reports, and let us know if an extension is possible if major revisions are recommended? Sincerely, Dr. Rajesh Kumar, Department of Pharmacology, AIIMS New Delhi.',
    paperId: body.paperId || 'MPPT-2026-V1I1-0001'
  };

  const result = await processInboundEmail(env, sample);
  return json({ success: true, message: 'Simulated email processed and Telegram alert dispatched', ...result });
}

async function handleListInboundEmails(env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);
  const rows = await env.DB.prepare(`SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 50`).all();
  return json({ success: true, count: rows.results?.length || 0, emails: rows.results || [] });
}

async function handleInboundEmailStream(message, env, ctx) {
  const inbox = message.to || 'review@mpptjournal.com';
  const fromAddress = message.from || 'author@university.edu';
  const subject = message.headers.get('subject') || 'Manuscript Communication';
  
  let bodyText = '';
  try {
    const raw = await new Response(message.raw).text();
    const parts = raw.split('\n\n');
    bodyText = (parts.slice(1).join('\n\n') || raw).substring(0, 3000);
  } catch(e) {
    bodyText = 'Email raw stream parse note';
  }

  await processInboundEmail(env, {
    inbox,
    fromAddress,
    fromName: message.headers.get('from') || '',
    subject,
    bodyText
  });
}

// ════════════════════════════════════════════════════════════
// HANDLER: TELEGRAM WEBHOOK
// ════════════════════════════════════════════════════════════

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
  const botMentioned = /@mpptai(_bot)?\b/i.test(text) || 
    (msg.entities || []).some(e => e.type === 'mention' && /@mpptai/i.test(text.substring(e.offset, e.offset + e.length)));
  const isReply = msg.reply_to_message?.from?.is_bot;

  // Only respond when bot is @mentioned or replied to
  if (!botMentioned && !isReply) {
    return json({ ok: true });
  }

  // Strip bot mention from text
  const userQuery = text.replace(/@mpptai(_bot)?\b/gi, '').trim();
  if (!userQuery) {
    await sendTelegram(env, `👋 Hello ${msg.from?.first_name || 'there'}! I am listening.\n\nTag me with any question or command:\n• \`@mpptai_bot add reviewer Dr. Name, email, speciality\`\n• \`@mpptai_bot list reviewers\`\n• \`@mpptai_bot test email\`\n• \`@mpptai_bot status MPPT-2026-V1I1-0001\``, { reply_to_message_id: msg.message_id });
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
    if (repliedText.includes('Auto-Drafted') || repliedText.includes('Subject: Re:')) {
      let matchedInbound = null;
      if (env.DB) {
        matchedInbound = await env.DB.prepare(`
          SELECT * FROM inbound_emails WHERE reply_status = 'drafted' ORDER BY id DESC LIMIT 1
        `).first();
        if (matchedInbound) {
          await env.DB.prepare(`
            UPDATE inbound_emails SET reply_status = 'sent', replied_at = datetime('now') WHERE id = ?
          `).bind(matchedInbound.id).run();
        }
      }

      const conf = `🚀 *Response Dispatched & Logged!*\n\n` +
        `The drafted response has been marked as officially dispatched.\n` +
        `📧 *From:* \`${matchedInbound?.inbox || 'review@mpptjournal.com'}\`\n` +
        `📨 *To:* \`${matchedInbound?.from_address || 'Author'}\`\n` +
        `📋 *Subject:* Re: ${matchedInbound?.subject || 'Manuscript Communication'}\n\n` +
        `Audit ledger in Cloudflare D1 communications updated.`;
      await sendTelegram(env, conf, { reply_to_message_id: msg.message_id });
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

        const aiRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: draftMessages, max_tokens: 600 });
        draftedText = aiRes.response || '';
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

  // ── BUILD GENERAL CONTEXT FOR AI ──
  let dbContext = '';
  let paperMatchObj = null;
  
  if (env.DB) {
    // Extract paper ID if mentioned
    const paperMatch = userQuery.match(/MPPT-\d{4}-V\d+I\d+-\d{4}/i);
    
    if (paperMatch) {
      const pid = paperMatch[0].toUpperCase();
      const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(pid).first();
      if (paper) {
        paperMatchObj = paper;
        const history = safeJsonParse(paper.stage_history, []);
        dbContext += `\n\nPAPER DATA for ${pid}:\n`;
        dbContext += `Title: ${paper.title}\nAuthor: ${paper.author_name} (${paper.author_email})\n`;
        dbContext += `Current Stage: ${paper.stage} (${STAGE_LABELS[paper.stage] || paper.stage})\n`;
        dbContext += `Submitted: ${paper.submitted_at}\nLast Updated: ${paper.updated_at}\n`;
        dbContext += `Plagiarism Score: ${paper.plagiarism_score !== null ? paper.plagiarism_score + '%' : 'Not checked'}\n`;
        dbContext += `Deadline: ${paper.current_deadline || 'None'}\n`;
        dbContext += `Stage History: ${history.map(h => `${h.stage} at ${h.timestamp}`).join(' → ')}\n`;

        const reviews = await env.DB.prepare(
          `SELECT ra.*, r.name FROM review_assignments ra JOIN reviewers r ON ra.reviewer_id = r.id WHERE ra.paper_id = ?`
        ).bind(pid).all();
        if (reviews.results?.length) {
          dbContext += `Reviewers: ${reviews.results.map(r => `${r.name}: ${r.status} (${r.decision || 'pending'})`).join(', ')}\n`;
        }
      } else {
        dbContext += `\nPaper ${pid} not found in database.\n`;
      }
    }

    // General stats
    const stats = await env.DB.prepare(`
      SELECT stage, COUNT(*) as cnt FROM manuscripts WHERE is_active = 1 GROUP BY stage
    `).all();
    if (stats.results?.length) {
      dbContext += `\n\nOVERALL PIPELINE STATS:\n`;
      stats.results.forEach(s => {
        dbContext += `${STAGE_LABELS[s.stage] || s.stage}: ${s.cnt} papers\n`;
      });
    }
  }

  // ── Call Workers AI or Smart Deterministic Fallback ──
  let aiReply = '';

  if (env.AI) {
    try {
      const messages = [
        { role: 'system', content: AI_SYSTEM_PROMPT + dbContext },
        { role: 'user', content: `Group member ${msg.from?.first_name || 'Editor'} says: "${userQuery}"` },
      ];

      const aiResult = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages, max_tokens: 500 });
      aiReply = aiResult.response || '';
    } catch (aiErr) {
      console.error('AI error:', aiErr);
    }
  }

  // If AI was not enabled or produced empty output, use intelligent deterministic fallback
  if (!aiReply) {
    const qLower = userQuery.toLowerCase();
    
    if (paperMatchObj) {
      const p = paperMatchObj;
      const daysLeft = daysUntil(p.current_deadline);
      const deadlineStr = p.current_deadline ? `${p.current_deadline.split('T')[0]} (${daysLeft > 0 ? `${daysLeft} days remaining` : 'OVERDUE'})` : 'None';
      
      aiReply = `📋 *Paper Status: ${p.paper_id}*\n\n` +
        `📄 *Title:* _${p.title || 'Untitled'}_\n` +
        `👤 *Author:* ${p.author_name}\n` +
        `➡️ *Stage:* ${STAGE_LABELS[p.stage] || p.stage}\n` +
        `📊 *Plagiarism:* ${p.plagiarism_score !== null ? `${p.plagiarism_score}%` : 'Not checked'}\n` +
        `⏰ *Active Deadline:* ${deadlineStr}\n` +
        `🌐 *Track:* https://mpptjournal.com/track?id=${p.paper_id}`;
    } else if (qLower.includes('how many') || qLower.includes('stat') || qLower.includes('pending') || qLower.includes('pipeline')) {
      if (dbContext.includes('OVERALL PIPELINE STATS:')) {
        aiReply = `📊 *MPPT Editorial Pipeline Stats:*\n\n` + dbContext.split('OVERALL PIPELINE STATS:\n')[1];
      } else {
        aiReply = `📊 Pipeline is currently active. Use \`@mpptai_bot status <PAPER_ID>\` to inspect a manuscript.`;
      }
    } else if (qLower.includes('help') || qLower.includes('command')) {
      aiReply = `🤖 *MPPT Editorial Assistant Commands:*\n\n` +
        `• \`@mpptai_bot add reviewer Dr. Name, email, speciality, affiliation\` — Onboard reviewer\n` +
        `• \`@mpptai_bot list reviewers\` — View active reviewer pool\n` +
        `• \`@mpptai_bot test email\` — Simulate inbound email & auto-draft test\n` +
        `• \`@mpptai_bot status <PAPER_ID>\` — Full audit trail\n` +
        `• \`@mpptai_bot how many papers pending?\` — Pipeline counts\n` +
        `• \`@mpptai_bot extend <PAPER_ID> 3 days\` — Extend active deadline\n` +
        `• \`@mpptai_bot remind reviewer for <PAPER_ID>\` — Send reviewer reminder`;
    } else {
      aiReply = `👋 Understood, ${msg.from?.first_name || 'Editor'}! You asked: "${userQuery}".\n\n` +
        (dbContext ? `Here is the current system data:\n${dbContext}` : `Provide a Paper ID (e.g., MPPT-2026-V1I1-0001) for detailed tracking.`);
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
