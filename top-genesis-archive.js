/* Top Genesis PDF archive — coach-only, isolated module.
 * Does not modify the existing manual body-analysis form or student health-report flow.
 */
(function () {
  "use strict";
  const BUCKET = "trainee-health-reports";
  const TABLE = "body_analysis_reports";
  const MAX_BYTES = 10 * 1024 * 1024;
  let mounted = false;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  function currentCoachAndTrainee() {
    try {
      if (typeof authProfile === "undefined" || authProfile?.role !== "coach") return null;
      if (typeof currentClient === "undefined" || !currentClient?.id) return null;
      const sb = window.AUTH_SUPABASE;
      if (!sb?.auth || !sb?.storage) return null;
      return { sb, trainee: currentClient };
    } catch (_) { return null; }
  }

  function mount() {
    const isCoach = (() => {
      try { return typeof authProfile !== "undefined" && authProfile?.role === "coach"; }
      catch (_) { return false; }
    })();
    const existing = $("topGenesisArchivePanel");
    // This archive contains upload/delete controls and is strictly coach-only.
    // Remove it immediately if a single-page session changes to a trainee.
    if (!isCoach) {
      if (existing) existing.remove();
      mounted = false;
      return;
    }
    if (mounted && existing) return;
    const anchor = $("bodyAnalysisEntryPanel");
    if (!anchor) return;
    const host = document.createElement("section");
    host.id = "topGenesisArchivePanel";
    host.className = "card";
    host.style.cssText = "margin-top:14px;border:1px solid #d8b65d;background:#fffdf7";
    host.innerHTML = `
      <h3 style="margin:0 0 8px">📄 آرشیو گزارش دستگاه تاپ جنسیس</h3>
      <p class="muted" style="margin:0 0 10px">فایل اصلی PDF به‌صورت خصوصی برای شاگرد انتخاب‌شده ذخیره می‌شود. این بخش مستقل از فرم ثبت دستی آنالیز است.</p>
      <div class="grid2">
        <div><label for="tgReportDate">تاریخ انجام آنالیز</label><input id="tgReportDate" type="date"></div>
        <div><label for="tgReportPdf">فایل اصلی گزارش (PDF، حداکثر ۱۰ مگابایت)</label><input id="tgReportPdf" type="file" accept="application/pdf,.pdf"></div>
      </div>
      <button type="button" id="tgUploadBtn" style="margin-top:10px">ذخیره گزارش در آرشیو خصوصی</button>
      <div id="tgReportStatus" class="muted" role="status" style="margin-top:8px"></div>
      <div style="margin-top:14px"><b>گزارش‌های ذخیره‌شده</b><div id="tgReportList" class="muted" style="margin-top:8px">برای نمایش، شاگرد را انتخاب کنید.</div></div>
    `;
    anchor.insertAdjacentElement("afterend", host);
    $("tgReportDate").value = new Date().toISOString().slice(0,10);
    $("tgUploadBtn").addEventListener("click", upload);
    mounted = true;
    refresh();
  }

  async function refresh() {
    const ctx = currentCoachAndTrainee();
    const list = $("tgReportList");
    if (!list) return;
    if (!ctx) { list.textContent = "برای آرشیو، وارد حساب مربی شوید و یک شاگرد را انتخاب کنید."; return; }
    list.textContent = "در حال دریافت فهرست…";
    try {
      const { data, error } = await ctx.sb.from(TABLE)
        .select("id,analysis_date,original_file_name,file_size_bytes,parse_status,created_at,storage_path")
        .eq("trainee_id", ctx.trainee.id)
        .order("analysis_date", { ascending: false });
      if (error) throw error;
      if (!data?.length) { list.textContent = "هنوز گزارشی برای این شاگرد ذخیره نشده است."; return; }
      list.innerHTML = data.map((r) => `
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;border:1px solid #eee2bf;border-radius:9px;padding:9px;margin:7px 0;background:#fff">
          <div><b>${esc(r.analysis_date)}</b><div style="font-size:12px">${esc(r.original_file_name)} · ${(Number(r.file_size_bytes)/1024/1024).toFixed(2)} MB</div><small>وضعیت: ${esc(r.parse_status)}</small></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-tg-open="${esc(r.id)}" style="width:auto">مشاهده PDF</button><button type="button" data-tg-delete="${esc(r.id)}" style="width:auto;background:#a83232;color:#fff;border:0">حذف</button></div>
        </div>`).join("");
      list.querySelectorAll("[data-tg-open]").forEach((button) => {
        button.addEventListener("click", () => openReport(button.getAttribute("data-tg-open")));
      });
      list.querySelectorAll("[data-tg-delete]").forEach((button) => {
        button.addEventListener("click", () => deleteReport(button, button.getAttribute("data-tg-delete")));
      });
    } catch (e) {
      list.textContent = "دریافت آرشیو انجام نشد: " + (e?.message || String(e));
    }
  }

  async function upload() {
    const ctx = currentCoachAndTrainee();
    const status = $("tgReportStatus");
    const button = $("tgUploadBtn");
    if (!ctx) { alert("ابتدا وارد حساب مربی شوید و شاگرد را انتخاب کنید."); return; }
    const file = $("tgReportPdf")?.files?.[0];
    const date = $("tgReportDate")?.value;
    if (!file) { alert("فایل PDF گزارش را انتخاب کنید."); return; }
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      alert("فقط فایل PDF پذیرفته می‌شود."); return;
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      alert("حجم فایل باید بیشتر از صفر و حداکثر ۱۰ مگابایت باشد."); return;
    }
    if (!date) { alert("تاریخ آنالیز را وارد کنید."); return; }
    button.disabled = true;
    button.textContent = "در حال ذخیره…";
    status.textContent = "در حال بارگذاری امن فایل…";
    let path = null;
    try {
      const { data: userData, error: userError } = await ctx.sb.auth.getUser();
      if (userError) throw userError;
      const coachId = userData?.user?.id;
      if (!coachId) throw new Error("نشست مربی معتبر نیست؛ دوباره وارد شوید.");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90) || "report.pdf";
      path = coachId + "/" + ctx.trainee.id + "/" + crypto.randomUUID() + "-" + safeName;
      const { error: storageError } = await ctx.sb.storage.from(BUCKET)
        .upload(path, file, { contentType: "application/pdf", upsert: false });
      if (storageError) throw storageError;
      const { error: rowError } = await ctx.sb.from(TABLE).insert({
        trainee_id: ctx.trainee.id,
        coach_user_id: coachId,
        analysis_date: date,
        storage_path: path,
        original_file_name: file.name,
        mime_type: "application/pdf",
        file_size_bytes: file.size,
        parse_status: "pending",
        extracted_metrics: {}
      });
      if (rowError) {
        await ctx.sb.storage.from(BUCKET).remove([path]).catch(() => {});
        throw rowError;
      }
      $("tgReportPdf").value = "";
      status.textContent = "گزارش با موفقیت در آرشیو خصوصی ذخیره شد. استخراج اعداد تا بررسی نمونه واقعی PDF انجام نمی‌شود.";
      await refresh();
    } catch (e) {
      status.textContent = "ذخیره انجام نشد: " + (e?.message || String(e));
    } finally {
      button.disabled = false;
      button.textContent = "ذخیره گزارش در آرشیو خصوصی";
    }
  }


  async function deleteReport(button, id) {
    const ctx = currentCoachAndTrainee();
    if (!ctx) return alert("نشست مربی یا شاگرد انتخاب‌شده معتبر نیست.");
    if (!window.confirm("این گزارش PDF و رکورد آن برای همین شاگرد به‌طور کامل حذف شود؟ این کار قابل بازگشت نیست.")) return;
    button.disabled = true;
    button.textContent = "در حال حذف…";
    try {
      const { data: row, error: rowError } = await ctx.sb.from(TABLE)
        .select("id,storage_path").eq("id", id).eq("trainee_id", ctx.trainee.id).single();
      if (rowError) throw rowError;
      if (!row?.storage_path) throw new Error("مسیر فایل پیدا نشد؛ هیچ چیزی حذف نشد.");
      const { error: storageError } = await ctx.sb.storage.from(BUCKET).remove([row.storage_path]);
      if (storageError) throw storageError;
      const { error: deleteError } = await ctx.sb.from(TABLE)
        .delete().eq("id", id).eq("trainee_id", ctx.trainee.id);
      if (deleteError) {
        alert("خود فایل از فضای ذخیره‌سازی حذف شد، اما حذف رکورد پایگاه داده انجام نشد. لطفاً دوباره تلاش کنید یا دسترسی‌ها بررسی شود. جزئیات: " + deleteError.message);
        await refresh();
        return;
      }
      await refresh();
      const status = $("tgReportStatus");
      if (status) status.textContent = "گزارش انتخاب‌شده و فایل PDF آن با موفقیت حذف شدند.";
    } catch (e) {
      alert("حذف گزارش انجام نشد: " + (e?.message || String(e)));
      button.disabled = false;
      button.textContent = "حذف";
    }
  }

  async function openReport(id) {
    const ctx = currentCoachAndTrainee();
    if (!ctx) return alert("نشست مربی یا شاگرد انتخاب‌شده معتبر نیست.");
    try {
      const { data: row, error: rowError } = await ctx.sb.from(TABLE)
        .select("storage_path").eq("id", id).eq("trainee_id", ctx.trainee.id).single();
      if (rowError) throw rowError;
      const { data, error } = await ctx.sb.storage.from(BUCKET).createSignedUrl(row.storage_path, 300);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("لینک امن فایل ساخته نشد.");
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (e) {
      alert("بازکردن PDF انجام نشد: " + (e?.message || String(e)));
    }
  }

  const observer = new MutationObserver(() => {
    mount();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  // Check role changes frequently, but keep archive data refresh on its original 15-second cadence.
  window.setInterval(mount, 1200);
  window.setInterval(() => { if (mounted) refresh(); }, 15000);
})();
/* Load the isolated coach-only Top Genesis PDF analyzer card without touching the manual analysis form. */
(function () {
  if (document.querySelector('script[data-top-genesis-pdf-embed-loader]')) return;
  const script = document.createElement("script");
  script.src = "./top-genesis-pdf-app-embed.js";
  script.defer = true;
  script.dataset.topGenesisPdfEmbedLoader = "1";
  document.head.appendChild(script);
})();
