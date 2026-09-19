# MPPT Journal — Invariant Rules & Guidelines for Agents

## 1. Email Template Formatting Rules (MANDATORY)

### 📌 Rule 1: Mandatory Text Justification (Ctrl+J) across Every Template
- **Every email template** in `email_templates/*.html` **MUST** have all body text, paragraphs, and alert/info boxes aligned to **Justified (`Ctrl+J`)**:
  ```css
  .body { text-align: justify; text-justify: inter-word; }
  .alert-box { text-align: justify; text-justify: inter-word; }
  .issue-box { text-align: justify; text-justify: inter-word; }
  ```
- **Metadata Cards**: Keep metadata key-value rows explicitly left-aligned (`.card { text-align: left; }`) for clean label-to-value readability.
- **Buttons**: Keep call-to-action buttons centered (`.btn-wrap { text-align: center; }`).
- **Headings & Kickers**: Left-aligned.

### 📌 Rule 2: Left-Aligned Header Branding
- The journal logo seal, publication title hierarchy, and official tagline (`Research · Practice · Better Health`) must always be **left-aligned** with the body text margin.
- Never center the logo and journal title in the header.

### 📌 Rule 3: Tracking Portal Link & Entry Box
- Action buttons pointing to the tracking portal must link directly to:
  `https://mpptjournal.com/track.html` (do not append auto-populating query parameters like `?id=...`).
- The tracking lookup input box in `track.html` must remain **completely blank** on load so authors enter their Paper ID manually.

### 📌 Rule 4: Submission Timestamp Labeling
- Intake timestamp in submission confirmations must always be labeled:
  `Date & Time Received:` (formatted in human-readable Indian Standard Time, e.g. `September 19, 2026 at 05:00 PM IST`).

---

## 2. Scientific & Code Invariants
1. **Author Text Inviolability**: Under no circumstances may an AI or editor rewrite, ghostwrite, paraphrase, or modify an author's original scientific data, hypothesis, or conclusions.
2. **Vancouver Reference Standards**: Numerical citations `[1, 2]` strictly adhering to Vancouver style.
3. **No External Credentials/Personal Emails**: Never commit personal Gmail or expose secret keys.
4. **Local-First Execution**: Do not push to GitHub or deploy to Cloudflare until the user explicitly requests a final push.
