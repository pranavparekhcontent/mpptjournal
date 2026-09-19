const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'email_templates');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

const NEW_WORKFLOW_HEADER = `<div class="header">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
      <tr>
        <td align="left" valign="middle">
          <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin: 0;">
            <tr>
              <td valign="middle" style="padding-right: 16px; vertical-align: middle;">
                <a href="https://mpptjournal.com" target="_blank" style="text-decoration: none; display: inline-block;">
                  <img src="https://mpptjournal.com/logo/logo.png" alt="MPPT Journal Official Seal" width="56" height="56" style="display: block; width: 56px; height: 56px; border-radius: 50%; border: 1.5px solid #a8874f; box-shadow: 0 2px 8px rgba(140,59,59,0.16); -ms-interpolation-mode: bicubic;" />
                </a>
              </td>
              <td valign="middle" align="left" style="vertical-align: middle; text-align: left; line-height: 1.15;">
                <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; font-style: italic; color: #8c3b3b; margin: 0; line-height: 1.15;">Journal of</div>
                <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 19px; font-weight: bold; color: #1c1812; letter-spacing: 0.04em; text-transform: uppercase; margin: 1px 0; line-height: 1.15;">MODERN PHARMACY</div>
                <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-weight: 600; color: #1c1812; letter-spacing: 0.03em; text-transform: uppercase; margin: 0 0 5px 0; line-height: 1.15;">PRAXIS <span style="font-style: italic; font-weight: 400; color: #8c3b3b;">&amp;</span> THERAPEUTICS</div>
                <div style="font-family: 'Courier New', Courier, monospace, sans-serif; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.16em; color: #8a7f6c; line-height: 1.2;">Research · Practice · Better Health</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;

const NEW_INVITATION_HEADER = `<!-- HEADER WITH LOGO & JOURNAL BRANDING -->
        <tr>
          <td align="left" valign="top" class="header-pad" style="background-color: #ffffff; padding: 28px 36px 20px; border-bottom: 1px solid #efeae1;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="left" valign="middle">
                  <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin: 0;">
                    <tr>
                      <td valign="middle" style="padding-right: 18px; vertical-align: middle;">
                        <a href="https://mpptjournal.com" target="_blank" style="text-decoration: none; display: inline-block;">
                          <img src="https://mpptjournal.com/logo/logo.png" alt="MPPT Journal Crest" width="68" height="68" style="display: block; width: 68px; height: 68px; border-radius: 50%; border: 1.5px solid #a8874f; box-shadow: 0 2px 8px rgba(140,59,59,0.14);" />
                        </a>
                      </td>
                      <td valign="middle" align="left" style="vertical-align: middle; text-align: left; line-height: 1.15;">
                        <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; font-style: italic; color: #8c3b3b; margin: 0; line-height: 1.15;">Journal of</div>
                        <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 19px; font-weight: bold; color: #1c1812; letter-spacing: 0.04em; text-transform: uppercase; margin: 1px 0; line-height: 1.15;">MODERN PHARMACY</div>
                        <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-weight: 600; color: #1c1812; letter-spacing: 0.03em; text-transform: uppercase; margin: 0 0 5px 0; line-height: 1.15;">PRAXIS <span style="font-style: italic; font-weight: 400; color: #8c3b3b;">&amp;</span> THERAPEUTICS</div>
                        <div style="font-family: 'Courier New', Courier, monospace, sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: #8a7f6c; line-height: 1.2;">Research · Practice · Better Health</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

let updatedCount = 0;

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  if (file.startsWith('INVITATION_')) {
    const invHeaderRegex = /<!-- HEADER WITH LOGO & JOURNAL BRANDING -->[\s\S]*?(?=\s*<!-- INVITATION HERO BANNER -->)/;
    if (invHeaderRegex.test(content)) {
      content = content.replace(invHeaderRegex, NEW_INVITATION_HEADER);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated invitation template: ${file}`);
      updatedCount++;
    } else {
      console.warn(`Could not match invitation header in: ${file}`);
    }
  } else {
    let modified = false;

    // Update .header CSS from text-align:center to text-align:left and adjust padding to align with body
    if (content.includes('.header { padding:24px 24px 18px; text-align:center;')) {
      content = content.replace(
        '.header { padding:24px 24px 18px; text-align:center;',
        '.header { padding:24px 32px 18px; text-align:left;'
      );
      modified = true;
    } else if (content.includes('.header { padding:24px 24px 18px; text-align: center;')) {
      content = content.replace(
        '.header { padding:24px 24px 18px; text-align: center;',
        '.header { padding:24px 32px 18px; text-align:left;'
      );
      modified = true;
    }

    // Match exact block from <div class="header"> right up to <div class="body">
    const headerHtmlRegex = /<div class="header">[\s\S]*?<\/div>(?=\s*<div class="body">)/;
    if (headerHtmlRegex.test(content)) {
      content = content.replace(headerHtmlRegex, NEW_WORKFLOW_HEADER);
      modified = true;
    } else {
      console.warn(`Could not match headerHtml in ${file}`);
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated workflow template: ${file}`);
      updatedCount++;
    } else {
      console.warn(`No modifications for: ${file}`);
    }
  }
}

console.log(`Total templates updated: ${updatedCount} / ${files.length}`);
