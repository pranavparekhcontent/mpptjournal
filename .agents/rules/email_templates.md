# Email Templates Rule: Mandatory Text Justification (Ctrl+J)

## Core Requirement
Every email template (`email_templates/*.html` and any newly added template) MUST apply **Justified Text Alignment (Ctrl+J)** to all readable paragraphs, explanatory notes, and alert boxes:

```css
.body {
  text-align: justify;
  text-justify: inter-word;
}
.alert-box, .issue-box {
  text-align: justify;
  text-justify: inter-word;
}
```

## Structural Alignment Layout
1. **Header**: Left-aligned seal logo, title hierarchy, and official tagline (`Research · Practice · Better Health`).
2. **Headings (`h1`, `kicker`)**: Left-aligned.
3. **Body Paragraphs**: Justified (`text-align: justify; text-justify: inter-word;`).
4. **Metadata Cards**: Explicitly left-aligned (`.card { text-align: left; }`).
5. **Call-To-Action Buttons**: Centered (`.btn-wrap { text-align: center; }`), linking to `https://mpptjournal.com/track.html`.
6. **Footer**: Centered editorial contact details.
