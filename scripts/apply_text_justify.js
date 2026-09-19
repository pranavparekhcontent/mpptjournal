const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'email_templates');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

let updatedCount = 0;

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // 1. Workflow templates
  if (content.includes('.body { padding:32px; font-size:14px; line-height:1.65; color:#2c251e; }')) {
    content = content.replace(
      '.body { padding:32px; font-size:14px; line-height:1.65; color:#2c251e; }',
      '.body { padding:32px; font-size:14px; line-height:1.65; color:#2c251e; text-align: justify; text-justify: inter-word; }'
    );
    modified = true;
  }

  // Ensure .card stays left-aligned
  if (content.includes('.card {') && !content.includes('.card { text-align:left;')) {
    content = content.replace('.card {', '.card { text-align:left;');
    modified = true;
  }

  // Ensure alert-box / issue-box are justified
  if (content.includes('.alert-box {') && !content.includes('.alert-box { text-align:justify;')) {
    content = content.replace('.alert-box {', '.alert-box { text-align:justify; text-justify:inter-word;');
    modified = true;
  }
  if (content.includes('.issue-box {') && !content.includes('.issue-box { text-align:justify;')) {
    content = content.replace('.issue-box {', '.issue-box { text-align:justify; text-justify:inter-word;');
    modified = true;
  }

  // 2. Invitation templates
  if (file.startsWith('INVITATION_')) {
    if (content.includes('class="body-pad" style="padding: 34px 36px; font-size: 14.5px; line-height: 1.68; color: #2b251e;"')) {
      content = content.replace(
        'class="body-pad" style="padding: 34px 36px; font-size: 14.5px; line-height: 1.68; color: #2b251e;"',
        'class="body-pad" style="padding: 34px 36px; font-size: 14.5px; line-height: 1.68; color: #2b251e; text-align: justify; text-justify: inter-word;"'
      );
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Justified text in: ${file}`);
    updatedCount++;
  }
}

// Also update test_header.html
const testHeaderPath = path.join(__dirname, '..', 'test_header.html');
if (fs.existsSync(testHeaderPath)) {
  let th = fs.readFileSync(testHeaderPath, 'utf8');
  th = th.replace(
    '.body { padding:32px; font-size:14px; line-height:1.65; color:#2c251e; }',
    '.body { padding:32px; font-size:14px; line-height:1.65; color:#2c251e; text-align: justify; text-justify: inter-word; }'
  );
  if (th.includes('.card {') && !th.includes('.card { text-align:left;')) {
    th = th.replace('.card {', '.card { text-align:left;');
  }
  fs.writeFileSync(testHeaderPath, th, 'utf8');
  console.log('Updated test_header.html with justified text alignment');
}

console.log(`Total templates updated with justified alignment: ${updatedCount}`);
