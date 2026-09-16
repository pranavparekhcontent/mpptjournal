# MPPT Journal — PRE-ISSN FREE INDEXATION PLAN (₹0)
> Created: 2026-09-13 · Status: ISSN NOT yet applied · All services below verified free & eligible WITHOUT ISSN
> Companion docs: `FREE_INDEXING_REGISTRATION_GUIDE.md` (full 26-service master guide) · `implementation_plan.md`

---

## 1) ELIGIBLE NOW (no ISSN required)

| # | Index / Service | Category | Cost | Wait After Apply | Verified Status (live test 2026-09-13) |
|:--|:--|:--|:--|:--|:--|
| 1 | Zenodo / CERN | EU permanent archive + FREE DataCite DOI | ₹0 | Minutes | ❌ Current DOI dead (410) — redeposit needed |
| 2 | ORCID (founders' real iDs) | Author identity registry | ₹0 | Minutes | ❌ Site currently shows fake ORCIDs — fix needed |
| 3 | Google Scholar | Citations & discovery | ₹0 | 1–8 weeks (auto-crawl) | ⚠️ Tags correct; demo paper risk — see Section 4 |
| 4 | Semantic Scholar | AI discovery engine | ₹0 | Auto after DOI/OAI | ⚠️ "Auto-Ingested" claim not yet true |
| 5 | OpenAlex | Global scholarly graph | ₹0 | Auto after DOI | ❌ Live API test: count 0 — not yet indexed |
| 6 | CORE (UK Jisc) | OA aggregator, world's largest | ₹0 | Days–weeks | ⚠️ Needs compliant OAI feed (Worker) or Zenodo set |
| 7 | Internet Archive Scholar | Dark-archive preservation | ₹0 | Days | ⚠️ Form submission + sitemap |
| 8 | ScienceOpen | Interactive discovery | ₹0 | Days | ✅ Form-only, account needed |
| 9 | MIAR (Univ. Barcelona) | Journal existence database | ₹0 | Days | ✅ Form-only, no ISSN field required |
| 10 | Genamics JournalSeek | Academic directory | ₹0 | Days | ✅ Form-only |
| 11 | EuroPub | European index | ₹0 | Days | ✅ Form-only |
| 12 | SHERPA / Open Policy Finder (Jisc) | OA policy record | ₹0 | Days | ✅ Form-only — records your CC-BY policy |
| 13 | CiteSeerX | Digital library crawl | ₹0 | Auto | ✅ Passive crawl of PDFs |
| 14 | Scilit (MDPI) | Literature crawler | ₹0 | Auto | ✅ Passive (ingests after DOI exists) |
| 15 | Dimensions | Impact graph | ₹0 | Auto | ✅ Passive (ingests via DataCite/Zenodo) |
| 16 | Fatcat! / IA Partner | Open bibliographic catalog | ₹0 | Auto | ✅ Passive |
| 17 | Google Search Console | SEO verification | ₹0 | Immediate | ✅ Needs Google login |
| 18 | Bing Webmaster | SEO verification | ₹0 | Immediate | ✅ Needs Microsoft login (can import from GSC) |
| 19 | Wikidata item | Structured knowledge record | ₹0 | Immediate | ✅ Account + page creation |
| 20 | DataCite (via Zenodo) | Persistent identifier schema | ₹0 | Automatic with #1 | ✅ No separate application |

**Blocked until ISSN lands (DO NOT APPLY YET):** ROAD · WorldCat (OCLC) · DOAJ · UGC-CARE · Index Copernicus (asks ISSN) · J-Gate · CSIR-NIScPR/ISA.

---

## 2) WHAT AI (CLINE) WILL DO — automation work

| Step | Task | Files/Targets |
|:--|:--|:--|
| A1 | Redeposit sample paper to Zenodo (sandbox first) → capture NEW live DOI | `scripts/zenodo_archiver.js` (exists, needs token) |
| A2 | DOI sweep — replace/sweep 3 dead DOIs across all files | `index.html`, `oai-pmh.xml`, `certificate.html`, `email_templates/5_PUBLISHED_AND_ARCHIVED.html`, `paper sample/mppt_sample_paper.html` |
| A3 | Kill fake ORCIDs (Josiah Carberry + 3× 404s) | `scripts/zenodo_archiver.js`, `oai-pmh.xml`, any meta tags |
| A4 | Replace "ISSN Online: 3048-xxxx" in agreement modal with "Application in process (CSIR-NIScPR)" | `index.html` (author guidelines modal) |
| A5 | Badge honesty rewording: "● Active Index/Auto-Ingested/Live Extraction/Ingestion Queue/100% Compliant" → "● Application Queue / ● Target" | `index.html` #indexing section |
| A6 | Build compliant OAI-PMH Worker (`?verb=Identify/ListRecords/ListIdentifiers` routing) OR wire BASE/CORE to Zenodo's real OAI endpoint once community set exists | new `worker/oai-pmh.js` (Cloudflare Worker, free tier) |
| A7 | Demote demo paper from Scholar: strip `citation_doi` from mock, block `/paper%20sample/` in robots.txt until real papers exist | `robots.txt`, `paper sample/mppt_sample_paper.html` |
| A8 | Pre-fill ALL application answers (journal name, publisher, ISSN "in process", CC-BY 4.0, OAI URL, contact emails) into a copy-paste cheat sheet | this file, Section 5 |
| A9 | Update audit + statuses after each acceptance | this file, Section 6 |

---

## 3) WHAT YOU NEED TO DO MANUALLY — clicking work

| Step | Task | Where | Time |
|:--|:--|:--|:--|
| U1 | Create real ORCID accounts for Dr. Neharkar + Dr. Parekh | orcid.org/register | 5 min each |
| U2 | Create free Zenodo account (login via ORCID after U1) | zenodo.org | 2 min |
| U3 | Apply for ISSN (NaSSDocs / CSIR-NIScPR) — publisher declaration + sample issue | NaSSDocs portal | 30 min + 2–6 wks wait |
| U4 | BASE registration (submit OAI endpoint form) | base-search.net/about/en/suggest.php | 10 min |
| U5 | CORE registration (submit data-provider form) | core.ac.uk/data-providers | 10 min |
| U6 | Internet Archive Scholar — submit sitemap | scholar.archive.org | 5 min |
| U7 | ScienceOpen — create account + journal collection | scienceopen.com | 15 min |
| U8 | MIAR — journal registration form | miar.ub.edu | 5 min |
| U9 | Genamics JournalSeek — journal listing | journalseek.net | 5 min |
| U10 | EuroPub — journal registration | europub.co.uk | 5 min |
| U11 | SHERPA / Open Policy Finder — journal policy record | v2.sherpa.ac.uk/romeo | 5 min |
| U12 | Google Search Console — verify domain, submit sitemap | search.google.com/search-console | 10 min |
| U13 | Bing Webmaster — verify (import from GSC) | bing.com/webmasters | 5 min |
| U14 | Wikidata — create MPPT journal item | wikidata.org | 15 min |
| U15 | Zenodo Community "mppt-journal" — create after first deposit | zenodo.org/communities | 5 min |

*(All manual steps need email verification from your Zoho inbox — I can't receive those mails.)*

## 4) PRIORITY ORDER

**Week 1 (infrastructure):** A1 → A2 → A3 → A4 → A5 → A7 (fixes credibility) · U1, U2 (identities)
**Week 2 (applications):** U4, U5, U6, U7, U8, U9, U10, U11 (form-only indexes) · U12, U13 (SEO)
**Week 3+ (while ISSN pending):** U14, U15 · A6 (OAI Worker) · monitor auto-ingest (S2, OpenAlex, Scilit, Dimensions)
**After ISSN lands:** ROAD (auto) · WorldCat (auto) · DOAJ apply · UGC-CARE apply · Index Copernicus · J-Gate · ISA/NIScPR

---

## 5) COPY-PASTE CHEAT SHEET (same answers for every form)

- **Journal Title:** Modern Pharmacy Praxis and Therapeutics (MPPT Journal)
- **Publisher:** MPPT Journal Research Foundation · Pune, Maharashtra, India
- **Publisher (Person):** Dr. Vishnu Neharkar (Publisher & Founder) · editor@mpptjournal.com
- **Editor-in-Chief:** Dr. Pranav Parekh · editor@mpptjournal.com
- **Contact/Registration Email:** editor@mpptjournal.com
- **ISSN:** Application in process (CSIR-NIScPR / NaSSDocs, New Delhi) — enter only if field is optional
- **Country:** India · **Language:** English · **Started:** 2026 · **Medium:** Online
- **Scope:** Pharmaceutical sciences — pharmacology & toxicology, pharmaceutics & NDDS, clinical pharmacy & pharmacovigilance, AI & cheminformatics & drug design, phytotherapy & natural products, pharmaceutical analysis & regulatory affairs, interdisciplinary
- **Peer Review:** Double-blind, doctorate-level reviewers, first decision 14–21 days
- **OA Model:** Gold Open Access, no APC for Volume 1
- **License:** CC BY 4.0 International (https://creativecommons.org/licenses/by/4.0/)
- **Copyright:** Authors retain copyright, non-exclusive license to journal
- **Similarity Policy:** <10% (Turnitin/iThenticate-class screening)
- **OAI-PMH Endpoint:** https://mpptjournal.com/oai-pmh.xml (⚠️ use Zenodo community endpoint after A6/U15 — mention both)
- **Site:** https://mpptjournal.com · **Sitemap:** https://mpptjournal.com/sitemap.xml
- **Sample Article:** https://mpptjournal.com/paper%20sample/mppt_sample_paper (demo layout example)

---

## 6) STATUS LOG (update after each reply)

| Index | Applied On | Reply Received | Display on Website? |
|:--|:--|:--|:--|
| Zenodo/CERN | — | — | — |
| ORCID | — | — | — |
| BASE | — | — | — |
| CORE | — | — | — |
| IA Scholar | — | — | — |
| ScienceOpen | — | — | — |
| MIAR | — | — | — |
| JournalSeek | — | — | — |
| EuroPub | — | — | — |
| SHERPA | — | — | — |
| GSC / Bing | — | — | — |
| Wikidata | — | — | — |
