const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'email_templates');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

let js = '/**\n * MPPT Journal — Official Email Templates\n * Auto-generated from email_templates/*.html\n */\n\n';
js += 'export const TEMPLATES = {\n';

for (const file of files) {
  const key = file.replace('.html', '');
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  js += '  ' + JSON.stringify(key) + ': ' + JSON.stringify(content) + ',\n';
}

js += '};\n\n';

js += `export function renderEmailHtml(templateKey, vars = {}) {
  const raw = TEMPLATES[templateKey];
  if (!raw) return null;
  let html = raw;
  for (const [k, v] of Object.entries(vars)) {
    const reg = new RegExp('\\\\{\\\\{' + k + '\\\\}\\\\}', 'g');
    html = html.replace(reg, String(v ?? ''));
  }
  return html;
}

export function getTemplateSubject(templateKey, paperId = '') {
  const subjects = {
    '1_SUBMISSION_CONFIRMATION': \`Manuscript Submission Received — \${paperId} · MPPT Journal\`,
    '2_DESK_SCREENING_CLEARED': \`Editorial Desk Screening Cleared — \${paperId} · MPPT Journal\`,
    '2A_PLAGIARISM_RESUBMIT': \`Plagiarism Audit: Revision Required — \${paperId} · MPPT Journal\`,
    '3_PEER_REVIEW_DISPATCH': \`Dispatched for Double-Blind Peer Review — \${paperId} · MPPT Journal\`,
    '3A_FORMATTING_REVISION': \`Technical Formatting Revision Required — \${paperId} · MPPT Journal\`,
    '3B_FORMATTING_CLEARED': \`Technical Formatting Cleared — \${paperId} · MPPT Journal\`,
    '4_EDITORIAL_DECISION_ACCEPT': \`Formal Decision: Accepted for Publication — \${paperId} · MPPT Journal\`,
    '5_PUBLISHED_AND_ARCHIVED': \`Manuscript Published & Deposited in Zenodo — \${paperId} · MPPT Journal\`,
    '5A_REVIEWER_COMMENTS': \`Peer Review Comments & Revision Required — \${paperId} · MPPT Journal\`,
    '6_GALLERY_PROOF': \`Typeset Galley Proof for Final Verification — \${paperId} · MPPT Journal\`,
    '7_PAYMENT_LINK': \`Article Processing Charge Waiver / Settlement — \${paperId} · MPPT Journal\`,
    '7A_PAYMENT_RECEIPT': \`Official Payment Receipt & Tax Invoice — \${paperId} · MPPT Journal\`,
    '8_CERTIFICATE': \`Official Publication Certificate — \${paperId} · MPPT Journal\`,
    'REJECTION': \`Editorial Decision: Rejection Notice — \${paperId} · MPPT Journal\`,
    'INVITATION_REVIEWER': 'Formal Invitation: Join the MPPT Journal Peer Reviewer Board',
    'INVITATION_ADVISORY_BOARD': 'Distinguished Invitation: Editorial Advisory Board · MPPT Journal',
  };
  return subjects[templateKey] || \`Manuscript Update — \${paperId} · MPPT Journal\`;
}
`;

const dest = path.join(__dirname, '..', 'worker', 'src', 'templates.js');
fs.writeFileSync(dest, js, 'utf8');
console.log('Successfully generated ' + dest + ' with ' + files.length + ' templates.');
