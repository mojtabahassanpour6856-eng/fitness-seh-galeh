/* Coach-only entry point for the isolated Top Genesis PDF analyzer.
 * The embedded analyzer processes files locally; it never writes to trainee records.
 */
(function () {
  "use strict";
  const PANEL_ID = "topGenesisPdfAnalyzerPanel";
  let observerStarted = false;

  function isCoach() {
    try {
      return typeof authProfile !== "undefined" && authProfile?.role === "coach";
    } catch (_) {
      return false;
    }
  }

  function mount() {
    const anchor = document.getElementById("bodyAnalysisEntryPanel");
    if (!anchor) return;
    let host = document.getElementById(PANEL_ID);
    if (!host) {
      host = document.createElement("section");
      host.id = PANEL_ID;
      host.className = "card";
      host.style.cssText = "margin-top:14px;border:1px solid #d8b65d;background:#fffdf7;padding:12px;overflow:hidden";
      host.innerHTML =
        '<h3 style="margin:0 0 8px">🧠 تحلیل هوشمند گزارش PDF تاپ جنسیس</h3>' +
        '<p class="muted" style="margin:0 0 10px">استخراج شاخص‌ها، OCR صفحات تصویری، کارت‌های شاخص، جدول مقایسه و نمودار از دو گزارش به بالا، روند چندمرحله‌ای و گزارش قابل چاپ.</p>' +
        '<p style="margin:0 0 10px;padding:9px 11px;border-radius:9px;background:#fff4d5;color:#624b20;font-size:12px">حالت آزمایشی: فایل فقط در مرورگر پردازش می‌شود؛ هیچ PDF، نام، ایمیل یا نتیجه‌ای به پرونده شاگرد یا پایگاه داده ارسال و ذخیره نمی‌شود. فقط موارد مشکوک یا متعارض برای بررسی مربی علامت‌گذاری می‌شوند.</p>';
      const frame = document.createElement("iframe");
      frame.id = "topGenesisPdfAnalyzerFrame";
      frame.title = "ابزار آزمایشی تحلیل گزارش PDF تاپ جنسیس";
      frame.src = "./top-genesis-pdf-test.html?embedded=1";
      frame.loading = "lazy";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.style.cssText = "display:block;width:100%;height:1100px;border:0;border-radius:10px;background:#f6f2e9";
      host.appendChild(frame);
      const archive = document.getElementById("topGenesisArchivePanel");
      (archive || anchor).insertAdjacentElement("afterend", host);

      window.addEventListener("message", event => {
        if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
        if (!event.data || event.data.type !== "top-genesis-pdf-height") return;
        const height = Number(event.data.height);
        if (Number.isFinite(height)) frame.style.height = Math.max(900, Math.min(12000, Math.ceil(height) + 24)) + "px";
      });
    }
    host.style.display = isCoach() ? "block" : "none";
  }

  function start() {
    if (observerStarted) return;
    observerStarted = true;
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    mount();
    window.setInterval(mount, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
