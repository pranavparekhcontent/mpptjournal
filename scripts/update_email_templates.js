const fs = require('fs');
const path = require('path');

const templates14 = [
  '1_SUBMISSION_CONFIRMATION.html',
  '2_DESK_SCREENING_CLEARED.html',
  '2A_PLAGIARISM_RESUBMIT.html',
  '3_PEER_REVIEW_DISPATCH.html',
  '3A_FORMATTING_REVISION.html',
  '3B_FORMATTING_CLEARED.html',
  '4_EDITORIAL_DECISION_ACCEPT.html',
  '5_PUBLISHED_AND_ARCHIVED.html',
  '5A_REVIEWER_COMMENTS.html',
  '6_GALLERY_PROOF.html',
  '7_PAYMENT_LINK.html',
  '7A_PAYMENT_RECEIPT.html',
  '8_CERTIFICATE.html',
  'REJECTION.html'
];

const targetHtml = `  <div class="header">
    <div class="journal-title">Journal of Modern Pharmacy Praxis &amp; Therapeutics</div>
    <div class="journal-sub">Official Continuous Publication Journal · Pune, Maharashtra, India</div>
  </div>`;

const replHtml = `  <div class="header">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
      <tr>
        <td align="center" valign="middle" style="padding-bottom: 12px;">
          <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin: 0 auto;">
            <tr>
              <td valign="middle" style="padding-right: 16px; vertical-align: middle;">
                <a href="https://mpptjournal.com" target="_blank" style="text-decoration: none; display: inline-block;">
                  <img src="https://mpptjournal.com/logo/logo.png" alt="MPPT Journal Official Seal" width="56" height="56" style="display: block; width: 56px; height: 56px; border-radius: 50%; border: 1.5px solid #a8874f; box-shadow: 0 2px 8px rgba(140,59,59,0.16); -ms-interpolation-mode: bicubic;" />
                </a>
              </td>
              <td valign="middle" align="left" style="vertical-align: middle; text-align: left; line-height: 1.15;">
                <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; font-style: italic; color: #8c3b3b; margin: 0; line-height: 1.15;">Journal of</div>
                <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 19px; font-weight: bold; color: #1c1812; letter-spacing: 0.04em; text-transform: uppercase; margin: 1px 0; line-height: 1.15;">MODERN PHARMACY</div>
                <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-weight: 600; color: #1c1812; letter-spacing: 0.03em; text-transform: uppercase; margin: 0; line-height: 1.15;">PRAXIS <span style="font-style: italic; font-weight: 400; color: #8c3b3b;">&amp;</span> THERAPEUTICS</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center" style="font-family: 'Courier New', Courier, monospace, sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #8a7f6c; padding-top: 4px;">
          Official Continuous Publication Journal · Pune, Maharashtra, India
        </td>
      </tr>
    </table>
  </div>`;

templates14.forEach(f => {
  const filePath = path.join(__dirname, '..', 'email_templates', f);
  let content = fs.readFileSync(filePath, 'utf8');
  const isCrlf = content.includes('\r\n');
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.includes(targetHtml)) {
    console.error('Target not found in', f);
    return;
  }
  let updated = normalized.replace(targetHtml, replHtml);
  updated = updated.replace('.header { padding:28px 32px 20px;', '.header { padding:24px 24px 18px;');
  if (isCrlf) {
    updated = updated.replace(/\n/g, '\r\n');
  }
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log('Successfully updated:', f);
});

// Now update INVITATION_ADVISORY_BOARD.html and INVITATION_REVIEWER.html
const inviteFiles = ['INVITATION_ADVISORY_BOARD.html', 'INVITATION_REVIEWER.html'];

const inviteTarget = `                <td align="center">
                  <div style="font-family: 'Georgia', Cambria, 'Times New Roman', serif; font-size: 23px; font-weight: bold; color: #8c3b3b; letter-spacing: 0.01em; line-height: 1.25; margin-bottom: 6px;">
                    Journal of Modern Pharmacy Praxis &amp; Therapeutics
                  </div>
                  <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #736959; margin-bottom: 10px;">
                    MPPT JOURNAL · ISSN (PENDING) · OPEN ACCESS · QUARTERLY
                  </div>`;

const inviteRepl = `                <td align="center">
                  <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-style: italic; color: #8c3b3b; margin: 0; line-height: 1.15;">Journal of</div>
                  <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 21px; font-weight: bold; color: #1c1812; letter-spacing: 0.04em; text-transform: uppercase; margin: 2px 0; line-height: 1.15;">MODERN PHARMACY</div>
                  <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 17.5px; font-weight: 600; color: #1c1812; letter-spacing: 0.03em; text-transform: uppercase; margin: 0 0 10px 0; line-height: 1.15;">PRAXIS <span style="font-style: italic; font-weight: 400; color: #8c3b3b;">&amp;</span> THERAPEUTICS</div>
                  <div style="font-family: 'Courier New', Courier, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #736959; margin-bottom: 10px;">
                    MPPT JOURNAL · ISSN (PENDING) · OPEN ACCESS · QUARTERLY
                  </div>`;

inviteFiles.forEach(f => {
  const filePath = path.join(__dirname, '..', 'email_templates', f);
  let content = fs.readFileSync(filePath, 'utf8');
  const isCrlf = content.includes('\r\n');
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.includes(inviteTarget)) {
    console.error('Invite target not found in', f);
    return;
  }
  let updated = normalized.replace(inviteTarget, inviteRepl);
  if (isCrlf) {
    updated = updated.replace(/\n/g, '\r\n');
  }
  fs.writeFileSync(filePath, updated, 'utf8');
  console.log('Successfully updated invite template:', f);
});
