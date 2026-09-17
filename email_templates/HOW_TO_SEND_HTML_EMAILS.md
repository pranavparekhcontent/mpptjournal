# 📧 How to Send Interactive HTML Emails Directly in Gmail & Outlook (No Attachment)

This guide shows how to insert and send **[`INVITATION_ADVISORY_BOARD.html`](file:///E:/PRANAV/pwa%20apps/mpptjournal/email_templates/INVITATION_ADVISORY_BOARD.html)** and **[`INVITATION_REVIEWER.html`](file:///E:/PRANAV/pwa%20apps/mpptjournal/email_templates/INVITATION_REVIEWER.html)** directly as rich, interactive email bodies (with live buttons, logo, and responsive styling) **without attaching any files**.

---

## 🚀 Method 1: The 10-Second Browser Copy-Paste Method *(Easiest & Recommended)*

This works natively on **Gmail**, **Outlook Web**, **Yahoo Mail**, and **Apple Mail** without installing any plugins:

1. **Open the HTML file in your web browser:**
   - Double-click `INVITATION_ADVISORY_BOARD.html` or `INVITATION_REVIEWER.html` (it will open in Google Chrome, Microsoft Edge, or Safari).
2. **Select All & Copy:**
   - Press <kbd>Ctrl</kbd> + <kbd>A</kbd> (Windows) or <kbd>Cmd</kbd> + <kbd>A</kbd> (Mac) to highlight the entire rendered email page.
   - Press <kbd>Ctrl</kbd> + <kbd>C</kbd> (Windows) or <kbd>Cmd</kbd> + <kbd>C</kbd> (Mac) to copy it.
3. **Paste into Gmail or Outlook:**
   - Open your email client and click **Compose**.
   - Fill in your Recipient and Subject line.
   - Click inside the email body area.
   - Press <kbd>Ctrl</kbd> + <kbd>V</kbd> (Windows) or <kbd>Cmd</kbd> + <kbd>V</kbd> (Mac) to paste.
4. **Personalize & Send:**
   - Replace placeholders like `[Prof. / Dr. / Respected Scholar Name]` and `[Specialization Area]` directly in your compose box.
   - The logo, clickable buttons, and styling will be fully rendered and interactive!
   - Click **Send**.

---

## 🛠️ Method 2: Gmail "Edit as HTML" Method *(100% Pixel-Perfect Raw Code Injection)*

If you want the raw HTML code injected with zero formatting alteration by the browser clipboard:

1. Open your HTML template file (`.html`) in a text editor (Notepad, VS Code) and copy all the code (<kbd>Ctrl</kbd> + <kbd>A</kbd>, then <kbd>Ctrl</kbd> + <kbd>C</kbd>).
2. Go to **Gmail** and click **Compose**.
3. Type a unique placeholder word in the email body, e.g., `REPLACEME`.
4. Right-click on `REPLACEME` and click **Inspect** (or press <kbd>F12</kbd>).
5. In the Chrome Developer Tools panel, right-click the highlighted element containing `REPLACEME` and select **Edit as HTML**.
6. Select everything inside that element, paste (<kbd>Ctrl</kbd> + <kbd>V</kbd>) your full HTML code, and click anywhere outside the editing box.
7. Close Developer Tools (<kbd>Esc</kbd> or <kbd>X</kbd>).
8. The email compose box will instantly transform into the rich, styled interactive invitation.

---

## 💻 Method 3: Microsoft Outlook Desktop App *(Insert as Text)*

1. In Outlook Desktop, click **New Email**.
2. Click inside the email message body.
3. In the top ribbon, click the **Insert** tab &rarr; **Attach File** &rarr; **Browse this PC...**
4. Select `INVITATION_ADVISORY_BOARD.html` or `INVITATION_REVIEWER.html`.
5. **IMPORTANT:** Do *not* double-click or click "Insert". Instead, look at the **Insert button dropdown arrow** in the bottom-right corner of the file selection dialog.
6. Click the arrow next to the Insert button and choose **"Insert as Text"**.
7. Outlook will immediately render the HTML file directly inside your email body rather than attaching it!

---

## ⚡ Method 4: Free Chrome Extensions *(Optional 1-Click Tool)*

If you send HTML emails frequently:
- Install the free Chrome Extension: **"HTML Inserter for Gmail"** or **"Free HTML Editor for Gmail"**.
- An "Insert HTML" button will appear in your Gmail toolbar, allowing you to paste your code with a single click.

---

## 📬 Key Features Built Into These MPPT Templates:

1. **Official Journal Crest:** Hosted at `https://mpptjournal.com/logo/logo.png` so it renders in all modern email clients.
2. **Direct Website Links:** Prominent buttons linking to `https://mpptjournal.com` and credentials verification `certificate.html`.
3. **1-Click Interactive Reply Button:** The main action button uses a smart `mailto:` link with pre-filled acceptance text; when the scholar clicks it, their email client immediately prepares the response for them.
4. **Mobile Responsive:** Adapts cleanly on iPhones, Android devices, tablets, and wide-screen desktops.
5. **Universal Fallback Box:** Includes a clean dashed summary card with 6 simple fields for scholars who prefer typing or copy-pasting their credentials.
