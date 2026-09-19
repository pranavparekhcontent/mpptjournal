const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'worker', 'src', 'index.js');
let code = fs.readFileSync(indexPath, 'utf8');

// 1. sendViaZohoSmtp function definition
const zohoSmtpFunc = `
/**
 * Direct Zoho SMTP over TLS implementation using Cloudflare Workers cloudflare:sockets.
 * Connects securely to smtppro.zoho.in:465 with zero third-party dependencies.
 */
async function sendViaZohoSmtp(env, { from, to, subject, html }) {
  const host = env.ZOHO_SMTP_HOST || 'smtppro.zoho.in';
  const port = parseInt(env.ZOHO_SMTP_PORT || '465', 10);
  const user = env.ZOHO_SMTP_USER || from;
  const pass = env.ZOHO_SMTP_PASS || env.ZOHO_APP_PASSWORD;

  if (!pass) return { sent: false, error: 'No Zoho SMTP password configured in worker secrets' };

  let writer = null;
  try {
    const socket = connect({ hostname: host, port }, { secureTransport: 'on' });
    writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let buffer = '';
    async function readLine() {
      while (!buffer.includes('\\r\\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      const idx = buffer.indexOf('\\r\\n');
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
        reply += '\\n' + line;
      }
      return reply;
    }

    async function sendCmd(cmd) {
      await writer.write(encoder.encode(cmd + '\\r\\n'));
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

    const fromRes = await sendCmd(\`MAIL FROM:<\${from}>\`);
    if (!fromRes.startsWith('250')) throw new Error('MAIL FROM failed: ' + fromRes);

    const toRes = await sendCmd(\`RCPT TO:<\${to}>\`);
    if (!toRes.startsWith('250')) throw new Error('RCPT TO failed: ' + toRes);

    const dataRes = await sendCmd('DATA');
    if (!dataRes.startsWith('354')) throw new Error('DATA initiation failed: ' + dataRes);

    const emailHeaders = [
      \`From: MPPT Journal <\${from}>\`,
      \`To: <\${to}>\`,
      \`Subject: \${subject}\`,
      \`MIME-Version: 1.0\`,
      \`Content-Type: text/html; charset=UTF-8\`,
      \`Date: \${new Date().toUTCString()}\`,
      \`Message-ID: <\${Date.now()}.\${Math.random().toString(36).substring(2)}@mpptjournal.com>\`,
      \`\`,
      html,
      \`.\`
    ].join('\\r\\n');

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
`;

// Insert sendViaZohoSmtp above dispatchOrQueueEmail if not present
if (!code.includes('async function sendViaZohoSmtp')) {
  code = code.replace(
    'async function dispatchOrQueueEmail(env, { paperId, templateKey, fromInbox, toAddress, subject, templateVars, stage }) {',
    zohoSmtpFunc + '\nasync function dispatchOrQueueEmail(env, { paperId, templateKey, fromInbox, toAddress, subject, templateVars, stage }) {'
  );
  console.log('1. Added sendViaZohoSmtp function');
}

// 2. Wire Zoho SMTP and enhance notifications in dispatchOrQueueEmail
const oldDispatchEnd = `  // 3. Truthful Database Logging (Verification-First)
  if (env.DB) {
    if (sendResult.sent) {
      // PHYSICALLY SENT — Verified outbound log
      await logComm(env.DB, paperId, 'email', 'outbound', from, toAddress,
        finalSubject, \`[SENT via \${sendResult.provider}] \${finalSubject}\`, templateKey, stage);
    } else {
      // NOT SENT — Logged truthfully as DRAFT / PENDING MANUAL DISPATCH
      await logComm(env.DB, paperId, 'email_draft', 'pending_manual_dispatch', from, toAddress,
        finalSubject, \`[DRAFT - PENDING MANUAL ZOHO DISPATCH] \${finalSubject}\`, templateKey, stage);
    }
  }

  // 4. Telegram Group Notification
  if (env.TELEGRAM_BOT_TOKEN) {
    if (sendResult.sent) {
      await sendTelegram(env,
        \`🚀 *OFFICIAL EMAIL DISPATCHED*\\n\\n\` +
        \`🆔 *Paper ID:* \\\`\${paperId}\\\`\\n\` +
        \`📧 *Template:* \\\`\${templateKey}\\\`\\n\` +
        \`📤 *From:* \\\`\${from}\\\`\\n\` +
        \`📨 *To:* \\\`\${toAddress}\\\`\\n\` +
        \`📋 *Subject:* _\${finalSubject}_\\n\` +
        \`✅ Verified sent via \${sendResult.provider}.\`
      );
    } else {
      await sendTelegram(env,
        \`⚠️ *OFFICIAL EMAIL GENERATED (MANUAL DISPATCH REQUIRED)*\\n\\n\` +
        \`🆔 *Paper ID:* \\\`\${paperId}\\\`\\n\` +
        \`📧 *Template:* \\\`\${templateKey}.html\\\`\\n\` +
        \`📤 *From Desk:* \\\`\${from}\\\`\\n\` +
        \`📨 *To Recipient:* \\\`\${toAddress}\\\`\\n\` +
        \`📋 *Subject:* *\${finalSubject}*\\n\\n\` +
        \`⚡ *Status:* No external outbound email API configured on Cloudflare Workers.\\n\` +
        \`👉 *Action Required:* Please dispatch this email from Zoho Mail (\\\`\${from}\\\`).\\n\` +
        \`_Tip: Tag \\\`@mpptai_bot sent \${paperId}\\\` to verify dispatch in D1._\`
      );
    }
  }`;

const newDispatchEnd = `  // 3. Attempt delivery via Zoho SMTP (via cloudflare:sockets) if configured & not sent yet
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
        finalSubject, \`[SENT via \${sendResult.provider}] \${finalSubject}\`, templateKey, stage);
    } else {
      // NOT SENT — Logged truthfully as DRAFT / PENDING OUTBOUND KEY
      await logComm(env.DB, paperId, 'email_draft', 'pending_manual_dispatch', from, toAddress,
        finalSubject, \`[DRAFT - AWAITING OUTBOUND TRANSPORT] \${finalSubject}\`, templateKey, stage);
    }
  }

  // 5. Telegram Group Notification with EXPLICIT Email Attribution
  if (env.TELEGRAM_BOT_TOKEN) {
    if (sendResult.sent) {
      await sendTelegram(env,
        \`🚀 *OFFICIAL EMAIL DISPATCHED (AUTONOMOUS)*\\n\\n\` +
        \`🆔 *Paper ID:* \\\`\${paperId}\\\`\\n\` +
        \`📧 *Template:* \\\`\${templateKey}.html\\\`\\n\` +
        \`📤 *From Mailbox:* \\\`\${from}\\\`\\n\` +
        \`📨 *To Author Address:* \\\`\${toAddress}\\\`\\n\` +
        \`📋 *Subject:* _\${finalSubject}_\\n\\n\` +
        \`✅ *Status:* Physically delivered via \${sendResult.provider} (\${sendResult.id || 'OK'}). D1 verified.\`
      );
    } else {
      await sendTelegram(env,
        \`⚠️ *OFFICIAL EMAIL QUEUED (AWAITING OUTBOUND KEY)*\\n\\n\` +
        \`🆔 *Paper ID:* \\\`\${paperId}\\\`\\n\` +
        \`📧 *Template:* \\\`\${templateKey}.html\\\`\\n\` +
        \`📤 *From Mailbox:* \\\`\${from}\\\`\\n\` +
        \`📨 *To Author Address:* \\\`\${toAddress}\\\`\\n\` +
        \`📋 *Subject:* *\${finalSubject}*\\n\\n\` +
        \`⚡ *Status:* Outbound dispatch paused until 1 transport key is configured in Worker secrets (Zoho SMTP App Password, Brevo Key, or Resend Key).\\n\` +
        \`👉 Once configured, every submission acknowledges and mails the author 100% autonomously!\\n\` +
        \`_Command: tag \\\`@mpptai_bot dispatch \${paperId}\\\` to send queued draft once key is added._\`
      );
    }
  }`;

if (code.includes(oldDispatchEnd)) {
  code = code.replace(oldDispatchEnd, newDispatchEnd);
  console.log('2. Replaced dispatchOrQueueEmail body with Zoho SMTP and explicit attribution');
}

// 3. Add handleInboundEmailStream implementation
const inboundStreamFunc = `
/**
 * Cloudflare Email Routing Stream Handler
 * Ingests incoming emails to editor@, review@, publisher@ via Email Routing,
 * runs AI summary, persists to D1, alerts Telegram, and forwards to owner Gmail.
 */
async function handleInboundEmailStream(message, env, ctx) {
  try {
    const from = message.from || 'unknown@domain.com';
    const to = message.to || 'review@mpptjournal.com';
    const subject = message.headers.get('subject') || 'Manuscript Inquiry';
    
    // Read raw email body
    const raw = await new Response(message.raw).text().catch(() => '');
    let bodyText = '';
    
    const doubleNewline = raw.indexOf('\\r\\n\\r\\n');
    if (doubleNewline !== -1) {
      bodyText = raw.substring(doubleNewline + 4);
    } else {
      bodyText = raw;
    }

    bodyText = bodyText.substring(0, 3000).replace(/--[a-zA-Z0-9_-]+/g, '').trim();

    await processInboundEmail(env, {
      fromAddress: from,
      toAddress: to,
      inbox: to,
      subject,
      bodyText: bodyText || \`Incoming email to \${to} from \${from}\`,
    });

    // Forward copy to verified owner email (pranavparekhcontent@gmail.com)
    const forwardTo = env.FORWARD_TO_EMAIL || 'pranavparekhcontent@gmail.com';
    if (forwardTo && message.forward) {
      ctx.waitUntil(message.forward(forwardTo).catch(e => console.error('Email forward error:', e)));
    }
  } catch (err) {
    console.error('handleInboundEmailStream failed:', err);
  }
}
`;

if (!code.includes('async function handleInboundEmailStream')) {
  code = code.replace(
    '// ════════════════════════════════════════════════════════════\n// HANDLER: SUBMISSION INTAKE',
    inboundStreamFunc + '\n// ════════════════════════════════════════════════════════════\n// HANDLER: SUBMISSION INTAKE'
  );
  console.log('3. Added handleInboundEmailStream function');
}

// 4. Add POST /api/email/dispatch-queued/:paperId route
const newRoute = `      // ── Dispatch Queued Email ──
      if (method === 'POST' && path.startsWith('/api/email/dispatch-queued/')) {
        const paperId = decodeURIComponent(path.replace('/api/email/dispatch-queued/', '')).trim();
        return await handleDispatchQueued(env, paperId);
      }
`;

if (!code.includes('/api/email/dispatch-queued/')) {
  code = code.replace(
    "      if (method === 'POST' && path === '/api/email/confirm-dispatch') {",
    newRoute + "\n      if (method === 'POST' && path === '/api/email/confirm-dispatch') {"
  );
  console.log('4. Added /api/email/dispatch-queued/ route');
}

// 5. Add handleDispatchQueued implementation
const handleDispatchQueuedFunc = `
async function handleDispatchQueued(env, paperId) {
  if (!env.DB) return json({ error: 'Database binding missing' }, 500);

  const paper = await env.DB.prepare('SELECT * FROM manuscripts WHERE paper_id = ?').bind(paperId).first();
  if (!paper) return json({ error: 'Paper not found' }, 404);

  // Find latest pending draft
  const draft = await env.DB.prepare(\`
    SELECT * FROM communications 
    WHERE paper_id = ? AND channel = 'email_draft' 
    ORDER BY timestamp DESC LIMIT 1
  \`).bind(paperId).first();

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
      TRACKING_URL: \`https://mpptjournal.com/track.html?id=\${encodeURIComponent(paper.paper_id)}\`,
      CONFIRMATION_DEADLINE: 'within 48 hours',
      DESK_EMAIL: fromInbox,
    },
    stage: paper.stage,
  });

  return json({ success: true, paperId, result: res });
}
`;

if (!code.includes('async function handleDispatchQueued')) {
  code = code.replace(
    'async function handleConfirmEmailDispatch(request, env) {',
    handleDispatchQueuedFunc + '\nasync function handleConfirmEmailDispatch(request, env) {'
  );
  console.log('5. Added handleDispatchQueued function');
}

// 6. Add bot command /dispatch
const oldTelegramDispatchCheck = `      if (text.startsWith('/sent')) {`;
const newTelegramDispatchCheck = `      if (text.startsWith('/dispatch')) {
        const parts = text.split(/\\s+/);
        const lookupId = (parts[1] || '').toUpperCase().trim();
        if (!lookupId) {
          await sendTelegram(env, '⚠️ Please provide Paper ID: \`/dispatch MPPT-2026-V1I1-0003\`');
          return json({ ok: true });
        }
        const res = await handleDispatchQueued(env, lookupId);
        const data = await res.json();
        if (data.result?.sent) {
          await sendTelegram(env, \`✅ *SUCCESSFULLY DISPATCHED*\\n\\n🆔 Paper \\\`\${lookupId}\\\` confirmation physically sent to author via \${data.result.provider}! D1 updated.\`);
        } else {
          await sendTelegram(env, \`⚠️ Dispatch failed: \${data.result?.error || 'No outbound transport key configured yet.'}\`);
        }
        return json({ ok: true });
      }

      if (text.startsWith('/sent')) {`;

if (code.includes(oldTelegramDispatchCheck) && !code.includes('/dispatch')) {
  code = code.replace(oldTelegramDispatchCheck, newTelegramDispatchCheck);
  console.log('6. Added /dispatch bot command in handleTelegramWebhook');
}

fs.writeFileSync(indexPath, code, 'utf8');
console.log('Patch complete!');
