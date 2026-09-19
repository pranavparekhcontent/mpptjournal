const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failCount++;
  }
}

console.log('--- 1. Verification of Key Artifacts & PDFs ---');
const inauguralPdf = path.join(root, 'paper sample', 'MPPT_Vol1_Issue1_Inaugural_Article.pdf');
assert(fs.existsSync(inauguralPdf), 'Inaugural Article PDF exists at paper sample/MPPT_Vol1_Issue1_Inaugural_Article.pdf');
if (fs.existsSync(inauguralPdf)) {
  const stat = fs.statSync(inauguralPdf);
  assert(stat.size > 1500000, `Inaugural PDF file size is valid (~${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
}

const reviewerPdf = path.join(root, 'paper sample', 'MPPT_Vol1_Issue1_Reviewer_Blinded.pdf');
assert(fs.existsSync(reviewerPdf), 'Reviewer Blinded PDF exists at paper sample/MPPT_Vol1_Issue1_Reviewer_Blinded.pdf');
if (fs.existsSync(reviewerPdf)) {
  const stat = fs.statSync(reviewerPdf);
  assert(stat.size > 1500000, `Reviewer PDF file size is valid (~${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
}

const proofPdf = path.join(root, 'paper sample', 'MPPT_Vol1_Issue1_Author_Proof.pdf');
assert(fs.existsSync(proofPdf), 'Author Galley Proof PDF exists at paper sample/MPPT_Vol1_Issue1_Author_Proof.pdf');
if (fs.existsSync(proofPdf)) {
  const stat = fs.statSync(proofPdf);
  assert(stat.size > 1500000, `Proof PDF file size is valid (~${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
}

const sampleHtml = path.join(root, 'paper sample', 'mppt_sample_paper.html');
assert(fs.existsSync(sampleHtml), 'mppt_sample_paper.html exists');

const logoPng = path.join(root, 'logo', 'logo.png');
assert(fs.existsSync(logoPng), 'Official seal logo exists at logo/logo.png');

console.log('\n--- 2. Sub-Sections 3-Line Branding & Hero Lockup ---');
// track.html
const trackHtml = fs.readFileSync(path.join(root, 'track.html'), 'utf8');
assert(trackHtml.includes('lockup-kicker">Journal of<'), 'track.html has Line 1 "Journal of" kicker');
assert(trackHtml.includes('lockup-line1">MODERN PHARMACY<'), 'track.html has Line 2 "MODERN PHARMACY" bold uppercase');
assert(trackHtml.includes('lockup-line2">PRAXIS <span class="amp">&amp;</span> THERAPEUTICS<'), 'track.html has Line 3 "PRAXIS & THERAPEUTICS" uppercase with crimson amp');
assert(trackHtml.includes('Live Manuscript Progress &amp; Editorial Tracker'), 'track.html has correct tracker subtitle');
assert(trackHtml.includes('logo/logo.png'), 'track.html links to official seal logo');
assert(trackHtml.includes('lockup-sub">Official Submission &amp; Peer-Review Status Certificate<'), 'track.html receipt includes official status certificate subtitle');
assert(trackHtml.includes('lockup-kicker" style="color:#8c3b3b !important;font-style:italic'), 'track.html receipt has crimson #8c3b3b italic Journal of');
assert(trackHtml.includes('class="amp" style="color:#8c3b3b !important;font-style:italic'), 'track.html receipt has crimson #8c3b3b italic amp');

// certificate.html
const certHtml = fs.readFileSync(path.join(root, 'certificate.html'), 'utf8');
assert(certHtml.includes('cert-org-kicker">Journal of<'), 'certificate.html has Line 1 "Journal of"');
assert(certHtml.includes('cert-org-line1">MODERN PHARMACY<'), 'certificate.html has Line 2 "MODERN PHARMACY"');
assert(certHtml.includes('cert-org-line2">PRAXIS <span class="amp">&amp;</span> THERAPEUTICS<'), 'certificate.html has Line 3 "PRAXIS & THERAPEUTICS"');
assert(certHtml.includes('href="index.html" class="back-btn"'), 'certificate.html back button links directly to index.html');

// coupon_generator.html
const couponHtml = fs.readFileSync(path.join(root, 'coupon_generator.html'), 'utf8');
assert(couponHtml.includes('lockup-kicker">Journal of<'), 'coupon_generator.html has Line 1 "Journal of"');
assert(couponHtml.includes('lockup-line1">MODERN PHARMACY<'), 'coupon_generator.html has Line 2 "MODERN PHARMACY"');
assert(couponHtml.includes('lockup-line2">PRAXIS <span class="amp">&amp;</span> THERAPEUTICS<'), 'coupon_generator.html has Line 3 "PRAXIS & THERAPEUTICS"');

// mppt_sample_paper.html
const samplePaperContent = fs.readFileSync(sampleHtml, 'utf8');
assert(samplePaperContent.includes('jline-kicker">Journal of<'), 'sample paper has Line 1 "Journal of"');
assert(samplePaperContent.includes('jline1">MODERN PHARMACY<'), 'sample paper has Line 2 "MODERN PHARMACY"');
assert(samplePaperContent.includes('jline2">PRAXIS <span class="amp">&amp;</span> THERAPEUTICS<'), 'sample paper has Line 3 "PRAXIS & THERAPEUTICS"');
assert(samplePaperContent.includes('href="../index.html#issues"'), 'sample paper back button links to ../index.html#issues');
assert(samplePaperContent.includes('href="../certificate.html?type=author&id=MPPT-2026-V1I1-0001"'), 'sample paper certificate button links to ../certificate.html');
assert(samplePaperContent.includes('href="MPPT_Vol1_Issue1_Inaugural_Article.pdf"'), 'sample paper PDF button links to MPPT_Vol1_Issue1_Inaugural_Article.pdf');
assert(samplePaperContent.includes('REVIEWER COPY · UNDER REVIEW'), 'sample paper has Reviewer watermark string');
assert(samplePaperContent.includes('GALLEY PROOF COPY · UNCORRECTED PROOF'), 'sample paper has Galley Proof watermark string');
assert(samplePaperContent.includes('[Author Identifiers Redacted for Double-Blind Review]'), 'sample paper has Double-Blind redaction notice');
assert(samplePaperContent.includes('setPaperMode'), 'sample paper has setPaperMode lifecycle function');
assert(samplePaperContent.includes('data-mode="reviewer"'), 'sample paper has Reviewer mode button');
assert(samplePaperContent.includes('data-mode="proof"'), 'sample paper has Galley Proof mode button');
assert(samplePaperContent.includes('data-mode="final"'), 'sample paper has Published mode button');

console.log('\n--- 3. Main Website (index.html) Links Audit ---');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(indexHtml.includes('href="paper sample/mppt_sample_paper.html"'), 'index.html has links to paper sample/mppt_sample_paper.html');
assert(!indexHtml.includes('Read Inaugural Issue Paper (Web)'), 'index.html archive does not have overlapping action button strip');
assert(indexHtml.includes('href="paper sample/mppt_sample_paper.html"'), 'index.html retains sample paper links in submit resources and footer');
assert(indexHtml.includes('lockup-sub">Official Manuscript Intake &amp; Peer-Review Receipt<'), 'index.html submission receipt includes official lockup');
assert(indexHtml.includes('lockup-kicker" style="color:#8c3b3b !important;font-style:italic'), 'index.html receipt has crimson #8c3b3b italic Journal of');
assert(indexHtml.includes('class="amp" style="color:#8c3b3b !important;font-style:italic'), 'index.html receipt has crimson #8c3b3b italic amp');

console.log('\n--- 4. Batch Email Templates (All 18) ---');
const emailFiles = [
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
  'INVITATION_ADVISORY_BOARD.html',
  'CONFIRMATION_ADVISORY_BOARD.html',
  'INVITATION_REVIEWER.html',
  'CONFIRMATION_REVIEWER.html',
  'REJECTION.html'
];

emailFiles.forEach(f => {
  const filePath = path.join(root, 'email_templates', f);
  assert(fs.existsSync(filePath), `Email template exists: ${f}`);
  const content = fs.readFileSync(filePath, 'utf8');
  assert(content.includes('https://mpptjournal.com/logo/logo.png'), `${f} contains absolute logo URL`);
  assert(content.includes('Journal of'), `${f} contains "Journal of" line`);
  assert(content.includes('MODERN PHARMACY'), `${f} contains "MODERN PHARMACY" line`);
  assert(content.includes('PRAXIS') && content.includes('THERAPEUTICS'), `${f} contains "PRAXIS & THERAPEUTICS" line`);
});

console.log('\n==========================================');
console.log(`TOTAL PASS: ${passCount} | TOTAL FAIL: ${failCount}`);
console.log('==========================================');

if (failCount > 0) process.exit(1);
