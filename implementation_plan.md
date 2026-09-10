# MPPT Journal — Full Platform Implementation Plan (v2)

> **Project:** Modern Pharmacy Praxis & Therapeutics (MPPT Journal)  
> **Domain:** `mpptjournal.com` (Active on Cloudflare, DNS verified)  
> **Account:** `pranavparekhcontent@gmail.com` — Cloudflare Free Tier  
> **Total Monthly Cost Target:** ₹0 ($0.00)  
> **Local Path:** `e:\PRANAV\pwa apps\mpptjournal`  
> **Last Updated:** 2026-09-09

---

## Current Status

- ✅ Domain `mpptjournal.com` — Active on Cloudflare
- ✅ Cloudflare account — Free tier, verified via API
- ✅ Zoho Mail — 5 emails verified (editor@, submission@, publisher@, review@, info@)
- ✅ MX, SPF, DKIM — All DNS records propagated and verified
- ✅ Logo — Finalized (`logo/logo.png`)
- ✅ Email invitation templates — 4 templates ready
- ✅ R2 available — 9.98 GB free space remaining
- ✅ D1 available — 0 databases used, 5 GB free
- ✅ Workers available — 1 of 100 scripts used
- ✅ Zero Trust — Already configured (used on smart-attendance project)
- 🔧 **Index page (index.html) — INCOMPLETE, needs finishing first**

---

## Execution Order (User-Confirmed)

```
STEP 1: Finish website design (3D cinematic index page)     ◀── WE ARE HERE
STEP 2: Deploy live on mpptjournal.com (Cloudflare Pages)
STEP 3: Build submission system + storage (User will specify details later)
STEP 4: AI automation using Cloudflare Workers AI
STEP 5: Article pages + academic indexing metadata
STEP 6: Archive browser + search + SEO polish
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   MPPT JOURNAL STACK                 │
│                   (100% Free Tier)                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌───────────┐    ┌──────────────┐    ┌──────────┐ │
│  │ Cloudflare │    │  Cloudflare  │    │Cloudflare│ │
│  │   Pages    │    │    Worker    │    │    R2    │  │
│  │ (Frontend) │───▶│  (API + AI)  │───▶│ (Files)  │ │
│  └───────────┘    └──────────────┘    └──────────┘ │
│       │                   │                   │     │
│       │            ┌──────────────┐           │     │
│       │            │  Cloudflare  │           │     │
│       │            │     D1       │           │     │
│       └───────────▶│  (Database)  │◀──────────┘     │
│                    └──────────────┘                  │
│                           │                         │
│                    ┌──────────────┐                  │
│                    │  Zoho Mail   │                  │
│                    │ (@mpptjournal│                  │
│                    │   .com)      │                  │
│                    └──────────────┘                  │
│                           │                         │
│                    ┌──────────────┐                  │
│                    │  Cloudflare  │                  │
│                    │  Workers AI  │                  │
│                    │  (Built-in)  │                  │
│                    └──────────────┘                  │
└─────────────────────────────────────────────────────┘
```

> AI automation will use **Cloudflare Workers AI** (built-in, free daily inference with Llama/Mistral/DeepSeek models). No external API needed.

---

## Deferred Items (User Decision)

| Item | Status | When |
|:---|:---|:---|
| **Crossref DOIs ($200/yr)** | DEFERRED | After revenue generation |
| **3D Hero Frames → R2 migration** | DEFERRED | After HTML design finalized |
| **Submission system details** | DEFERRED | User will specify later |

---

## PHASE 1 — Finish Website Design (Current Priority)

**Goal:** Complete the 3D cinematic index page to professional, publication-ready quality.

**What exists:**
- `index.html` (734 lines) — Has hero scroll, editorial board, aims & scope, call for papers, guidelines, footer, submission modal
- `css/style.css` (25 KB)
- `js/scroll-engine.js` — Cinematic hero frame scrubbing
- `js/3d-viewer.js` — WebGL pharmacophore molecule
- `js/main.js` — Navigation, modal, form handler
- `frames/` — 120 webp frames for hero animation
- `logo/` — 3 logo files

**User decides what needs to be added/changed next.**

---

## PHASE 2 — Deploy Live (~2 hours, after Phase 1)

- Create GitHub repo `mpptjournal` under `pranavparekhcontent`
- Connect to Cloudflare Pages
- Set custom domains: `mpptjournal.com` + `www.mpptjournal.com`
- SSL/HTTPS auto-enabled (free)
- Add canonical URL, Open Graph tags, Google Search Console verification

---

## PHASE 3 — Submission System + Storage (~6 hours)

> User will specify submission system details later. Backend will use:
> - **Cloudflare Workers** (Hono.js) for API
> - **Cloudflare D1** (SQLite) for manuscript metadata, author records, tracking
> - **Cloudflare R2** for manuscript PDF storage
> - **Cloudflare Zero Trust** for editor dashboard protection

**Planned database tables:**
- `authors` — Author profiles (name, email, affiliation, ORCID)
- `manuscripts` — Submissions with tracking IDs (MPPT-2026-XXXX), status workflow
- `articles` — Published articles with DOI, volume, issue, pages

---

## PHASE 4 — AI Automation (~4 hours)

Using **Cloudflare Workers AI** (free, built-in):
1. Generate unique Tracking ID (`MPPT-2026-XXXX`)
2. Store PDF in R2
3. Run AI scope screening (Workers AI — Llama/Mistral models)
4. Send auto-acknowledgment email via Zoho SMTP
5. Notify editors with AI triage summary

---

## PHASE 5 — Article Pages + Academic Indexing (~4 hours)

Each published article gets a URL like: `https://mpptjournal.com/article/MPPT-2026-0001`

**Critical metadata (Highwire Press tags for Google Scholar):**
```html
<meta name="citation_title" content="[Article Title]">
<meta name="citation_author" content="[Author Name]">
<meta name="citation_publication_date" content="2026/09/15">
<meta name="citation_journal_title" content="Modern Pharmacy Praxis and Therapeutics">
<meta name="citation_volume" content="1">
<meta name="citation_pdf_url" content="https://mpptjournal.com/papers/MPPT-2026-0001.pdf">
```

---

## PHASE 6 — Archive + Search + SEO (~3 hours)

- Volume/Issue browser page
- Article search by title, author, keyword
- `sitemap.xml` (auto-generated)
- `robots.txt`
- Google Search Console verification

---

## Complete Free Academic Indexing & Visibility Checklist

### Tier 1 — Legitimate Indexing Databases (FREE)

| # | Database | Cost | Type | When to Apply | How |
|:---|:---|:---|:---|:---|:---|
| 1 | **Google Scholar** | FREE | Auto-crawled | Day 1 (site live) | Highwire Press meta tags + PDF links |
| 2 | **DOAJ** | FREE | Application | After 10 articles or 1 year | Apply at doaj.org/apply |
| 3 | **ISSN** | FREE | Application | After 1st article published | Apply via CSIR-NIScPR, New Delhi |
| 4 | **OpenAlex** | FREE | Auto-indexed | After Crossref DOIs | Automatic from DOI metadata |
| 5 | **BASE (Bielefeld)** | FREE | Submit sitemap | After sitemap is live | Submit at base-search.net |
| 6 | **Semantic Scholar** | FREE | Auto-indexed | After Crossref/arXiv | Automatic |
| 7 | **J-Gate** | FREE | Application | After ISSN | Apply via Informatics India |
| 8 | **Indian Science Abstracts (ISA)** | FREE | Application | After ISSN + articles | Apply via CSIR-NIScPR |
| 9 | **ROAD (ISSN Portal)** | FREE | Auto-listed | After ISSN | Automatic from ISSN registry |
| 10 | **UGC-CARE List** | FREE | Application | After ISSN + 1 volume | Apply via UGC portal |
| 11 | **Index Copernicus (ICI)** | FREE | Application | After 2+ issues | Register at indexcopernicus.com |
| 12 | **ScienceOpen** | FREE | Submit | After articles published | Submit collection at scienceopen.com |
| 13 | **WorldCat** | FREE | Auto-listed | After ISSN | Automatic via ISSN registry |
| 14 | **Crossref** | $200/yr | Membership | **DEFERRED — after revenue** | Apply at crossref.org |

### Tier 2 — Repositories & Academic Networks (FREE, use immediately)

| # | Platform | Cost | Type | When | How |
|:---|:---|:---|:---|:---|:---|
| 15 | **Zenodo** | FREE | Repository | Immediately | Upload article PDFs, get free DOI-like identifiers |
| 16 | **ResearchGate** | FREE | Social Network | Immediately | Authors share their papers |
| 17 | **Academia.edu** | FREE | Social Network | Immediately | Authors share papers |
| 18 | **Internet Archive** | FREE | Repository | After publishing | Archive published PDFs permanently |
| 19 | **ORCID** | FREE | Author ID | Immediately | Require authors to register ORCID |

### Tier 3 — Prestigious Databases (FREE to apply, long-term goals)

| # | Database | Cost | When | Requirement |
|:---|:---|:---|:---|:---|
| 20 | **PubMed / PMC** | FREE | Year 2+ | ISSN + 25 articles + NLM evaluation |
| 21 | **Scopus** | FREE | Year 3+ | 2+ years track record + citation metrics |
| 22 | **Web of Science (ESCI)** | FREE | Year 3+ | Strong editorial standards + citations |
| 23 | **EMBASE** | FREE | Year 2+ | Pharmacy/pharma focused; apply via Elsevier |

### What to AVOID (Misleading/Predatory Metrics)

> ❌ Do NOT pay for or display logos from these services — they damage journal credibility:
> - Cosmos Impact Factor
> - CiteFactor
> - DRJI (Directory of Research Journals Indexing)
> - Any service charging money to "index" your journal or give an "impact factor"

---

## Immediate Day-1 Actions (After Site Goes Live)

| Action | Tool | Cost |
|:---|:---|:---|
| Submit to Google Search Console | Google | FREE |
| Submit sitemap.xml | Google | FREE |
| Create Zenodo community for MPPT | Zenodo | FREE |
| Register MPPT on ORCID as a journal | ORCID | FREE |
| Create ResearchGate journal profile | ResearchGate | FREE |
| Apply for ISSN | CSIR-NIScPR | FREE |

---

## File Structure (Final)

```
mpptjournal/
├── index.html                    # Main journal homepage (FINISHING NOW)
├── robots.txt                    # [PHASE 6]
├── sitemap.xml                   # [PHASE 6] Auto-generated
├── css/
│   └── style.css                 # Existing + enhancements
├── js/
│   ├── main.js                   # Enhanced: real API submission [PHASE 3]
│   ├── scroll-engine.js          # Existing: cinematic hero
│   └── 3d-viewer.js              # Existing: WebGL molecule
├── article/
│   └── index.html                # [PHASE 5] Dynamic article page
├── archive/
│   └── index.html                # [PHASE 6] Volume/Issue browser
├── editor/
│   └── index.html                # [PHASE 3] Editorial dashboard
├── email_templates/              # Existing + new HTML templates
├── frames/                       # 120 webp frames (stays here for now)
├── logo/                         # Existing logos
├── worker/                       # [PHASE 3] Cloudflare Worker backend
│   ├── src/index.ts
│   ├── wrangler.toml
│   └── package.json
└── implementation_plan.md        # THIS FILE
```
