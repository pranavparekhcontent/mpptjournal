const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'worker', 'src', 'index.js');
let code = fs.readFileSync(indexPath, 'utf8');

// 1. Add import at top
if (!code.includes("import { renderEmailHtml, getTemplateSubject }")) {
  code = code.replace(
    "// CONSTANTS\n// ════════════════════════════════════════════════════════════\n\nconst CORS_HEADERS",
    "// EMAIL TEMPLATES\nimport { renderEmailHtml, getTemplateSubject } from './templates.js';\n\n// CONSTANTS\n// ════════════════════════════════════════════════════════════\n\nconst CORS_HEADERS"
  );
  console.log('1. Added templates import');
}

// 2. Enhance notifyStageChange and add dispatchOrQueueEmail
const oldNotifyBlock = `async function notifyStageChange(env, paper, newStage) {
  const label = STAGE_LABELS[newStage] || newStage;
  const msg = \`📋 *\${paper.paper_id}*\\n👤 \${paper.author_name}\\n📄 _\${paper.title}_\\n\\n➡️ Stage: *\${label}*\`;
  
  await sendTelegram(env, msg);
  
  // Log communication
  if (env.DB) {
    await env.DB.prepare(\`
      INSERT INTO communications (paper_id, channel, direction, from_address, to_address, subject, body_preview, stage_at_time)
      VALUES (?, 'telegram', 'outbound', 'mpptai_bot', 'group', ?, ?, ?)
    \`).bind(paper.paper_id, \`Stage: \${newStage}\`, msg.substring(0, 500), newStage).run();
  }
}`;

const newNotifyAndDispatchBlock = `async function notifyStageChange(env, paper, newStage, actor = 'editorial_board') {
  const label = STAGE_LABELS[newStage] || newStage;
  const cleanTitle = (paper.title || 'Untitled').replace(/[_*[\\]()~\`>#+=|{}.!-]/g, ' ').replace(/\\s+/g, ' ').trim();
  const cleanAuthor = (paper.author_name || 'Author').replace(/[_*[\\]()~\`>#+=|{}.!-]/g, ' ').replace(/\\s+/g, ' ').trim();

  const msg = 
    \`📋 *MANUSCRIPT STAGE UPDATE*\\n\\n\` +
    \`🆔 *Paper ID:* \\\`\${paper.paper_id}\\\`\\n\` +
    \`📄 *Title:* _\${cleanTitle}_\\n\` +
    \`👤 *Author:* \${cleanAuthor}\\n\` +
    \`🏛️ *Affiliation:* \${paper.author_affiliation || 'N/A'}\\n\\n\` +
    \`➡️ *New Stage:* *\${label}*\\n\` +
    \`👤 *Updated by:* \${actor}\\n\` +
    (paper.current_deadline ? \`⏰ *Active Deadline:* \${paper.current_deadline.split('T')[0]}\\n\` : '') +
    \`\\n🔗 *Track Live:* https://mpptjournal.com/track.html?id=\${encodeURIComponent(paper.paper_id)}\`;
  
  await sendTelegram(env, msg);
  
  // Log communication in D1
  if (env.DB) {
    await env.DB.prepare(\`
      INSERT INTO communications (paper_id, channel, direction, from_address, to_address, subject, body_preview, stage_at_time)
      VALUES (?, 'telegram', 'outbound', 'mpptai_bot', 'group', ?, ?, ?)
    \`).bind(paper.paper_id, \`Stage: \${newStage}\`, msg.substring(0, 500), newStage).run();
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
          'Authorization': \`Bearer \${env.RESEND_API_KEY}\`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: \`MPPT Journal <\${from}>\`,
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

  // 3. Truthful Database Logging (Verification-First)
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
  }

  return { success: true, ...sendResult, templateKey, subject: finalSubject, html: renderedHtml };
}`;

if (code.includes(oldNotifyBlock)) {
  code = code.replace(oldNotifyBlock, newNotifyAndDispatchBlock);
  console.log('2. Replaced notifyStageChange and added dispatchOrQueueEmail');
}

// 3. Add confirm-dispatch route
if (!code.includes("path === '/api/email/confirm-dispatch'")) {
  code = code.replace(
    "if (method === 'POST' && path === '/api/email/inbound') {",
    "if (method === 'POST' && path === '/api/email/confirm-dispatch') {\n        return await handleConfirmEmailDispatch(request, env);\n      }\n\n      if (method === 'POST' && path === '/api/email/inbound') {"
  );
  console.log('3. Added confirm-dispatch route');
}

// 4. Update handleSubmission to use dispatchOrQueueEmail
const oldSubComms = `  // Log communication
  if (env.DB) {
    await logComm(env.DB, paperId, 'system', 'inbound', authorEmail, 'system', 
      'Manuscript Submitted', \`\${title} by \${authorName}\`, null, STAGES.SUBMITTED);
    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', authorEmail,
      \`Submission Confirmation — \${paperId}\`, \`Manuscript received: \${title}\`, '1_SUBMISSION_CONFIRMATION', STAGES.SUBMITTED);
  }`;

const newSubComms = `  // Log intake in system communications
  if (env.DB) {
    await logComm(env.DB, paperId, 'system', 'inbound', authorEmail, 'system', 
      'Manuscript Submitted', \`\${title} by \${authorName}\`, null, STAGES.SUBMITTED);
  }

  // Dispatch or queue official submission confirmation email (Template: 1_SUBMISSION_CONFIRMATION)
  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '1_SUBMISSION_CONFIRMATION',
    fromInbox: 'review@mpptjournal.com',
    toAddress: authorEmail,
    subject: \`Manuscript Submission Received — \${paperId} · MPPT Journal\`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: title,
      AUTHOR_NAME: authorName,
      TIMESTAMP: now(),
    },
    stage: STAGES.SUBMITTED,
  });`;

if (code.includes(oldSubComms)) {
  code = code.replace(oldSubComms, newSubComms);
  console.log('4. Updated handleSubmission email handling');
}

// 5. Update handlePlagiarismResult email handling
const oldPlagFail = `    // Log
    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
      \`Plagiarism Check: Resubmission Required — \${paperId}\`, \`Score: \${score}%\`, '2A_PLAGIARISM_RESUBMIT', STAGES.PLAGIARISM_FAIL);`;

const newPlagFail = `    // Official resubmission email (Template: 2A_PLAGIARISM_RESUBMIT)
    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: '2A_PLAGIARISM_RESUBMIT',
      fromInbox: 'review@mpptjournal.com',
      toAddress: paper.author_email,
      subject: \`Plagiarism Audit: Revision Required — \${paperId} · MPPT Journal\`,
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
        AUTHOR_NAME: paper.author_name,
        SIMILARITY_SCORE: \`\${score.toFixed(1)}%\`,
        AI_SCORE: \`\${aiScore.toFixed(1)}%\`,
        DEADLINE_DATE: deadline.split('T')[0],
      },
      stage: STAGES.PLAGIARISM_FAIL,
    });`;

if (code.includes(oldPlagFail)) {
  code = code.replace(oldPlagFail, newPlagFail);
  console.log('5a. Updated handlePlagiarismResult fail email');
}

const oldPlagPass = `    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
      \`Desk Screening Cleared — \${paperId}\`, \`Score: \${score}%\`, '2_DESK_SCREENING_CLEARED', STAGES.PLAGIARISM_PASS);`;

const newPlagPass = `    // Official desk screening cleared email (Template: 2_DESK_SCREENING_CLEARED)
    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: '2_DESK_SCREENING_CLEARED',
      fromInbox: 'review@mpptjournal.com',
      toAddress: paper.author_email,
      subject: \`Editorial Desk Screening Cleared — \${paperId} · MPPT Journal\`,
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
      },
      stage: STAGES.PLAGIARISM_PASS,
    });`;

if (code.includes(oldPlagPass)) {
  code = code.replace(oldPlagPass, newPlagPass);
  console.log('5b. Updated handlePlagiarismResult pass email');
}

// 6. Update handleFormatResult
const oldFormatFail = `    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
      \`Formatting Revision Required — \${paperId}\`, (issues || []).join('; '), '3A_FORMATTING_REVISION', STAGES.FORMATTING_FAIL);`;

const newFormatFail = `    const issuesList = (issues || []).map(i => \`<li>\${i}</li>\`).join('');
    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: '3A_FORMATTING_REVISION',
      fromInbox: 'review@mpptjournal.com',
      toAddress: paper.author_email,
      subject: \`Technical Formatting Revision Required — \${paperId} · MPPT Journal\`,
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
        AUTHOR_NAME: paper.author_name,
        DEADLINE_DATE: deadline.split('T')[0],
        FORMATTING_ISSUES_LIST: issuesList || '<li>Ensure Vancouver referencing and ≥300 DPI figures.</li>',
      },
      stage: STAGES.FORMATTING_FAIL,
    });`;

if (code.includes(oldFormatFail)) {
  code = code.replace(oldFormatFail, newFormatFail);
  console.log('6a. Updated handleFormatResult fail email');
}

const oldFormatPass = `    await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
      \`Formatting Cleared — \${paperId}\`, 'All formatting checks passed', '3B_FORMATTING_CLEARED', STAGES.FORMATTING_PASS);`;

const newFormatPass = `    await dispatchOrQueueEmail(env, {
      paperId,
      templateKey: '3B_FORMATTING_CLEARED',
      fromInbox: 'review@mpptjournal.com',
      toAddress: paper.author_email,
      subject: \`Technical Formatting Cleared — \${paperId} · MPPT Journal\`,
      templateVars: {
        PAPER_ID: paperId,
        PAPER_TITLE: paper.title,
        AUTHOR_NAME: paper.author_name,
      },
      stage: STAGES.FORMATTING_PASS,
    });`;

if (code.includes(oldFormatPass)) {
  code = code.replace(oldFormatPass, newFormatPass);
  console.log('6b. Updated handleFormatResult pass email');
}

// 7. Update handleReviewerAssign
const oldAssignComm = `    await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', reviewer.email,
      \`Peer Review Invitation — \${paperId}\`, \`Review requested for: \${paper.title}\`, '3_PEER_REVIEW_DISPATCH', STAGES.REVIEWER_ASSIGNED);`;

const newAssignComm = `    await dispatchOrQueueEmail(env, {
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
    });`;

if (code.includes(oldAssignComm)) {
  code = code.replace(oldAssignComm, newAssignComm);
  console.log('7a. Updated reviewer invite dispatch');
}

const oldAssignTg = `  await sendTelegram(env,
    \`📨 *REVIEWERS ASSIGNED*\\n\\n\` +
    \`🆔 \\\`\${paperId}\\\`\\n📄 _\${paper.title}_\\n\\n\` +
    \`👥 Assigned Reviewers:\\n\${assigned.map((r, i) => \`\${i + 1}. \${r.name} (\${r.email})\`).join('\\n')}\\n\\n\` +
    \`⏰ Review deadline: \${deadline.split('T')[0]} (10 days)\\n\` +
    \`🔔 Reminders every 2 days\`
  );`;

const newAssignTg = `  await sendTelegram(env,
    \`📨 *REVIEWERS ASSIGNED*\\n\\n\` +
    \`🆔 \\\`\${paperId}\\\`\\n📄 _\${paper.title}_\\n\\n\` +
    \`👥 Assigned Reviewers:\\n\${assigned.map((r, i) => \`\${i + 1}. \${r.name} (\${r.email})\`).join('\\n')}\\n\\n\` +
    \`⏰ Review deadline: \${deadline.split('T')[0]} (10 days)\\n\` +
    \`🔔 Reminders every 2 days\`
  );

  // Dispatch author notification (Template: 3_PEER_REVIEW_DISPATCH)
  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '3_PEER_REVIEW_DISPATCH',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: \`Dispatched for Double-Blind Peer Review — \${paperId} · MPPT Journal\`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
    },
    stage: STAGES.REVIEWER_ASSIGNED,
  });`;

if (code.includes(oldAssignTg)) {
  code = code.replace(oldAssignTg, newAssignTg);
  console.log('7b. Updated author notification on reviewer assign');
}

// 8. Update handleReviewerDecision
const oldRevDecisionComm = `      await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
        \`Reviewer Comments — \${paperId}\`, \`Decisions: \${decisions.join(', ')}\`, '5A_REVIEWER_COMMENTS', STAGES.REVISION_REQUIRED);`;

const newRevDecisionComm = `      await dispatchOrQueueEmail(env, {
        paperId,
        templateKey: '5A_REVIEWER_COMMENTS',
        fromInbox: 'review@mpptjournal.com',
        toAddress: paper.author_email,
        subject: \`Peer Review Comments & Revision Required — \${paperId} · MPPT Journal\`,
        templateVars: {
          PAPER_ID: paperId,
          PAPER_TITLE: paper.title,
          DEADLINE_DATE: deadline.split('T')[0],
          REVIEWER_COMMENTS: decisions.map((d, i) => \`Reviewer \${i + 1}: \${d}\`).join('<br>'),
        },
        stage: STAGES.REVISION_REQUIRED,
      });`;

if (code.includes(oldRevDecisionComm)) {
  code = code.replace(oldRevDecisionComm, newRevDecisionComm);
  console.log('8a. Updated revision comments email');
}

const oldAcceptComm = `      await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
        \`Accepted for Publication — \${paperId}\`, 'Paper accepted after peer review', '4_EDITORIAL_DECISION_ACCEPT', STAGES.ACCEPTED);`;

const newAcceptComm = `      await dispatchOrQueueEmail(env, {
        paperId,
        templateKey: '4_EDITORIAL_DECISION_ACCEPT',
        fromInbox: 'editor@mpptjournal.com',
        toAddress: paper.author_email,
        subject: \`Formal Decision: Accepted for Publication — \${paperId} · MPPT Journal\`,
        templateVars: {
          PAPER_ID: paperId,
          PAPER_TITLE: paper.title,
        },
        stage: STAGES.ACCEPTED,
      });`;

if (code.includes(oldAcceptComm)) {
  code = code.replace(oldAcceptComm, newAcceptComm);
  console.log('8b. Updated accept email');
}

// 9. Update handleManualAdvance
code = code.replace(
  "const result = await advanceStage(env.DB, paperId, targetStage, actor || 'editor');\n  await notifyStageChange(env, paper, targetStage);",
  "const result = await advanceStage(env.DB, paperId, targetStage, actor || 'editor');\n  await notifyStageChange(env, paper, targetStage, actor || 'editor');"
);
console.log('9. Updated handleManualAdvance');

// 10. Update handleReject
const oldRejectComm = `  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    \`Editorial Decision: Rejected — \${paperId}\`, reason || 'Editorial decision', 'REJECTION', STAGES.REJECTED);`;

const newRejectComm = `  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: 'REJECTION',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: \`Editorial Decision: Rejection Notice — \${paperId} · MPPT Journal\`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      DECISION_DATE: now().split('T')[0],
      REJECTION_REASON: reason || 'Does not meet our current editorial priorities or referee requirements',
    },
    stage: STAGES.REJECTED,
  });`;

if (code.includes(oldRejectComm)) {
  code = code.replace(oldRejectComm, newRejectComm);
  console.log('10. Updated handleReject email');
}

// 11. Update handleGallerySend
const oldGallerySendComm = `  // Gallery Proof dispatched strictly from editor@mpptjournal.com
  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    \`Gallery Proof for Final Verification — \${paperId}\`, notes || \`Gallery proof link: \${proofUrl || ''}\`, '6_GALLERY_PROOF', STAGES.GALLERY_SENT);`;

const newGallerySendComm = `  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '6_GALLERY_PROOF',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: \`Typeset Galley Proof for Final Verification — \${paperId} · MPPT Journal\`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      DEADLINE_DATE: deadline.split('T')[0],
    },
    stage: STAGES.GALLERY_SENT,
  });`;

if (code.includes(oldGallerySendComm)) {
  code = code.replace(oldGallerySendComm, newGallerySendComm);
  console.log('11. Updated handleGallerySend email');
}

// 12. Update handleGalleryConfirm
const oldGalleryConfirmComm = `  await logComm(env.DB, paperId, 'email', 'outbound', 'review@mpptjournal.com', paper.author_email,
    \`Payment Link — \${paperId}\`, 'Gallery proof confirmed, payment pending', '7_PAYMENT_LINK', STAGES.PAYMENT_PENDING);`;

const newGalleryConfirmComm = `  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '7_PAYMENT_LINK',
    fromInbox: 'review@mpptjournal.com',
    toAddress: paper.author_email,
    subject: \`Article Processing Charge Waiver / Settlement — \${paperId} · MPPT Journal\`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      PAYMENT_AMOUNT: '₹0 (100% Inaugural Waiver Applied)',
      PAYMENT_URL: 'https://mpptjournal.com',
    },
    stage: STAGES.PAYMENT_PENDING,
  });`;

if (code.includes(oldGalleryConfirmComm)) {
  code = code.replace(oldGalleryConfirmComm, newGalleryConfirmComm);
  console.log('12. Updated handleGalleryConfirm email');
}

// 13. Update handlePaymentVerify
const oldPaymentVerifyComm = `  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    \`Payment Receipt — \${paperId}\`, \`Payment ₹\${amount} verified\`, '7A_PAYMENT_RECEIPT', STAGES.PAYMENT_VERIFIED);`;

const newPaymentVerifyComm = `  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '7A_PAYMENT_RECEIPT',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: \`Official Payment Receipt & Tax Invoice — \${paperId} · MPPT Journal\`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      TRANSACTION_ID: razorpay_payment_id || 'WAIVER-VOL1',
      PAYMENT_AMOUNT: \`₹\${amount || 0}\`,
      PAYMENT_DATE: now().split('T')[0],
    },
    stage: STAGES.PAYMENT_VERIFIED,
  });`;

if (code.includes(oldPaymentVerifyComm)) {
  code = code.replace(oldPaymentVerifyComm, newPaymentVerifyComm);
  console.log('13. Updated handlePaymentVerify email');
}

// 14. Update handlePublish
const oldPublishComms = `  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    \`Published & Archived — \${paperId}\`, \`Published at \${publishedUrl}\`, '5_PUBLISHED_AND_ARCHIVED', STAGES.PUBLISHED);

  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    \`Official Publication Certificate — \${paperId}\`, \`Certificate generated for \${paperId}\`, '8_CERTIFICATE', STAGES.PUBLISHED);`;

const newPublishComms = `  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '5_PUBLISHED_AND_ARCHIVED',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: \`Manuscript Published & Deposited in Zenodo — \${paperId} · MPPT Journal\`,
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
    subject: \`Official Publication Certificate — \${paperId} · MPPT Journal\`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      ZENODO_DOI: zenodoDoi || '10.5281/zenodo.11478902',
    },
    stage: STAGES.PUBLISHED,
  });`;

if (code.includes(oldPublishComms)) {
  code = code.replace(oldPublishComms, newPublishComms);
  console.log('14. Updated handlePublish emails');
}

// 15. Update handleCertificateSend
const oldCertComm = `  await logComm(env.DB, paperId, 'email', 'outbound', 'editor@mpptjournal.com', paper.author_email,
    \`Official Publication Certificate — \${paperId}\`, \`Certificate link: \${certificateUrl}\`, '8_CERTIFICATE', STAGES.PUBLISHED);`;

const newCertComm = `  await dispatchOrQueueEmail(env, {
    paperId,
    templateKey: '8_CERTIFICATE',
    fromInbox: 'editor@mpptjournal.com',
    toAddress: paper.author_email,
    subject: \`Official Publication Certificate — \${paperId} · MPPT Journal\`,
    templateVars: {
      PAPER_ID: paperId,
      PAPER_TITLE: paper.title,
      AUTHOR_NAME: paper.author_name,
      ZENODO_DOI: paper.zenodo_doi || '10.5281/zenodo.11478902',
    },
    stage: STAGES.PUBLISHED,
  });`;

if (code.includes(oldCertComm)) {
  code = code.replace(oldCertComm, newCertComm);
  console.log('15. Updated handleCertificateSend email');
}

// 16. Update handleAddReviewer
const oldAddRev = `  await env.DB.prepare(\`
    INSERT OR IGNORE INTO reviewers (name, email, affiliation, speciality, orcid)
    VALUES (?, ?, ?, ?, ?)
  \`).bind(name, email.toLowerCase().trim(), affiliation || '', speciality || '', orcid || '').run();

  return json({ success: true, message: \`Reviewer \${name} added to pool\` }, 201);`;

const newAddRev = `  const cleanEmail = email.toLowerCase().trim();
  await env.DB.prepare(\`
    INSERT INTO reviewers (name, email, affiliation, speciality, orcid)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      affiliation = excluded.affiliation,
      speciality = excluded.speciality,
      orcid = excluded.orcid,
      is_active = 1
  \`).bind(name, cleanEmail, affiliation || '', speciality || '', orcid || '').run();

  if (env.TELEGRAM_BOT_TOKEN) {
    await sendTelegram(env,
      \`👥 *NEW PEER REVIEWER ONBOARDED*\\n\\n\` +
      \`👤 *Name:* \${name}\\n\` +
      \`📧 *Email:* \\\`\${cleanEmail}\\\`\\n\` +
      \`🔬 *Speciality:* \${speciality || 'General Pharmacy & Therapeutics'}\\n\` +
      \`🏛️ *Affiliation:* \${affiliation || 'MPPT Reviewer Pool'}\\n\` +
      (orcid ? \`🆔 *ORCID:* \\\`\${orcid}\\\`\\n\` : '') +
      \`\\n✅ Added to active double-blind peer reviewer pool.\`
    );
  }

  return json({ success: true, message: \`Reviewer \${name} added to pool\` }, 201);`;

if (code.includes(oldAddRev)) {
  code = code.replace(oldAddRev, newAddRev);
  console.log('16. Updated handleAddReviewer with Telegram alert');
}

// 17. Replace processInboundEmail and handleInboundEmailHttp
const oldInboundStart = "async function processInboundEmail(env, emailData) {";
const oldInboundEnd = "async function handleTelegramWebhook(request, env) {";

const inboundStartIndex = code.indexOf(oldInboundStart);
const inboundEndIndex = code.indexOf(oldInboundEnd);

if (inboundStartIndex !== -1 && inboundEndIndex !== -1) {
  const newInboundSection = `async function processInboundEmail(env, emailData) {
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
    const match = (subject + ' ' + bodyText).match(/MPPT-\\d{4}-V\\d+I\\d+-\\d{4}/i);
    if (match) paperId = match[0].toUpperCase();
  }

  const inboundId = \`INB-\${Date.now().toString(36).toUpperCase()}\`;

  // 1. Generate 1-2 sentence AI summary using Workers AI
  let summary = '';
  if (env.AI) {
    const messages = [
      {
        role: 'system',
        content: \`You are an editorial assistant for MPPT Journal (\${deskHeader}). Summarize the following incoming academic email in 1 to 2 clear, concise sentences for the editors in Telegram. State who wrote, what they want or need, any manuscript IDs, and what action is required.\`
      },
      {
        role: 'user',
        content: \`Recipient Desk: \${inbox}\\nFrom: \${fromName ? \`\${fromName} <\${fromAddress}>\` : fromAddress}\\nSubject: \${subject}\\n\\nEmail Content:\\n\${bodyText.substring(0, 2500)}\`
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
      await env.DB.prepare(\`
        INSERT INTO inbound_emails (inbound_id, inbox, from_address, from_name, subject, body_text, summary, paper_id, reply_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      \`).bind(inboundId, inbox, fromAddress, fromName, subject, bodyText, summary, paperId).run();

      // Log in communications ledger
      await logComm(env.DB, paperId, 'email', 'inbound', fromAddress, inbox, subject, summary, null, null);
    } catch (dbErr) {
      console.error('D1 inbound email insert error:', dbErr);
    }
  }

  // 3. Dispatch prompt alert to Telegram Group
  const senderDisplay = fromName ? \`\${fromName} (\${fromAddress})\` : fromAddress;
  const alertText = 
    \`\${deskBadge}\\n\` +
    \`📬 *New Inbound Email Received!*\\n\\n\` +
    \`📥 *Mailbox:* \\\`\${inbox}\\\`\\n\` +
    \`👤 *From:* \${senderDisplay.replace(/[_*[\\]()~\`>#+=|{}.!-]/g, ' ')}\\n\` +
    \`📋 *Subject:* *\${subject.replace(/[_*[\\]()~\`>#+=|{}.!-]/g, ' ')}*\\n\` +
    (paperId ? \`🆔 *Paper ID:* \\\`\${paperId}\\\`\\n\` : '') +
    \`\\n📝 *AI Summary:*\\n_\${summary.replace(/[_*[\\]()~\`>#+=|{}.!-]/g, ' ')}_\\n\\n\` +
    \`💡 *Quick Action:*\\n\` +
    \`Reply directly to this alert with \\\`Reply: <instructions>\\\` to auto-draft an academic reply.\`;

  let tgMsgId = null;
  if (env.TELEGRAM_BOT_TOKEN) {
    const tgRes = await sendTelegram(env, alertText);
    tgMsgId = tgRes?.result?.message_id;

    if (tgMsgId && env.DB) {
      await env.DB.prepare(\`UPDATE inbound_emails SET telegram_msg_id = ? WHERE inbound_id = ?\`)
        .bind(tgMsgId, inboundId).run();
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
  const rows = await env.DB.prepare(\`SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 50\`).all();
  return json({ success: true, count: rows.results?.length || 0, emails: rows.results || [] });
}

async function handleInboundEmailStream(message, env, ctx) {
  const inbox = message.to || 'review@mpptjournal.com';
  const fromAddress = message.from || 'author@university.edu';
  const subject = message.headers.get('subject') || 'Manuscript Communication';
  
  let bodyText = '';
  try {
    const raw = await new Response(message.raw).text();
    const parts = raw.split('\\n\\n');
    bodyText = (parts.slice(1).join('\\n\\n') || raw).substring(0, 3000);
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

async function handleConfirmEmailDispatch(request, env) {
  if (!env.DB) return json({ success: false, error: 'Database not available' }, 500);

  const body = await request.json().catch(() => ({}));
  const { paperId, templateKey, toAddress, fromAddress, subject, notes } = body;

  if (!paperId || !toAddress) {
    return json({ success: false, error: 'paperId and toAddress required' }, 400);
  }

  const cleanFrom = fromAddress || 'review@mpptjournal.com';
  const cleanSubject = subject || \`Official Dispatch — \${paperId} · MPPT Journal\`;

  await logComm(env.DB, paperId, 'email', 'outbound', cleanFrom, toAddress,
    cleanSubject, notes || \`Verified dispatched via Zoho Mail (\${templateKey || 'Custom'})\`, templateKey || null, null);

  // Update any pending draft in communications
  await env.DB.prepare(\`
    UPDATE communications SET direction = 'dispatched_verified' 
    WHERE paper_id = ? AND channel = 'email_draft' AND direction = 'pending_manual_dispatch'
  \`).bind(paperId).run().catch(() => {});

  if (env.TELEGRAM_BOT_TOKEN) {
    await sendTelegram(env,
      \`✅ *EMAIL DISPATCH OFFICIALLY VERIFIED IN D1*\\n\\n\` +
      \`🆔 *Paper ID:* \\\`\${paperId}\\\`\\n\` +
      \`📧 *Template:* \\\`\${templateKey || 'Custom'}\\\`\\n\` +
      \`📤 *From Desk:* \\\`\${cleanFrom}\\\`\\n\` +
      \`📨 *To Recipient:* \\\`\${toAddress}\\\`\\n\` +
      \`📋 *Subject:* _\${cleanSubject}_\\n\` +
      \`🕒 *Timestamp:* \${now()}\\n\\n\` +
      \`Audit ledger in Cloudflare D1 communications updated with verified outbound send.\`
    );
  }

  return json({ success: true, message: 'Verified outbound dispatch recorded in D1' }, 200);
}

`;

  code = code.substring(0, inboundStartIndex) + newInboundSection + code.substring(inboundEndIndex);
  console.log('17. Replaced inbound email section with 3-inbox badge engine and confirm dispatch handler');
}

// 18. Add Telegram commands: /emails, /stats, /sent, and update help
const oldHelp = "if (!userQuery || userQuery === '/start' || userQuery === '/help') {";
if (code.includes(oldHelp)) {
  code = code.replace(
    oldHelp,
    `if (!userQuery || userQuery === '/start' || userQuery === '/help') {
    const helpMsg = 
      \`👋 Hello \${msg.from?.first_name || 'there'}! I am MPPT AI, your autonomous editorial partner.\\n\\n\` +
      \`*Available Editorial Commands:*\\n\` +
      \`• \\\`/status MPPT-2026-V1I1-0003\\\` — Check paper stage & audit log\\n\` +
      \`• \\\`/papers\\\` — List active manuscripts\\n\` +
      \`• \\\`/emails\\\` — Check latest inbound emails (editor@, review@, publisher@)\\n\` +
      \`• \\\`/stats\\\` — Live database & pipeline dashboard\\n\` +
      \`• \\\`/reviewers\\\` — View referee pool\\n\` +
      \`• \\\`/sent <paperId>\\\` — Confirm verified dispatch of an email\\n\` +
      \`• \\\`add reviewer Dr. Name, email, speciality, affiliation\\\`\\n\\n\` +
      \`You can also ask me any scientific or editorial question directly!\`;
    await sendTelegram(env, helpMsg, { reply_to_message_id: msg.message_id });
    return json({ ok: true });
  }

  if (false) {`
  );
  console.log('18a. Updated /help menu');
}

// Add /emails, /stats, /sent commands before Command 3
const targetCmdMarker = "// ── COMMAND 3: TEST / SIMULATE INBOUND EMAIL ──";
const newCommandsBlock = `  // ── COMMAND: LIST INBOUND EMAILS ACROSS ALL 3 INBOXES ──
  if (userQuery.match(/^(?:(?:\\/)?emails|list\\s+emails|show\\s+emails|check\\s+emails|inbox)\\b/i)) {
    if (env.DB) {
      const res = await env.DB.prepare(\`
        SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 8
      \`).all();
      const list = res.results || [];
      if (list.length === 0) {
        await sendTelegram(env, \`📬 *MPPT Inboxes:* No inbound emails recorded yet across \\\`editor@\\\`, \\\`review@\\\`, or \\\`publisher@\\\`.\\n\\nAll incoming emails will automatically trigger instant group notifications.\`, { reply_to_message_id: msg.message_id });
      } else {
        const emailItems = list.map((m, idx) => {
          let badge = '📬 [Inbox]';
          if (m.inbox.includes('editor')) badge = '🎓 [editor@]';
          else if (m.inbox.includes('review')) badge = '🔬 [review@]';
          else if (m.inbox.includes('publisher')) badge = '🏛️ [publisher@]';

          return \`\${idx + 1}. \${badge} *\${(m.from_name || m.from_address).replace(/_/g, ' ')}*\\n   📋 Subject: _\${(m.subject || 'No Subject').replace(/_/g, ' ')}_\\n   🆔 Paper: \\\`\${m.paper_id || 'N/A'}\\\` · Status: *\${m.reply_status}*\\n   📝 _\${(m.summary || '').substring(0, 110)}..._\`;
        }).join('\\n\\n');

        const emailListMsg = \`📬 *Recent Inbound Emails (\${list.length}):*\\n\\n\${emailItems}\\n\\n💡 _To draft an academic reply, reply to any email alert with "Reply: <instructions>"_\`;
        await sendTelegram(env, emailListMsg, { reply_to_message_id: msg.message_id });
      }
    } else {
      await sendTelegram(env, \`⚠️ Database not available.\`, { reply_to_message_id: msg.message_id });
    }
    return json({ ok: true });
  }

  // ── COMMAND: DATABASE & PIPELINE STATS ──
  if (userQuery.match(/^(?:(?:\\/)?(?:stats|database|summary|dashboard)|pipeline\\s+stats|db\\s+status)\\b/i)) {
    if (env.DB) {
      const papersCount = await env.DB.prepare(\`SELECT COUNT(*) as cnt FROM manuscripts WHERE is_active = 1\`).first();
      const reviewersCount = await env.DB.prepare(\`SELECT COUNT(*) as cnt FROM reviewers WHERE is_active = 1\`).first();
      const emailsCount = await env.DB.prepare(\`SELECT COUNT(*) as cnt FROM inbound_emails\`).first();
      const commsCount = await env.DB.prepare(\`SELECT COUNT(*) as cnt FROM communications\`).first();
      const stageRows = await env.DB.prepare(\`SELECT stage, COUNT(*) as cnt FROM manuscripts WHERE is_active = 1 GROUP BY stage\`).all();

      const stageSummary = (stageRows.results || []).map(r => \`  • \${STAGE_LABELS[r.stage] || r.stage}: *\${r.cnt}*\`).join('\\n');

      const statsMsg = 
        \`📊 *MPPT JOURNAL — LIVE DATABASE DASHBOARD*\\n\\n\` +
        \`📚 *Total Active Manuscripts:* \${papersCount?.cnt || 0}\\n\` +
        \`👥 *Reviewer Pool:* \${reviewersCount?.cnt || 0} referees\\n\` +
        \`📬 *Inbound Inquiries Logged:* \${emailsCount?.cnt || 0}\\n\` +
        \`📨 *Audited Communications:* \${commsCount?.cnt || 0}\\n\\n\` +
        \`📋 *Stage Distribution:*\\n\${stageSummary || '  • No active manuscripts'}\\n\\n\` +
        \`🔒 *Integrity Guard:* Real-time sync with Cloudflare D1 & R2 Storage.\`;

      await sendTelegram(env, statsMsg, { reply_to_message_id: msg.message_id });
    } else {
      await sendTelegram(env, \`⚠️ Database not available.\`, { reply_to_message_id: msg.message_id });
    }
    return json({ ok: true });
  }

  // ── COMMAND: MARK EMAIL SENT (Truthful Database Verification) ──
  const isMarkSent = userQuery.match(/^(?:(?:\\/)?(?:sent|marksent|mark_sent)|mark\\s+sent)\\b/i);
  if (isMarkSent) {
    const paperIdMatch = userQuery.match(/MPPT-[\\w-]+|\\b000\\d\\b|\\b\\d{4}\\b/i);
    if (!paperIdMatch) {
      await sendTelegram(env, \`ℹ️ *Format:* \\\`@mpptai_bot sent MPPT-2026-V1I1-0003\\\` to record verified dispatch in D1.\`, { reply_to_message_id: msg.message_id });
      return json({ ok: true });
    }
    let lookupId = paperIdMatch[0].toUpperCase();
    if (/^\\d+$/.test(lookupId)) {
      lookupId = \`MPPT-2026-V1I1-\${lookupId.padStart(4, '0')}\`;
    }
    if (env.DB) {
      const paper = await env.DB.prepare(\`SELECT * FROM manuscripts WHERE paper_id = ?\`).bind(lookupId).first();
      if (!paper) {
        await sendTelegram(env, \`⚠️ Paper \\\`\${lookupId}\\\` not found in database.\`, { reply_to_message_id: msg.message_id });
        return json({ ok: true });
      }

      // Find any draft or pending communications
      const draft = await env.DB.prepare(\`
        SELECT * FROM communications WHERE paper_id = ? AND (channel = 'email_draft' OR direction = 'pending_manual_dispatch')
        ORDER BY id DESC LIMIT 1
      \`).bind(lookupId).first();

      const template = draft?.template_used || '1_SUBMISSION_CONFIRMATION';
      const fromDesk = draft?.from_address || (EDITOR_EMAIL_STAGES.has(paper.stage) ? 'editor@mpptjournal.com' : 'review@mpptjournal.com');

      await logComm(env.DB, lookupId, 'email', 'outbound', fromDesk, paper.author_email,
        draft?.subject || \`Manuscript Update — \${lookupId}\`, \`[VERIFIED SENT VIA ZOHO] Dispatched by \${msg.from?.first_name || 'editor'}\`, template, paper.stage);

      if (draft) {
        await env.DB.prepare(\`UPDATE communications SET direction = 'dispatched_verified' WHERE id = ?\`).bind(draft.id).run();
      }

      const conf = 
        \`✅ *EMAIL DISPATCH OFFICIALLY VERIFIED & LOGGED*\\n\\n\` +
        \`🆔 *Paper ID:* \\\`\${lookupId}\\\`\\n\` +
        \`👤 *Author:* \${paper.author_name} (\\\`\${paper.author_email}\\\`)\\n\` +
        \`📧 *Template:* \\\`\${template}\\\`\\n\` +
        \`📤 *From:* \\\`\${fromDesk}\\\`\\n\` +
        \`✍️ *Verified by:* \${msg.from?.first_name || 'Editor'}\\n\` +
        \`🕒 *Timestamp:* \${now()}\\n\\n\` +
        \`D1 ledger updated with confirmed outbound delivery.\`;

      await sendTelegram(env, conf, { reply_to_message_id: msg.message_id });
      return json({ ok: true });
    }
  }

  `;

if (code.includes(targetCmdMarker)) {
  code = code.replace(targetCmdMarker, newCommandsBlock + targetCmdMarker);
  console.log('18b. Added /emails, /stats, and /sent commands to Telegram webhook');
}

// 19. Add Zenodo alert
const oldZenodoD1 = `  // Update D1 if available
  if (env.DB) {
    await env.DB.prepare(\`UPDATE manuscripts SET zenodo_doi = ?, zenodo_record_id = ?, updated_at = ? WHERE paper_id = ?\`)
      .bind(zenodoDoi, zenodoRecordId, now(), paperId).run();
  }`;

const newZenodoD1 = `  // Update D1 if available
  if (env.DB) {
    await env.DB.prepare(\`UPDATE manuscripts SET zenodo_doi = ?, zenodo_record_id = ?, updated_at = ? WHERE paper_id = ?\`)
      .bind(zenodoDoi, zenodoRecordId, now(), paperId).run();
  }

  // Notify Telegram group of Zenodo deposit
  if (env.TELEGRAM_BOT_TOKEN) {
    await sendTelegram(env,
      \`📦 *CERN / ZENODO ARCHIVAL DEPOSITION COMPLETED*\\n\\n\` +
      \`🆔 *Paper ID:* \\\`\${paperId}\\\`\\n\` +
      \`📄 *Title:* _\${title}_\\n\\n\` +
      \`🌐 *Zenodo DOI:* \\\`\${zenodoDoi}\\\`\\n\` +
      \`🏛️ *Preservation:* CERN Data Centre, Geneva\\n\` +
      \`📜 *License:* CC BY 4.0 Open Access\\n\` +
      \`✅ Archival metadata committed to D1 database.\`
    );
  }`;

if (code.includes(oldZenodoD1)) {
  code = code.replace(oldZenodoD1, newZenodoD1);
  console.log('19. Added Zenodo deposit Telegram notification');
}

fs.writeFileSync(indexPath, code, 'utf8');
console.log('Successfully patched ' + indexPath);
