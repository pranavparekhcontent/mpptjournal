const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!fs.existsSync(edgePath)) {
  console.error('Edge executable not found at:', edgePath);
  process.exit(1);
}

const paperDir = path.resolve(__dirname, '..', 'paper sample');

const targets = [
  {
    name: 'Reviewer Blinded PDF',
    url: 'http://localhost:8888/paper%20sample/mppt_sample_paper.html?mode=reviewer',
    output: path.join(paperDir, 'MPPT_Vol1_Issue1_Reviewer_Blinded.pdf')
  },
  {
    name: 'Author Galley Proof PDF',
    url: 'http://localhost:8888/paper%20sample/mppt_sample_paper.html?mode=proof',
    output: path.join(paperDir, 'MPPT_Vol1_Issue1_Author_Proof.pdf')
  },
  {
    name: 'Inaugural Article Published PDF',
    url: 'http://localhost:8888/paper%20sample/mppt_sample_paper.html?mode=final',
    output: path.join(paperDir, 'MPPT_Vol1_Issue1_Inaugural_Article.pdf')
  }
];

console.log('=== Academic PDF Compilation via Headless Edge ===');
for (const target of targets) {
  console.log(`\nCompiling [${target.name}]...`);
  console.log(`Source URL: ${target.url}`);
  console.log(`Output: ${target.output}`);

  try {
    const args = [
      '--headless=new',
      `--print-to-pdf=${target.output}`,
      '--no-pdf-header-footer',
      '--virtual-time-budget=5000',
      target.url
    ];
    execFileSync(edgePath, args, { stdio: 'inherit', timeout: 30000 });
    
    if (fs.existsSync(target.output)) {
      const stats = fs.statSync(target.output);
      console.log(`✓ Success: ${path.basename(target.output)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      console.error(`✗ File not created: ${target.output}`);
    }
  } catch (err) {
    console.error(`✗ Failed to compile ${target.name}:`, err.message);
  }
}

// Ensure backward compatibility copy for existing links if needed
const inauguralPdf = path.join(paperDir, 'MPPT_Vol1_Issue1_Inaugural_Article.pdf');
const legacyPdf = path.join(paperDir, 'MPPT_Vol1_Issue1_Sample_Paper.pdf');
if (fs.existsSync(inauguralPdf)) {
  fs.copyFileSync(inauguralPdf, legacyPdf);
  console.log(`\n✓ Synchronized legacy artifact MPPT_Vol1_Issue1_Sample_Paper.pdf for backward compatibility.`);
}

console.log('\n=== Compilation Complete ===');
