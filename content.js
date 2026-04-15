(() => {
  "use strict";

  function isPWA() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      navigator.standalone === true
    );
  }

  // GIF89a and GIF87a magic bytes
  const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38]; // "GIF8"

  // ── Dynamic domain list (loaded from storage) ──
  let blockedDomains = [];

  function domainMatches(hostname, domain) {
    hostname = hostname.toLowerCase();
    domain = domain.toLowerCase();
    return hostname === domain || hostname.endsWith("." + domain);
  }

  function isOnBlockedSite() {
    return blockedDomains.some((d) => domainMatches(location.hostname, d));
  }

  function isBlockedUrl(src) {
    if (!src) {
      return false;
    }
    try {
      const url = new URL(src, location.href);
      return blockedDomains.some((d) => domainMatches(url.hostname, d));
    } catch {
      return false;
    }
  }

  function isBlockedEmbed(src) {
    if (!src) {
      return false;
    }
    try {
      const url = new URL(src, location.href);
      if (!blockedDomains.some((d) => domainMatches(url.hostname, d))) {
        return false;
      }
      return url.pathname.includes("/video/") || url.pathname.includes("/embed/");
    } catch {
      return false;
    }
  }

  // ── Blocked CSS classes ──
  // blockedClasses: { "*": ["class1"], "cnn.com": ["class2"] }
  let blockedClasses = {};
  let injectedStyleEl = null;

  function getPageHostname() {
    return location.hostname.toLowerCase().replace(/^www\./, "");
  }

  function getActiveClasses() {
    const globalClasses = blockedClasses["*"] || [];
    const host = getPageHostname();
    // Collect classes from all matching domain keys
    let siteClasses = [];
    for (const domain of Object.keys(blockedClasses)) {
      if (domain === "*") {
        continue;
      }
      if (domainMatches(host, domain) || domainMatches("www." + host, domain)) {
        siteClasses = siteClasses.concat(blockedClasses[domain]);
      }
    }
    // Deduplicate
    return [...new Set([...globalClasses, ...siteClasses])];
  }

  function applyBlockedClasses() {
    const classes = getActiveClasses();
    if (classes.length === 0) {
      if (injectedStyleEl) {
        injectedStyleEl.remove();
        injectedStyleEl = null;
      }
      return;
    }

    const css = classes.map((cls) => "." + CSS.escape(cls)).join(",\n") +
      " {\n  display: none !important;\n}";

    if (!injectedStyleEl) {
      injectedStyleEl = document.createElement("style");
      injectedStyleEl.id = "gif-blocker-blocked-classes";
      (document.head || document.documentElement).appendChild(injectedStyleEl);
    }
    injectedStyleEl.textContent = css;
  }

  function removeBlockedClasses() {
    if (injectedStyleEl) {
      injectedStyleEl.remove();
      injectedStyleEl = null;
    }
  }

  // ── GIF detection (works on all sites) ──

  function hasGifExtension(src) {
    if (!src) {
      return false;
    }
    try {
      const url = new URL(src, location.href);
      return url.pathname.toLowerCase().endsWith(".gif");
    } catch {
      return /\.gif(\?|$)/i.test(src);
    }
  }

  async function isGifByFetch(src) {
    if (!src || src.startsWith("data:")) {
      return false;
    }
    try {
      const resp = await fetch(src, { method: "GET", headers: { Range: "bytes=0-5" } });
      const contentType = resp.headers.get("Content-Type") || "";
      if (contentType.includes("image/gif")) {
        return true;
      }

      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length >= 4) {
        return bytes[0] === GIF_MAGIC[0] &&
               bytes[1] === GIF_MAGIC[1] &&
               bytes[2] === GIF_MAGIC[2] &&
               bytes[3] === GIF_MAGIC[3];
      }
    } catch {
      // Network error or CORS
    }
    return false;
  }

  const checkedUrls = new Map();

  function isGif(src) {
    if (!src || src.startsWith("data:")) {
      return Promise.resolve(false);
    }
    if (hasGifExtension(src)) {
      return Promise.resolve(true);
    }
    if (isBlockedUrl(src)) {
      return Promise.resolve(true);
    }

    if (checkedUrls.has(src)) {
      return checkedUrls.get(src);
    }
    const result = isGifByFetch(src);
    checkedUrls.set(src, result);
    return result;
  }

  // ── Freeze / unfreeze helpers ──

  function freezeGif(img) {
    if (img.dataset.gifFrozen) {
      return;
    }
    img.dataset.gifFrozen = "true";

    if (!img.complete || img.naturalWidth === 0) {
      img.addEventListener("load", () => freezeGif(img), { once: true });
      img.dataset.gifFrozen = "";
      return;
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      img.dataset.gifOriginalSrc = img.src;
      img.src = canvas.toDataURL("image/png");
    } catch {
      img.dataset.gifOriginalSrc = img.src;
      img.style.setProperty("image-rendering", "optimizeSpeed", "important");
      img.src = img.src;
    }
  }

  function unfreezeGif(img) {
    if (!img.dataset.gifOriginalSrc) {
      return;
    }
    img.src = img.dataset.gifOriginalSrc;
    delete img.dataset.gifOriginalSrc;
    delete img.dataset.gifFrozen;
  }

  function freezeBackgroundGifs(element) {
    const bg = getComputedStyle(element).backgroundImage;
    if (!bg || bg === "none") {
      return;
    }

    if (/\.gif(\?|"|'|\))/i.test(bg)) {
      element.dataset.gifOriginalBg = bg;
      element.style.setProperty("animation-play-state", "paused", "important");
      element.style.setProperty("background-image", "none", "important");
      return;
    }

    const urlMatch = bg.match(/url\(["']?(.*?)["']?\)/);
    if (urlMatch && urlMatch[1]) {
      const bgUrl = urlMatch[1];
      if (bgUrl.startsWith("data:")) {
        return;
      }
      isGif(bgUrl).then((gif) => {
        if (gif) {
          element.dataset.gifOriginalBg = bg;
          element.style.setProperty("animation-play-state", "paused", "important");
          element.style.setProperty("background-image", "none", "important");
        }
      });
    }
  }

  function unfreezeBackgroundGifs(element) {
    if (element.dataset.gifOriginalBg) {
      element.style.removeProperty("background-image");
      element.style.removeProperty("animation-play-state");
      delete element.dataset.gifOriginalBg;
    }
  }

  // ── Iframes ──

  function freezeIframe(iframe) {
    if (iframe.dataset.gifFrozen) {
      return;
    }
    if (!isBlockedEmbed(iframe.src)) {
      return;
    }
    iframe.dataset.gifFrozen = "true";
    iframe.dataset.gifOriginalSrc = iframe.src;
    iframe.removeAttribute("src");
    iframe.style.setProperty("display", "none", "important");
  }

  function unfreezeIframe(iframe) {
    if (!iframe.dataset.gifOriginalSrc) {
      return;
    }
    iframe.src = iframe.dataset.gifOriginalSrc;
    iframe.style.removeProperty("display");
    delete iframe.dataset.gifOriginalSrc;
    delete iframe.dataset.gifFrozen;
  }

  // ── Videos ──

  function shouldFreezeVideo(video) {
    const src = video.src || video.currentSrc || video.querySelector("source")?.src || "";
    if (isOnBlockedSite()) {
      return true;
    }
    if (isBlockedUrl(src)) {
      return true;
    }
    return false;
  }

  function freezeVideo(video) {
    if (video.dataset.gifFrozen) {
      return;
    }
    if (!shouldFreezeVideo(video)) {
      return;
    }
    video.dataset.gifFrozen = "true";

    video.pause();
    video.currentTime = 0;
    video.autoplay = false;
    video.loop = false;

    video._origPlay = video.play;
    video.play = () => Promise.resolve();

    video._gifBlockHandler = () => {
      video.pause();
      video.currentTime = 0;
    };
    video.addEventListener("playing", video._gifBlockHandler);
  }

  function unfreezeVideo(video) {
    if (!video.dataset.gifFrozen) {
      return;
    }
    if (video._origPlay) {
      video.play = video._origPlay;
      delete video._origPlay;
    }
    if (video._gifBlockHandler) {
      video.removeEventListener("playing", video._gifBlockHandler);
      delete video._gifBlockHandler;
    }
    video.autoplay = true;
    video.loop = true;
    delete video.dataset.gifFrozen;
  }

  // ── <picture> elements ──

  function freezePicture(picture) {
    if (picture.dataset.gifFrozen) {
      return;
    }
    const sources = picture.querySelectorAll("source");
    const img = picture.querySelector("img");
    const hasSrc = Array.from(sources).some((s) => isBlockedUrl(s.srcset || s.src));
    const imgBlocked = img && isBlockedUrl(img.src);
    if (!hasSrc && !imgBlocked && !isOnBlockedSite()) {
      return;
    }

    picture.dataset.gifFrozen = "true";
    sources.forEach((s) => {
      s.dataset.gifOriginalSrcset = s.srcset || "";
      s.dataset.gifOriginalSrc = s.src || "";
      s.removeAttribute("srcset");
      s.removeAttribute("src");
    });
    if (img) {
      freezeGif(img);
    }
  }

  function unfreezePicture(picture) {
    if (!picture.dataset.gifFrozen) {
      return;
    }
    picture.querySelectorAll("source").forEach((s) => {
      if (s.dataset.gifOriginalSrcset) {
        s.srcset = s.dataset.gifOriginalSrcset;
      }
      if (s.dataset.gifOriginalSrc) {
        s.src = s.dataset.gifOriginalSrc;
      }
      delete s.dataset.gifOriginalSrcset;
      delete s.dataset.gifOriginalSrc;
    });
    const img = picture.querySelector("img");
    if (img) {
      unfreezeGif(img);
    }
    delete picture.dataset.gifFrozen;
  }

  // ── Blocked-site autoplay containers ──

  function freezeAutoplayContainers() {
    if (!isOnBlockedSite()) {
      return;
    }
    document.querySelectorAll("[data-video-id], [data-uri*='video'], .media__video").forEach((el) => {
      if (el.dataset.gifFrozen) {
        return;
      }
      el.dataset.gifFrozen = "true";
      el.querySelectorAll("video").forEach(freezeVideo);
    });
  }

  // ── Freeze / unfreeze all ──

  function freezeAll() {
    document.querySelectorAll("img").forEach((img) => {
      if (img.dataset.gifFrozen) {
        return;
      }
      const src = img.src || img.dataset.gifOriginalSrc;
      isGif(src).then((gif) => {
        if (gif) {
          freezeGif(img);
        }
      });
    });
    document.querySelectorAll("picture").forEach(freezePicture);
    document.querySelectorAll("iframe").forEach(freezeIframe);
    document.querySelectorAll("video").forEach(freezeVideo);
    document.querySelectorAll("*").forEach((el) => {
      freezeBackgroundGifs(el);
    });
    freezeAutoplayContainers();
    applyBlockedClasses();
  }

  function unfreezeAll() {
    document.querySelectorAll("img[data-gif-frozen]").forEach(unfreezeGif);
    document.querySelectorAll("picture[data-gif-frozen]").forEach(unfreezePicture);
    document.querySelectorAll("iframe[data-gif-frozen]").forEach(unfreezeIframe);
    document.querySelectorAll("video[data-gif-frozen]").forEach(unfreezeVideo);
    document.querySelectorAll("[data-gif-original-bg]").forEach(unfreezeBackgroundGifs);
    removeBlockedClasses();
  }

  // ── Mutation observer ──

  let observer = null;

  function checkAndFreezeImg(img) {
    if (img.dataset.gifFrozen) {
      return;
    }
    isGif(img.src).then((gif) => {
      if (gif) {
        freezeGif(img);
      }
    });
  }

  function checkAddedNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const tag = node.tagName;
    if (tag === "IMG") {
      checkAndFreezeImg(node);
    }
    if (tag === "PICTURE") {
      freezePicture(node);
    }
    if (tag === "IFRAME") {
      freezeIframe(node);
    }
    if (tag === "VIDEO") {
      freezeVideo(node);
    }
    node.querySelectorAll?.("img").forEach(checkAndFreezeImg);
    node.querySelectorAll?.("picture").forEach(freezePicture);
    node.querySelectorAll?.("iframe").forEach(freezeIframe);
    node.querySelectorAll?.("video").forEach(freezeVideo);
    freezeBackgroundGifs(node);
    if (isOnBlockedSite() && (node.dataset?.videoId || node.classList?.contains("media__video"))) {
      if (!node.dataset.gifFrozen) {
        node.dataset.gifFrozen = "true";
        node.querySelectorAll?.("video").forEach(freezeVideo);
      }
    }
  }

  function startObserving() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          checkAddedNode(node);
        }
        if (mutation.type === "attributes" && mutation.attributeName === "src") {
          const target = mutation.target;
          if (target.dataset.gifFrozen) {
            continue;
          }
          if (target.tagName === "IMG") {
            checkAndFreezeImg(target);
          }
          if (target.tagName === "IFRAME") {
            freezeIframe(target);
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ── Main init ──

  const DEFAULT_DOMAINS = ["giphy.com", "cnn.com"];

  function init() {
    chrome.storage.sync.get(
      { enabled: true, pwaOnly: true, blockedDomains: DEFAULT_DOMAINS, blockedClasses: {} },
      (settings) => {
        blockedDomains = settings.blockedDomains;
        blockedClasses = settings.blockedClasses;
        const shouldBlock = settings.enabled && (!settings.pwaOnly || isPWA());

        if (shouldBlock) {
          freezeAll();
          startObserving();
        }
      }
    );
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "toggle") {
      blockedDomains = message.blockedDomains || blockedDomains;
      blockedClasses = message.blockedClasses || blockedClasses;
      if (message.enabled) {
        const shouldBlock = !message.pwaOnly || isPWA();
        if (shouldBlock) {
          freezeAll();
          startObserving();
        }
      } else {
        stopObserving();
        unfreezeAll();
      }
    }
    if (message.action === "domainsUpdated") {
      blockedDomains = message.blockedDomains || [];
      unfreezeAll();
      chrome.storage.sync.get({ enabled: true, pwaOnly: true }, (settings) => {
        const shouldBlock = settings.enabled && (!settings.pwaOnly || isPWA());
        if (shouldBlock) {
          freezeAll();
          if (!observer) {
            startObserving();
          }
        }
      });
    }
    if (message.action === "classesUpdated") {
      blockedClasses = message.blockedClasses || {};
      chrome.storage.sync.get({ enabled: true, pwaOnly: true }, (settings) => {
        const shouldBlock = settings.enabled && (!settings.pwaOnly || isPWA());
        if (shouldBlock) {
          applyBlockedClasses();
        } else {
          removeBlockedClasses();
        }
      });
    }
    if (message.action === "getStatus") {
      chrome.runtime.sendMessage({
        action: "status",
        isPWA: isPWA(),
        frozen: document.querySelectorAll("[data-gif-frozen]").length,
      });
    }
  });

  init();
})();
