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

  const paperId = vars.PAPER_ID || '';
  let defaultYear = String(new Date().getFullYear());
  let defaultVolume = '1';
  let defaultIssue = '1';
  const idMatch = String(paperId).match(/MPPT-(\\d{4})-V(\\d+)I(\\d+)/i);
  if (idMatch) {
    defaultYear = idMatch[1];
    defaultVolume = idMatch[2];
    defaultIssue = idMatch[3];
  }

  const merged = {
    VOLUME: defaultVolume,
    ISSUE: defaultIssue,
    YEAR: defaultYear,
    PAGE_RANGE: ' · pp. 1–4',
    SIMILARITY_SCORE: '3.8%',
    ARTICLE_URL: paperId ? \`https://mpptjournal.com/paper/\${paperId}\` : 'https://mpptjournal.com',
    ARTICLE_URL_ENCODED: encodeURIComponent(vars.ARTICLE_URL || (paperId ? \`https://mpptjournal.com/paper/\${paperId}\` : 'https://mpptjournal.com')),
    ZENODO_DOI: '10.5281/zenodo.11478902',
    MEMBER_NAME_ENCODED: encodeURIComponent(vars.MEMBER_NAME || ''),
    TRACK_ENCODED: encodeURIComponent(vars.TRACK || ''),
    REVIEWER_NAME_ENCODED: encodeURIComponent(vars.REVIEWER_NAME || ''),
    SPECIALITY_ENCODED: encodeURIComponent(vars.SPECIALITY || ''),
    ...vars,
  };

  let html = raw;
  for (const [k, v] of Object.entries(merged)) {
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
    'CONFIRMATION_ADVISORY_BOARD': 'Formal Appointment & Official Board Certificate · Editorial Advisory Board — MPPT Journal',
    'CONFIRMATION_REVIEWER': 'Welcome to the Verified Peer Reviewer Panel & Official Certificate — MPPT Journal',
  };
  return subjects[templateKey] || \`Official Correspondence — \${paperId || 'MPPT Journal'}\`;
}
`;

const dest = path.join(__dirname, '..', 'worker', 'src', 'templates.js');
fs.writeFileSync(dest, js, 'utf8');
console.log('Successfully generated ' + dest + ' with ' + files.length + ' templates.');
