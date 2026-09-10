/**
 * MPPT Journal - High-Performance Scroll-Driven Canvas Animation Engine
 * Preloads 120 sequential 1080p frames and maps scroll progress to canvas rendering.
 */

(function () {
  const TOTAL_FRAMES = 120;
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  const frames = [];
  let loadedCount = 0;
  let currentFrameIndex = 1;
  let isTicking = false;

  const progressBar = document.getElementById('canvas-loading-progress');
  const loaderOverlay = document.getElementById('canvas-loader');

  // Format index to match frame_0001.webp format
  function getFramePath(index) {
    const padded = String(index).padStart(4, '0');
    return `frames/frame_${padded}.webp`;
  }

  // Preload all 120 frames
  function preloadImages() {
    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.src = getFramePath(i);

      img.onload = () => {
        loadedCount++;
        if (progressBar) {
          const pct = Math.round((loadedCount / TOTAL_FRAMES) * 100);
          progressBar.style.width = `${pct}%`;
        }
        if (loadedCount === TOTAL_FRAMES) {
          if (loaderOverlay) {
            loaderOverlay.style.opacity = '0';
            setTimeout(() => {
              loaderOverlay.style.display = 'none';
            }, 500);
          }
          // Render initial frame
          renderFrame(1);
        }
      };

      img.onerror = () => {
        loadedCount++;
        if (loadedCount === TOTAL_FRAMES && loaderOverlay) {
          loaderOverlay.style.opacity = '0';
          setTimeout(() => { loaderOverlay.style.display = 'none'; }, 500);
        }
      };

      frames.push(img);
    }
  }

  // Resize canvas with high-DPI scaling
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.scale(dpr, dpr);
    renderFrame(currentFrameIndex);
  }

  // Draw frame with object-fit: cover
  function renderFrame(index) {
    if (index < 1 || index > TOTAL_FRAMES) return;
    currentFrameIndex = index;
    const img = frames[index - 1];
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const canvasW = window.innerWidth;
    const canvasH = window.innerHeight;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;

    const canvasRatio = canvasW / canvasH;
    const imgRatio = imgW / imgH;

    let drawW, drawH, offsetX, offsetY;

    if (canvasRatio > imgRatio) {
      drawW = canvasW;
      drawH = canvasW / imgRatio;
      offsetX = 0;
      offsetY = (canvasH - drawH) / 2;
    } else {
      drawH = canvasH;
      drawW = canvasH * imgRatio;
      offsetX = (canvasW - drawW) / 2;
      offsetY = 0;
    }

    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  }

  // Map scroll distance of hero pinned area to frame index
  function onScroll() {
    if (!isTicking) {
      window.requestAnimationFrame(() => {
        const heroSection = document.getElementById('hero-scroll-container');
        if (heroSection) {
          const rect = heroSection.getBoundingClientRect();
          const scrollableDistance = heroSection.offsetHeight - window.innerHeight;
          const scrolled = -rect.top;
          const scrollFraction = Math.max(0, Math.min(1, scrolled / scrollableDistance));
          
          const frameIndex = Math.min(
            TOTAL_FRAMES,
            Math.max(1, Math.ceil(scrollFraction * TOTAL_FRAMES))
          );
          
          if (frameIndex !== currentFrameIndex) {
            renderFrame(frameIndex);
          }

          // Trigger narrative text overlays based on progress
          updateNarrativeCaptions(scrollFraction);
        }
        isTicking = false;
      });
      isTicking = true;
    }
  }

  // Narrative text milestone cross-fades
  function updateNarrativeCaptions(progress) {
    const c1 = document.getElementById('caption-1');
    const c2 = document.getElementById('caption-2');
    const c3 = document.getElementById('caption-3');
    const c4 = document.getElementById('caption-4');

    if (!c1 || !c2 || !c3 || !c4) return;

    // 0% - 25% : Intro
    setOpacity(c1, progress >= 0.0 && progress < 0.25);
    // 25% - 50% : Scientific Scope & Praxis
    setOpacity(c2, progress >= 0.25 && progress < 0.50);
    // 50% - 75% : Double Blind Review & Speed
    setOpacity(c3, progress >= 0.50 && progress < 0.75);
    // 75% - 100% : Open Access & Final Seal
    setOpacity(c4, progress >= 0.75);
  }

  function setOpacity(el, isActive) {
    if (isActive) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  }

  // Initialize
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('scroll', onScroll, { passive: true });

  resizeCanvas();
  preloadImages();
})();
