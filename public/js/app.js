/* SnatchNet — YouTube Downloader (v1) */
(function () {
  "use strict";

  // ── Mobile menu toggle ────────────────────────────────────────────────────
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("hidden");
    });
    mobileMenu.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => mobileMenu.classList.add("hidden"));
    });
  }

  // ── Smart sticky nav (hide on scroll down, show on scroll up) ────────────
  const mainNav = document.getElementById("main-nav");
  const heroSection = document.getElementById("hero-section");

  function updateNavStyle() {
    if (!heroSection) return;
    const heroBottom = heroSection.getBoundingClientRect().bottom;
    if (heroBottom > 0) {
      mainNav.classList.add("nav-transparent");
    } else {
      mainNav.classList.remove("nav-transparent");
    }
  }

  let lastScrollY = window.scrollY;
  window.addEventListener("scroll", () => {
    const currentY = window.scrollY;
    if (currentY > lastScrollY && currentY > 80) {
      mainNav.classList.add("nav-hidden");
      if (mobileMenu) mobileMenu.classList.add("hidden");
    } else {
      mainNav.classList.remove("nav-hidden");
    }
    lastScrollY = currentY;
    updateNavStyle();
  }, { passive: true });

  updateNavStyle();

  const YT_PATTERNS = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?.*v=[\w-]+/,
    /^https?:\/\/youtu\.be\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]+/,
    /^https?:\/\/m\.youtube\.com\/watch\?.*v=[\w-]+/,
  ];

  const $ = (id) => document.getElementById(id);

  const urlInput = $("url-input");
  const convertBtn = $("convert-btn");
  const btnText = $("btn-text");
  const btnArrow = $("btn-arrow");
  const btnSpinner = $("btn-spinner");
  const clearBtn = $("clear-btn");
  const errorMsg = $("error-msg");
  const errorText = $("error-text");
  const resultSection = $("result-section");
  const resultThumb = $("result-thumb");
  const resultTitle = $("result-title");

  // ── URL validation ────────────────────────────────────────────────────────
  function isYouTubeUrl(url) {
    return YT_PATTERNS.some((p) => p.test(url.trim()));
  }

  // ── Show/hide helpers ─────────────────────────────────────────────────────
  function showError(msg) {
    errorText.textContent = msg;
    errorMsg.classList.remove("hidden");
    resultSection.classList.add("hidden");
  }

  function hideError() {
    errorMsg.classList.add("hidden");
  }

  function setLoading(loading) {
    convertBtn.disabled = loading;
    btnText.textContent = loading ? "Fetching…" : "Convert";
    btnArrow.classList.toggle("hidden", loading);
    btnSpinner.classList.toggle("hidden", !loading);
  }

  function formatDuration(seconds) {
    if (!seconds) return "";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatCount(n) {
    if (!n && n !== 0) return "";
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return n.toLocaleString();
  }

  function formatUploadDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch { return iso; }
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
    return (bytes / 1e3).toFixed(0) + " KB";
  }

  // ── Download with progress ─────────────────────────────────────────────
  const dlToast = document.getElementById("dl-toast");
  const dlBar = document.getElementById("dl-progress-bar");
  const dlLabel = document.getElementById("dl-toast-label");
  const dlPct = document.getElementById("dl-toast-pct");
  const dlSub = document.getElementById("dl-toast-sub");
  const dlSpinner = document.getElementById("dl-toast-spinner");
  const dlCheck = document.getElementById("dl-toast-check");

  function showToast(label, sub) {
    dlLabel.textContent = label;
    dlSub.textContent = sub || "";
    dlBar.style.width = "0%";
    dlPct.textContent = "";
    dlSpinner.classList.remove("hidden");
    dlCheck.classList.add("hidden");
    dlToast.classList.remove("hidden");
  }

  function updateToastProgress(pct) {
    dlBar.style.width = pct + "%";
    dlPct.textContent = pct + "%";
  }

  function completeToast() {
    dlBar.style.width = "100%";
    dlPct.textContent = "100%";
    dlSpinner.classList.add("hidden");
    dlCheck.classList.remove("hidden");
    dlLabel.textContent = "Download complete!";
    dlSub.textContent = "Your file has been saved.";
    setTimeout(() => dlToast.classList.add("hidden"), 3000);
  }

  function failToast(msg) {
    dlLabel.textContent = "Download failed";
    dlSub.textContent = msg || "Please try again.";
    dlSpinner.classList.add("hidden");
    dlBar.style.width = "0%";
    setTimeout(() => dlToast.classList.add("hidden"), 4000);
  }

  window.handleDownload = async function (btn, downloadUrl, quality) {
    // Disable all download buttons while one is in progress
    const allBtns = document.querySelectorAll("[id^='panel-'] button");
    allBtns.forEach((b) => { b.disabled = true; b.style.opacity = "0.5"; });

    // Spinner on clicked button
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<svg class="w-3.5 h-3.5 spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
    </svg> Preparing…`;

    const isAudio = quality === "audio" || quality === "mp3";
    showToast(
      isAudio ? "Preparing audio…" : `Preparing ${quality} video…`,
      "Downloading and merging streams, please wait…"
    );

    try {
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${response.status}`);
      }

      // Stream with progress
      const contentLength = response.headers.get("Content-Length");
      const total = contentLength ? parseInt(contentLength) : 0;
      let loaded = 0;
      const reader = response.body.getReader();
      const chunks = [];

      // Indeterminate phase (server is merging — no bytes yet)
      let indeterminate = 0;
      if (!total) {
        dlSub.textContent = "Server is merging streams…";
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total) {
          updateToastProgress(Math.min(99, Math.round((loaded / total) * 100)));
        } else {
          // Indeterminate — animate the bar
          indeterminate = Math.min(90, indeterminate + (value.length / 500000));
          updateToastProgress(Math.round(indeterminate));
          dlPct.textContent = formatSize(loaded) + " received";
        }
      }

      // Assemble blob
      const mimeType = quality === "mp3" ? "audio/mpeg" : (isAudio ? "audio/mp4" : "video/mp4");
      const blob = new Blob(chunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      // Extract filename from Content-Disposition
      const cd = response.headers.get("Content-Disposition") || "";
      const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/);
      const plainMatch = cd.match(/filename="([^"]+)"/);
      const filename = utf8Match
        ? decodeURIComponent(utf8Match[1])
        : plainMatch
          ? plainMatch[1]
          : (isAudio ? "audio.m4a" : "video.mp4");

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

      completeToast();
    } catch (err) {
      failToast(err.message);
    } finally {
      btn.innerHTML = originalHTML;
      allBtns.forEach((b) => { b.disabled = false; b.style.opacity = ""; });
    }
  };

  // ── Tab switching (exposed globally for onclick) ─────────────────────────
  window.switchTab = function (tab) {
    const isVideo = tab === "video";
    document.getElementById("panel-video").classList.toggle("hidden", !isVideo);
    document.getElementById("panel-audio").classList.toggle("hidden", isVideo);

    const tabVideo = document.getElementById("tab-video");
    const tabAudio = document.getElementById("tab-audio");

    tabVideo.className = isVideo
      ? "flex-1 py-3 text-sm font-bold border-b-2 border-gray-900 text-gray-900 transition"
      : "flex-1 py-3 text-sm font-bold border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition";
    tabAudio.className = !isVideo
      ? "flex-1 py-3 text-sm font-bold border-b-2 border-gray-900 text-gray-900 transition"
      : "flex-1 py-3 text-sm font-bold border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition";
  };

  // ── Build a single format row ─────────────────────────────────────────────
  function buildFormatRow(f, originalUrl) {
    const downloadUrl = `/api/download?url=${encodeURIComponent(originalUrl)}&format=${encodeURIComponent(f.quality)}`;
    const isAudio = f.quality === "audio" || f.quality === "mp3";

    const LABELS = {
      "2160p": "2160p — 4K Ultra HD",
      "1080p": "1080p — Full HD",
      "720p": "720p — HD",
      "480p": "480p",
      "360p": "360p",
      "audio": "M4A Audio",
      "mp3": "MP3 Audio",
    };
    const label = LABELS[f.quality] || f.quality.toUpperCase();
    const ext = (f.ext || (isAudio ? "m4a" : "mp4")).toUpperCase();

    const sizeLabel = f.filesize
      ? `<span class="text-gray-400 text-sm">${formatSize(f.filesize)}</span>`
      : `<span class="text-gray-300 text-sm">—</span>`;

    const btnClass = isAudio
      ? "inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 active:scale-95 text-white font-semibold text-xs py-2 px-4 rounded-lg transition-all whitespace-nowrap"
      : "inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-semibold text-xs py-2 px-4 rounded-lg transition-all whitespace-nowrap";

    return `
      <div class="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition">
        <div class="flex flex-col">
          <span class="text-sm font-semibold text-gray-800">${label}</span>
          <span class="text-xs text-gray-400">${ext}</span>
        </div>
        ${sizeLabel}
        <button onclick="handleDownload(this, '${downloadUrl}', '${f.quality}')" class="${btnClass}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
          Download
        </button>
      </div>`;
  }

  // ── Extract YouTube video ID from any YT URL ────────────────────────────
  function extractVideoId(url) {
    const patterns = [
      /[?&]v=([\w-]+)/,
      /youtu\.be\/([\w-]+)/,
      /shorts\/([\w-]+)/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  // ── Swap thumbnail preview for live YouTube iframe ───────────────────────
  window.loadVideoPlayer = function () {
    const preview = document.getElementById("result-preview");
    if (!preview) return;
    const videoId = preview.dataset.videoId;
    if (!videoId) return;
    preview.innerHTML = `<iframe class="w-full h-full absolute inset-0 rounded-xl" src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    preview.onclick = null;
    preview.classList.remove("cursor-pointer", "group");
  };

  // ── Toggle description expand/collapse ───────────────────────────────────
  window.toggleDescription = function () {
    const descEl = document.getElementById("result-description");
    const btn = document.getElementById("result-desc-toggle");
    if (!descEl || !btn) return;
    const collapsed = descEl.classList.contains("line-clamp-2");
    descEl.classList.toggle("line-clamp-2", !collapsed);
    btn.textContent = collapsed ? "Show less" : "Show more";
  };

  // ── Show result ───────────────────────────────────────────────────────────
  function showResult(data, originalUrl) {
    const thumb = data.thumbnail || "";
    const videoId = extractVideoId(originalUrl);

    // Reset preview container back to thumbnail state (handles "Convert Another")
    const preview = document.getElementById("result-preview");
    if (preview) {
      preview.dataset.videoId = videoId || "";
      preview.onclick = window.loadVideoPlayer;
      if (!preview.classList.contains("cursor-pointer")) {
        preview.classList.add("cursor-pointer", "group");
      }
      preview.innerHTML = `
        <img id="result-thumb-lg" src="${thumb}" alt="" class="w-full h-full object-cover absolute inset-0" />
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition"></div>
        <div class="relative z-10 w-16 h-16 bg-white/80 backdrop-blur rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
          <svg class="w-8 h-8 text-gray-800 ml-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span class="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80 font-medium">Click to preview</span>`;
    }

    // small info-bar thumb
    resultThumb.src = thumb;

    resultTitle.textContent = data.title;

    // Channel link
    const channelLink = document.getElementById("result-channel-link");
    document.getElementById("result-channel-name").textContent = data.uploader || "";
    if (channelLink) channelLink.href = data.channel_url || "#";

    // Duration
    const durVal = document.getElementById("result-duration-val");
    const durWrap = document.getElementById("result-duration-text");
    if (data.duration) {
      if (durVal) durVal.textContent = formatDuration(data.duration);
      if (durWrap) durWrap.classList.remove("hidden");
    } else {
      if (durWrap) durWrap.classList.add("hidden");
    }

    // Upload date
    const dateVal = document.getElementById("result-date-val");
    const dateWrap = document.getElementById("result-upload-date");
    const formattedDate = formatUploadDate(data.upload_date);
    if (formattedDate) {
      if (dateVal) dateVal.textContent = formattedDate;
      if (dateWrap) dateWrap.classList.remove("hidden");
    } else {
      if (dateWrap) dateWrap.classList.add("hidden");
    }

    // Views
    const viewsEl = document.getElementById("result-views");
    const viewsVal = document.getElementById("result-views-val");
    if (data.view_count != null) {
      if (viewsVal) viewsVal.textContent = formatCount(data.view_count) + " views";
      if (viewsEl) viewsEl.classList.remove("hidden"), viewsEl.classList.add("inline-flex");
    } else {
      if (viewsEl) viewsEl.classList.add("hidden");
    }

    // Likes
    const likesEl = document.getElementById("result-likes");
    const likesVal = document.getElementById("result-likes-val");
    if (data.like_count != null) {
      if (likesVal) likesVal.textContent = formatCount(data.like_count) + " likes";
      if (likesEl) likesEl.classList.remove("hidden"), likesEl.classList.add("inline-flex");
    } else {
      if (likesEl) likesEl.classList.add("hidden");
    }

    // Description
    const descWrap = document.getElementById("result-desc-wrap");
    const descEl = document.getElementById("result-description");
    const descToggle = document.getElementById("result-desc-toggle");
    if (data.description && data.description.trim()) {
      if (descEl) {
        descEl.textContent = data.description;
        descEl.classList.add("line-clamp-2");
      }
      if (descToggle) descToggle.textContent = "Show more";
      if (descWrap) descWrap.classList.remove("hidden");
    } else {
      if (descWrap) descWrap.classList.add("hidden");
    }

    const formats = data.formats || [];
    const videoFormats = formats.filter((f) => f.quality !== "audio" && f.quality !== "mp3");
    const audioFormats = formats.filter((f) => f.quality === "audio" || f.quality === "mp3");

    document.getElementById("result-video-formats").innerHTML =
      videoFormats.length
        ? videoFormats.map((f) => buildFormatRow(f, originalUrl)).join("")
        : `<p class="text-sm text-gray-400 px-4 py-3">No video formats available.</p>`;

    document.getElementById("result-audio-formats").innerHTML =
      audioFormats.length
        ? audioFormats.map((f) => buildFormatRow(f, originalUrl)).join("")
        : `<p class="text-sm text-gray-400 px-4 py-3">No audio formats available.</p>`;

    window.switchTab("video");

    // Hide hero & feature cards, shrink section padding
    const heroContent = document.getElementById("hero-content");
    const featureCards = document.getElementById("feature-cards");
    const heroSection = document.getElementById("hero-section");
    if (heroContent) heroContent.classList.add("hidden");
    if (featureCards) featureCards.classList.add("hidden");
    if (heroSection) heroSection.className = "bg-pattern min-h-[100dvh] flex flex-col items-center justify-center px-4 pt-20 pb-12";

    // Wire up "Convert Another" button
    const cab = document.getElementById("convert-another-btn");
    if (cab) {
      cab.onclick = () => {
        resultSection.classList.add("hidden");
        if (heroContent) heroContent.classList.remove("hidden");
        if (featureCards) featureCards.classList.remove("hidden");
        if (heroSection) heroSection.className = "bg-pattern min-h-[100dvh] flex flex-col items-center justify-center px-4 text-center";
        urlInput.value = "";
        clearBtn.classList.add("hidden");
        hideError();
        urlInput.focus();
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    }

    resultSection.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // ── Main fetch ────────────────────────────────────────────────────────────
  async function handleConvert() {
    const url = urlInput.value.trim();

    if (!url) {
      showError("Please paste a YouTube URL first.");
      return;
    }

    if (!isYouTubeUrl(url)) {
      showError("That doesn't look like a YouTube URL. Only youtube.com and youtu.be links are supported.");
      return;
    }

    hideError();
    setLoading(true);
    resultSection.classList.add("hidden");

    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || "Failed to fetch video info. Please try again.");
        return;
      }

      showResult(data, url);
    } catch {
      showError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────────
  convertBtn.addEventListener("click", handleConvert);

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConvert();
  });

  urlInput.addEventListener("input", () => {
    const hasValue = urlInput.value.length > 0;
    clearBtn.classList.toggle("hidden", !hasValue);
    if (!hasValue) {
      hideError();
      resultSection.classList.add("hidden");
    }
  });

  // ── Modal open / close ─────────────────────────────────────────────────────────────────────
  window.openModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  };

  window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("hidden");
    document.body.style.overflow = "";
  };

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll("[id^='modal-']").forEach(function (m) {
        m.classList.add("hidden");
      });
      document.body.style.overflow = "";
    }
  });

  clearBtn.addEventListener("click", () => {
    urlInput.value = "";
    clearBtn.classList.add("hidden");
    hideError();
    resultSection.classList.add("hidden");
    urlInput.focus();
  });
})();
