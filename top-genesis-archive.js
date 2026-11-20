/* Top Genesis PDF archive — coach-only, isolated module.
 * Does not modify the existing manual body-analysis form or student health-report flow.
 */
(function () {
  "use strict";
  const BUCKET = "trainee-health-reports";
  const TABLE = "body_analysis_reports";
  const MAX_BYTES = 10 * 1024 * 1024;
  let mounted = false;
  let lastMountedTraineeId = null;
  let archiveRefreshToken = 0;
  const ARCHIVE_PAGE_SIZE = 500;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  function currentCoachAndTrainee() {
    try {
      const profile = window.authProfile || (typeof authProfile !== "undefined" ? authProfile : null);
      const trainee = window.currentClient || (typeof currentClient !== "undefined" ? currentClient : null);
      if (profile?.role !== "coach") return null;
      if (!trainee?.id) return null;
      const sb = window.AUTH_SUPABASE;
      if (!sb?.auth || !sb?.storage) return null;
      return { sb, trainee };
    } catch (_) { return null; }
  }

  function mount() {
    const isCoach = (() => {
      try {
        const profile = window.authProfile || (typeof authProfile !== "undefined" ? authProfile : null);
        return profile?.role === "coach";
      } catch (_) { return false; }
    })();
    const existing = $("topGenesisArchivePanel");
    const trainee = window.currentClient || (typeof currentClient !== "undefined" ? currentClient : null);
    const selectedId = isCoach && trainee?.id ? String(trainee.id) : "";
    // This archive contains upload/delete controls and is strictly coach-only.
    // Remove it immediately if a single-page session changes to a trainee.
    if (!isCoach) {
      if (existing) existing.remove();
      mounted = false;
      lastMountedTraineeId = null;
      archiveRefreshToken += 1;
      return;
    }
    if (mounted && existing) {
      if (selectedId !== lastMountedTraineeId) {
        lastMountedTraineeId = selectedId;
        refresh();
      }
      return;
    }
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
    lastMountedTraineeId = selectedId;
    refresh();
  }

  async function refresh() {
    const token = ++archiveRefreshToken;
    const ctx = currentCoachAndTrainee();
    const list = $("tgReportList");
    if (!list) return;
    if (!ctx) {
      list.dataset.boundTraineeId = "";
      list.textContent = "برای آرشیو، وارد حساب مربی شوید و یک شاگرد را انتخاب کنید.";
      return;
    }
    const traineeId = String(ctx.trainee.id);
    list.dataset.boundTraineeId = traineeId;
    list.textContent = "در حال دریافت فهرست…";
    try {
      const rows = [];
      const seenIds = new Set();
      let offset = 0;
      let pageCount = 0;
      while (true) {
        if (++pageCount > 10000) throw new Error("تعداد صفحات آرشیو از حد ایمن بیشتر شد.");
        const active = currentCoachAndTrainee();
        if (token !== archiveRefreshToken || !active || String(active.trainee.id) !== traineeId) return;
        const { data, error } = await ctx.sb.from(TABLE)
          .select("id,analysis_date,original_file_name,file_size_bytes,parse_status,created_at,storage_path")
          .eq("trainee_id", traineeId)
          .order("analysis_date", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + ARCHIVE_PAGE_SIZE - 1);
        if (error) throw error;
        const page = Array.isArray(data) ? data : [];
        for (const row of page) {
          const id = row && row.id != null ? String(row.id) : null;
          if (id !== null && seenIds.has(id)) continue;
          if (id !== null) seenIds.add(id);
          rows.push(row);
        }
        const current = currentCoachAndTrainee();
        if (token !== archiveRefreshToken || !current || String(current.trainee.id) !== traineeId) return;
        if (page.length < ARCHIVE_PAGE_SIZE) break;
        offset += page.length;
      }
      if (token !== archiveRefreshToken || list.dataset.boundTraineeId !== traineeId) return;
      if (!rows.length) { list.textContent = "هنوز گزارشی برای این شاگرد ذخیره نشده است."; return; }
      list.innerHTML = rows.map((r) => `
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;border:1px solid #eee2bf;border-radius:9px;padding:9px;margin:7px 0;background:#fff">
          <div><b>${esc(r.analysis_date)}</b><div style="font-size:12px">${esc(r.original_file_name)} · ${(Number(r.file_size_bytes)/1024/1024).toFixed(2)} MB</div><small>وضعیت: ${esc(r.parse_status)}</small></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-tg-open="${esc(r.id)}" style="width:auto">مشاهده PDF</button><button type="button" data-tg-replace="${esc(r.id)}" style="width:auto;background:#fff8e8;color:#765b2e;border:1px solid #d8b65d">جایگزینی PDF</button><button type="button" data-tg-delete="${esc(r.id)}" style="width:auto;background:#a83232;color:#fff;border:0">حذف</button></div>
        </div>`).join("");
      list.querySelectorAll("[data-tg-open]").forEach((button) => {
        button.addEventListener("click", () => openReport(button.getAttribute("data-tg-open")));
      });
      list.querySelectorAll("[data-tg-replace]").forEach((button) => {
        button.addEventListener("click", () => replaceReport(button, button.getAttribute("data-tg-replace")));
      });
      list.querySelectorAll("[data-tg-delete]").forEach((button) => {
        button.addEventListener("click", () => deleteReport(button, button.getAttribute("data-tg-delete")));
      });
    } catch (e) {
      const current = currentCoachAndTrainee();
      if (token === archiveRefreshToken && current && String(current.trainee.id) === traineeId) {
        list.textContent = "دریافت آرشیو انجام نشد: " + (e?.message || String(e));
      }
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



  async function replaceReport(button, id) {
    const initial = currentCoachAndTrainee();
    if (!initial) return alert("نشست مربی یا شاگرد انتخاب‌شده معتبر نیست.");
    const traineeId = String(initial.trainee.id);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
        alert("فقط فایل PDF پذیرفته می‌شود."); return;
      }
      if (file.size <= 0 || file.size > MAX_BYTES) {
        alert("حجم فایل باید بیشتر از صفر و حداکثر ۱۰ مگابایت باشد."); return;
      }
      const ctx = currentCoachAndTrainee();
      if (!ctx || String(ctx.trainee.id) !== traineeId) {
        alert("شاگرد انتخاب‌شده تغییر کرده است؛ عملیات متوقف شد."); return;
      }
      button.disabled = true;
      button.textContent = "در حال بررسی PDF…";
      let newPath = null;
      try {
        if (!window.TopGenesisPdfParser?.extract) {
          throw new Error("استخراج‌کننده PDF در دسترس نیست. صفحه را تازه‌سازی کنید.");
        }
        const parsed = await window.TopGenesisPdfParser.extract(file);
        const metrics = parsed && typeof parsed === "object" ? parsed : null;
        if (!metrics || !Object.keys(metrics).some(key => !["flags","scan_pages","scan_page_numbers","ocr_pages","engine","page_count","review_required"].includes(key))) {
          throw new Error("اطلاعات قابل استخراج از PDF پیدا نشد؛ فایل قبلی حفظ شد.");
        }
        const metricNames = {
          height_cm:"قد", weight_kg:"وزن", body_fat_percent:"درصد چربی",
          bmi:"BMI", resting_metabolic_rate_kcal:"سوخت‌وساز پایه",
          daily_energy_expenditure_kcal:"مصرف انرژی روزانه", fat_mass_kg:"توده چربی",
          lean_mass_kg:"توده بدون چربی", waist_circumference_cm:"دور کمر"
        };
        const preview = Object.entries(metricNames)
          .filter(([key]) => metrics[key]?.value != null)
          .map(([key,label]) => label + ": " + metrics[key].value + (metrics[key].unit ? " " + metrics[key].unit : ""))
          .join("\n");
        const flags = Array.isArray(metrics.flags) && metrics.flags.length ? "\n\nهشدارها:\n• " + metrics.flags.slice(0,8).join("\n• ") : "";
        const summary = preview || "مقادیر اصلی شناسایی نشد؛ فایل قبلی حفظ می‌شود.";
        if (!preview) throw new Error("مقادیر اصلی قابل تشخیص نیستند. فایل قبلی حفظ شد.");
        if (!window.confirm("پیش‌نمایش استخراج PDF جدید:\n\n" + summary + flags + "\n\nاین اطلاعات نیازمند بررسی مربی هستند. آیا PDF جدید جایگزین شود؟")) {
          return;
        }
        const activeBeforeUpload = currentCoachAndTrainee();
        if (!activeBeforeUpload || String(activeBeforeUpload.trainee.id) !== traineeId) {
          throw new Error("شاگرد هنگام بررسی تغییر کرد؛ عملیات متوقف شد.");
        }
        const { data: oldRow, error: readError } = await ctx.sb.from(TABLE)
          .select("id,storage_path,analysis_date").eq("id", id).eq("trainee_id", traineeId).single();
        if (readError) throw readError;
        if (!oldRow?.storage_path) throw new Error("مسیر فایل قبلی پیدا نشد؛ هیچ چیزی تغییر نکرد.");
        const { data: userData, error: userError } = await ctx.sb.auth.getUser();
        if (userError) throw userError;
        const coachId = userData?.user?.id;
        if (!coachId) throw new Error("نشست مربی معتبر نیست؛ دوباره وارد شوید.");
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90) || "report.pdf";
        newPath = coachId + "/" + traineeId + "/" + crypto.randomUUID() + "-" + safeName;
        const { error: uploadError } = await ctx.sb.storage.from(BUCKET)
          .upload(newPath, file, { contentType: "application/pdf", upsert: false });
        if (uploadError) throw uploadError;
        const active = currentCoachAndTrainee();
        if (!active || String(active.trainee.id) !== traineeId) throw new Error("شاگرد هنگام بارگذاری تغییر کرد؛ ثبت متوقف شد.");
        const { data: updated, error: updateError } = await ctx.sb.from(TABLE)
          .update({
            storage_path: newPath, original_file_name: file.name,
            mime_type: "application/pdf", file_size_bytes: file.size,
            parse_status: "needs_review", extracted_metrics: metrics,
            parse_error: null, coach_summary: null
          })
          .eq("id", id).eq("trainee_id", traineeId).select("id").maybeSingle();
        if (updateError) throw updateError;
        if (!updated?.id) throw new Error("رکورد آنالیز به‌روزرسانی نشد؛ فایل قبلی حفظ شد.");
        newPath = null;
        const { error: cleanupError } = await ctx.sb.storage.from(BUCKET).remove([oldRow.storage_path]);
        await refresh();
        const status = $("tgReportStatus");
        if (status) status.textContent = cleanupError
          ? "PDF جدید ثبت شد و اطلاعات استخراج‌شده برای بررسی مربی ذخیره شد؛ پاک‌سازی فایل قبلی ناموفق بود."
          : "PDF جایگزین شد. اطلاعات استخراج‌شده در وضعیت بررسی مربی ذخیره شد؛ تاریخ و رکورد حفظ شدند.";
        if (cleanupError) console.error("Top Genesis old-file cleanup failed", cleanupError);
      } catch (e) {
        if (newPath) {
          const cleanup = await ctx.sb.storage.from(BUCKET).remove([newPath]);
          if (cleanup.error) console.error("Top Genesis replacement rollback cleanup failed", cleanup.error);
        }
        alert("جایگزینی انجام نشد؛ آنالیز قبلی حفظ شد. " + (e?.message || String(e)));
      } finally {
        button.disabled = false;
        button.textContent = "جایگزینی PDF";
      }
    }, { once: true });
    input.click();
  }

  async function deleteReport(button, id) {
    const ctx = currentCoachAndTrainee();
    if (!ctx) return alert("نشست مربی یا شاگرد انتخاب‌شده معتبر نیست.");
    const traineeId = String(ctx.trainee.id);
    if (!window.confirm("این گزارش PDF و رکورد آن برای همین شاگرد حذف شود؟ این کار قابل بازگشت نیست.")) return;
    button.disabled = true;
    button.textContent = "در حال حذف…";
    try {
      const { data: row, error: rowError } = await ctx.sb.from(TABLE)
        .select("id,storage_path").eq("id", id).eq("trainee_id", traineeId).single();
      if (rowError) throw rowError;
      if (!row?.storage_path) throw new Error("مسیر فایل پیدا نشد؛ هیچ چیزی حذف نشد.");
      const active = currentCoachAndTrainee();
      if (!active || String(active.trainee.id) !== traineeId) {
        throw new Error("شاگرد انتخاب‌شده تغییر کرده است؛ حذف متوقف شد.");
      }
      // Remove the database reference first. A Storage cleanup failure then
      // leaves only an orphaned private object, never a live row with a
      // missing PDF. Cleanup can be retried safely by an administrator.
      const { data: deleted, error: deleteError } = await ctx.sb.from(TABLE)
        .delete().eq("id", id).eq("trainee_id", traineeId).select("id").maybeSingle();
      if (deleteError) throw deleteError;
      if (!deleted?.id) throw new Error("رکورد حذف نشد؛ فایل اصلی دست‌نخورده باقی ماند.");
      const { error: storageError } = await ctx.sb.storage.from(BUCKET).remove([row.storage_path]);
      await refresh();
      const status = $("tgReportStatus");
      if (status) status.textContent = storageError
        ? "رکورد آنالیز حذف شد، اما پاک‌سازی فایل خصوصی ناموفق بود و باید جداگانه بررسی شود."
        : "رکورد آنالیز و فایل PDF آن با موفقیت حذف شدند.";
      if (storageError) console.error("Top Genesis deleted-file cleanup failed", storageError);
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
