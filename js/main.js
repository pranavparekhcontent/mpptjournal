/**
 * MPPT Journal - Core Application Logic
 * Navigation, Modal Management, Manuscript Submission Generator, and Toast Notifications
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Mobile Menu Toggle
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const navMenu = document.getElementById('nav-menu');

  if (mobileToggle && navMenu) {
    mobileToggle.addEventListener('click', () => {
      navMenu.classList.toggle('open');
      mobileToggle.setAttribute(
        'aria-expanded',
        navMenu.classList.contains('open') ? 'true' : 'false'
      );
    });

    // Close menu when clicking any nav link
    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('open');
        mobileToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // 2. Sticky Navbar Glass Effect
  const navbar = document.querySelector('.site-header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }, { passive: true });

  // 3. Manuscript Submission Modal
  const modal = document.getElementById('submission-modal');
  const openModalBtns = document.querySelectorAll('.open-submission-modal');
  const closeModalBtns = document.querySelectorAll('.close-modal-btn');

  function openModal() {
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  openModalBtns.forEach((btn) => btn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  }));

  closeModalBtns.forEach((btn) => btn.addEventListener('click', closeModal));

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        closeModal();
      }
    });
  }

  // 4. Manuscript Submission Generator Form
  const submissionForm = document.getElementById('manuscript-form');
  if (submissionForm) {
    submissionForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const authorName = document.getElementById('sub-author').value.trim();
      const authorEmail = document.getElementById('sub-email').value.trim();
      const affiliation = document.getElementById('sub-affiliation').value.trim();
      const track = document.getElementById('sub-track').value;
      const title = document.getElementById('sub-title').value.trim();
      const abstract = document.getElementById('sub-abstract').value.trim();
      const keywords = document.getElementById('sub-keywords').value.trim();
      const ethicsChecked = document.getElementById('sub-ethics').checked;

      if (!ethicsChecked) {
        showToast('Please confirm ethical declarations & originality check.', 'warning');
        return;
      }

      // Build structured email body
      const subject = encodeURIComponent(`[MPPT Manuscript Submission] - ${track}: ${title.substring(0, 50)}...`);
      const bodyText = `Dear Editor-in-Chief,\n\n` +
        `I am pleased to submit our original research manuscript for consideration in the Modern Pharmacy Praxis and Therapeutics (MPPT Journal) - Volume 1 Inaugural Issue.\n\n` +
        `=== MANUSCRIPT METADATA ===\n` +
        `Title: ${title}\n` +
        `Primary Track: ${track}\n` +
        `Corresponding Author: ${authorName}\n` +
        `Institutional Affiliation: ${affiliation}\n` +
        `Email: ${authorEmail}\n` +
        `Keywords: ${keywords}\n\n` +
        `=== ABSTRACT ===\n` +
        `${abstract}\n\n` +
        `=== STATUTORY DECLARATION ===\n` +
        `• We declare that this work is original, has not been published previously, and is not under consideration elsewhere.\n` +
        `• All authors have approved the manuscript and consent to the CC-BY 4.0 Open Access publishing agreement upon acceptance.\n` +
        `• Relevant institutional ethics committee approvals have been secured.\n\n` +
        `[Please attach your complete Manuscript PDF/DOCX and Cover Letter directly to this email before sending.]\n\n` +
        `Sincerely,\n` +
        `${authorName}`;

      const mailtoUrl = `mailto:submission@mpptjournal.com?subject=${subject}&body=${encodeURIComponent(bodyText)}`;

      // Try triggering mail client
      window.location.href = mailtoUrl;

      showToast('Manuscript details prepared! Opening your email client...', 'success');
    });
  }

  // 5. Interactive Aims & Scope Topic Filters
  const topicTabs = document.querySelectorAll('.scope-tab-btn');
  const scopeCards = document.querySelectorAll('.scope-card');

  topicTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      topicTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const filter = tab.getAttribute('data-filter');

      scopeCards.forEach((card) => {
        if (filter === 'all' || card.getAttribute('data-category') === filter) {
          card.style.display = 'flex';
          setTimeout(() => { card.style.opacity = '1'; card.style.transform = 'translateY(0)'; }, 50);
        } else {
          card.style.opacity = '0';
          card.style.transform = 'translateY(10px)';
          setTimeout(() => { card.style.display = 'none'; }, 300);
        }
      });
    });
  });

  // 6. Copy-to-Clipboard Utility (e.g., citation, contact emails)
  const copyBtns = document.querySelectorAll('.copy-btn');
  copyBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const textToCopy = btn.getAttribute('data-copy');
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          showToast(`Copied to clipboard: "${textToCopy}"`, 'success');
        }).catch(() => {
          showToast('Failed to copy. Please copy manually.', 'error');
        });
      }
    });
  });

  // 7. Toast Notification Handler
  function showToast(message, type = 'info') {
    let toast = document.getElementById('mppt-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mppt-toast';
      toast.className = 'toast-notification';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `toast-notification show ${type}`;

    setTimeout(() => {
      toast.classList.remove('show');
    }, 4000);
  }

  window.showToast = showToast;
});
