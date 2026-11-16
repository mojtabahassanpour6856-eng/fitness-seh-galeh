/* Coach-only Top Genesis analyzer. A fresh iframe is bound to each selected trainee. */
(function () {
  "use strict";
  const PANEL_ID = "topGenesisPdfAnalyzerPanel";
  let observerStarted = false;
  let activeFrame = null;
  let boundTraineeId = null;
  let contextNonce = null;
  let host = null;

  function coachAndTrainee() {
    try {
      const profile = window.authProfile || (typeof authProfile !== "undefined" ? authProfile : null);
      const trainee = window.currentClient || (typeof currentClient !== "undefined" ? currentClient : null);
      if (profile?.role !== "coach" || !trainee?.id) return null;
      return { traineeId: String(trainee.id) };
    } catch (_) { return null; }
  }

  function createFrame(traineeId, nonce) {
    const frame = document.createElement("iframe");
    frame.id = "topGenesisPdfAnalyzerFrame";
    frame.title = "پیش‌نمایش تحلیل گزارش تاپ جنسیس";
    frame.loading = "eager";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.style.cssText = "display:block;width:100%;height:1100px;border:0;border-radius:10px;background:#f6f2e9";
    frame.dataset.boundTraineeId = traineeId;
    frame.dataset.contextNonce = nonce;
    frame.addEventListener("load", () => {
      if (activeFrame !== frame || boundTraineeId !== traineeId || contextNonce !== nonce) return;
      frame.contentWindow?.postMessage({
        type: "top-genesis-context",
        traineeId,
        contextNonce: nonce
      }, window.location.origin);
    });
    frame.src = "./top-genesis-pdf-test.html?embedded=1";
    return frame;
  }

  function mount() {
    const anchor = document.getElementById("bodyAnalysisEntryPanel");
    if (!anchor) return;
    const context = coachAndTrainee();
    if (!context) {
      if (host) host.style.display = "none";
      if (activeFrame) activeFrame.remove();
      activeFrame = null;
      boundTraineeId = null;
      contextNonce = null;
      return;
    }
    if (!host) {
      host = document.createElement("section");
      host.id = PANEL_ID;
      host.className = "top-genesis-pdf-analyzer";
      host.style.cssText = "margin-top:12px;padding:4px 0;overflow:hidden";
      host.innerHTML =
        '<h3 style="margin:0 0 8px">🧠 تحلیل هوشمند گزارش تاپ جنسیس (پی‌دی‌اف و بسته فشرده)</h3>' +
        '<p class="muted" style="margin:0 0 10px">استخراج شاخص‌ها، تشخیص متن از صفحات تصویری، نمودار ترکیب بدن، مقایسه دو گزارش، روند چندمرحله‌ای و گزارش قابل چاپ.</p>' +
        '<p style="margin:0 0 10px;padding:9px 11px;border-radius:9px;background:#fff4d5;color:#624b20;font-size:12px">این پیش‌نمایش فقط به شاگرد انتخاب‌شده فعلی متصل است. با تغییر شاگرد، فرم و فایل‌های قبلی کاملاً پاک و ابزار از نو بارگذاری می‌شود.</p>';
      anchor.appendChild(host);
    } else if (host.parentElement !== anchor) {
      anchor.appendChild(host);
    }
    host.style.display = "block";

    if (!activeFrame || boundTraineeId !== context.traineeId) {
      if (activeFrame) activeFrame.remove();
      boundTraineeId = context.traineeId;
      contextNonce = crypto.randomUUID();
      activeFrame = createFrame(context.traineeId, contextNonce);
      host.appendChild(activeFrame);
    }
  }

  function loadPublicationModule() {
    if (document.querySelector('script[data-top-genesis-publication-loader]')) return;
    const script = document.createElement("script");
    script.src = "./top-genesis-publication.js";
    script.defer = true;
    script.dataset.topGenesisPublicationLoader = "1";
    document.head.appendChild(script);
  }

  function start() {
    if (observerStarted) return;
    observerStarted = true;
    loadPublicationModule();
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    mount();
    window.setInterval(mount, 500);
  }

  function sendContextToActiveFrame() {
    if (!activeFrame || !boundTraineeId || !contextNonce) return;
    activeFrame.contentWindow?.postMessage({
      type: "top-genesis-context",
      traineeId: boundTraineeId,
      contextNonce
    }, window.location.origin);
  }

  window.addEventListener("message", event => {
    if (event.origin !== window.location.origin || !activeFrame ||
        event.source !== activeFrame.contentWindow) return;
    if (event.data?.type === "top-genesis-context-request") {
      sendContextToActiveFrame();
      return;
    }
    if (event.data?.type !== "top-genesis-pdf-height") return;
    const height = Number(event.data.height);
    if (Number.isFinite(height)) activeFrame.style.height =
      Math.max(900, Math.min(12000, Math.ceil(height) + 24)) + "px";
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();