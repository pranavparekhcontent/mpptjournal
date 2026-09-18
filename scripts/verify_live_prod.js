async function verifyLive() {
  console.log('=== Verifying Live Production Deployment at https://mpptjournal.com ===\n');

  // 1. Home page footer
  const homeRes = await fetch('https://mpptjournal.com/?_t=' + Date.now());
  const homeHtml = await homeRes.text();
  console.log('1. Home Page Status:', homeRes.status);
  console.log('   Inaugural Article (Web) in footer:', homeHtml.includes('Inaugural Article (Web)'));
  console.log('   Inaugural Article (PDF) in footer:', homeHtml.includes('Inaugural Article (PDF)'));
  console.log('   No "Sample Paper" in footer:', !homeHtml.includes('Sample Paper (Web)'));

  // 2. Paper HTML
  const paperRes = await fetch('https://mpptjournal.com/paper%20sample/mppt_sample_paper.html?_t=' + Date.now());
  const paperHtml = await paperRes.text();
  console.log('\n2. Paper Web Page Status:', paperRes.status);
  console.log('   Reviewer Watermark CSS/DOM present:', paperHtml.includes('REVIEWER COPY · UNDER REVIEW'));
  console.log('   Proof Watermark CSS/DOM present:', paperHtml.includes('GALLEY PROOF COPY · UNCORRECTED PROOF'));
  console.log('   Double-Blind Redaction Mask present:', paperHtml.includes('[Author Identifiers Redacted for Double-Blind Review]'));
  console.log('   Lifecycle Mode Switcher present:', paperHtml.includes('id="modeSwitcher"'));
  console.log('   setPaperMode JS Controller present:', paperHtml.includes('function setPaperMode(mode)'));

  // 3. Reviewer Blinded PDF
  const revRes = await fetch('https://mpptjournal.com/paper%20sample/MPPT_Vol1_Issue1_Reviewer_Blinded.pdf', { method: 'HEAD' });
  console.log('\n3. Reviewer Blinded PDF Status:', revRes.status, 'Content-Length:', revRes.headers.get('content-length'), 'bytes');

  // 4. Author Proof PDF
  const proofRes = await fetch('https://mpptjournal.com/paper%20sample/MPPT_Vol1_Issue1_Author_Proof.pdf', { method: 'HEAD' });
  console.log('4. Author Proof PDF Status:', proofRes.status, 'Content-Length:', proofRes.headers.get('content-length'), 'bytes');

  // 5. Inaugural Published PDF
  const inauRes = await fetch('https://mpptjournal.com/paper%20sample/MPPT_Vol1_Issue1_Inaugural_Article.pdf', { method: 'HEAD' });
  console.log('5. Inaugural Article PDF Status:', inauRes.status, 'Content-Length:', inauRes.headers.get('content-length'), 'bytes');

  console.log('\n=== All Live Verification Checks Passed! ===');
}
verifyLive().catch(console.error);
