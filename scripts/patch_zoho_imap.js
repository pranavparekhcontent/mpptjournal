const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'worker', 'src', 'index.js');
let code = fs.readFileSync(indexPath, 'utf8');

const imapFunc = `
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

    async function sendTag(tag, cmd) {
      await writer.write(encoder.encode(\`\${tag} \${cmd}\\r\\n\`));
      const lines = [];
      while (true) {
        const line = await readLine();
        lines.push(line);
        if (line.startsWith(\`\${tag} OK\`) || line.startsWith(\`\${tag} NO\`) || line.startsWith(\`\${tag} BAD\`)) {
          break;
        }
      }
      return lines;
    }

    // Read initial greeting
    await readLine();

    // 1. Login
    const loginRes = await sendTag('A1', \`LOGIN "\${user}" "\${pass}"\`);
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
    const uids = searchLine.replace('* SEARCH', '').trim().split(/\\s+/).filter(Boolean);

    let processedCount = 0;
    for (const uid of uids.slice(-5)) {
      const fetchRes = await sendTag(\`A4_\${uid}\`, \`FETCH \${uid} (BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY[TEXT])\`);
      const rawMsg = fetchRes.join('\\n');

      const fromMatch = rawMsg.match(/^FROM:\\s*(.*)$/im);
      const toMatch = rawMsg.match(/^TO:\\s*(.*)$/im);
      const subjectMatch = rawMsg.match(/^SUBJECT:\\s*(.*)$/im);

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
`;

if (!code.includes('async function checkZohoImap')) {
  code = code.replace(
    'async function dispatchOrQueueEmail(env, { paperId, templateKey, fromInbox, toAddress, subject, templateVars, stage }) {',
    imapFunc + '\nasync function dispatchOrQueueEmail(env, { paperId, templateKey, fromInbox, toAddress, subject, templateVars, stage }) {'
  );
  console.log('1. Added checkZohoImap function');
}

// Add route GET /api/email/poll-zoho
const pollRoute = `      // ── Poll Zoho IMAP for New Emails ──
      if (method === 'GET' && path === '/api/email/poll-zoho') {
        const res = await checkZohoImap(env);
        return json(res);
      }
`;

if (!code.includes('/api/email/poll-zoho')) {
  code = code.replace(
    "      // ── Dispatch Queued Email ──",
    pollRoute + "\n      // ── Dispatch Queued Email ──"
  );
  console.log('2. Added /api/email/poll-zoho route');
}

// Add bot command /poll
const pollBotCommand = `      // ── COMMAND: POLL ZOHO EMAILS ──
      if (userQuery.match(/^(?:(?:\/)?(?:poll|checkemails|check_emails)|check\s+inbox|poll\s+zoho)\b/i)) {
        await sendTelegram(env, '🔄 *Checking Zoho Mail server for new unread emails...*', { reply_to_message_id: msg.message_id });
        const res = await checkZohoImap(env);
        if (res.success) {
          await sendTelegram(env, \`✅ *Zoho Sync Complete*\\n\\n📬 Processed *\${res.processedCount}* new incoming emails out of *\${res.unreadTotal}* unread on Zoho server.\\nMails remain safely stored in your 5GB Zoho inbox.\`, { reply_to_message_id: msg.message_id });
        } else {
          await sendTelegram(env, \`⚠️ Zoho poll failed: \${res.error || 'Check credentials'}\`, { reply_to_message_id: msg.message_id });
        }
        return json({ ok: true });
      }
`;

if (!code.includes('// ── COMMAND: POLL ZOHO EMAILS ──')) {
  code = code.replace(
    '  // ── COMMAND: DISPATCH QUEUED EMAIL (Autonomous Execution) ──',
    pollBotCommand + '\n  // ── COMMAND: DISPATCH QUEUED EMAIL (Autonomous Execution) ──'
  );
  console.log('3. Added /poll command to bot webhook');
}

fs.writeFileSync(indexPath, code, 'utf8');
console.log('Zoho IMAP patch complete!');
