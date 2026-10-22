(function (root) {
  'use strict';

  function fail(message) { throw new Error(message); }
  function requireClient(client) {
    if (!client || typeof client.rpc !== 'function' || typeof client.from !== 'function') {
      fail('اتصال احرازشده Supabase از پنل مربی در دسترس نیست.');
    }
  }
  function rpcError(error, fallback) {
    if (!error) return;
    const message = String(error.message || fallback || 'درخواست ذخیره امن ناموفق بود.');
    if (error.code === '40001' || /workout changed since it was opened/i.test(message)) {
      fail('برنامه این شاگرد بعد از بازشدن طراح تغییر کرده است؛ برای جلوگیری از بازنویسی، ذخیره نشد. طراح را ببند و دوباره از پنل مربی باز کن.');
    }
    if (error.code === '42501' || /not authorized/i.test(message)) {
      fail('دسترسی مربی به این شاگرد تأیید نشد؛ هیچ تغییری ذخیره نشد.');
    }
    fail(fallback ? fallback + ': ' + message : message);
  }

  async function captureSnapshot(input) {
    const value = input || {};
    requireClient(value.supabase);
    if (!value.traineeId) fail('ابتدا یک شاگرد را در پنل مربی انتخاب کن.');
    const result = await value.supabase.rpc('experimental_workout_snapshot', {
      p_trainee_id: value.traineeId
    });
    if (result.error) rpcError(result.error, 'خواندن نسخه برنامه برای کنترل هم‌زمانی ناموفق بود');
    const snapshot = result.data;
    if (!snapshot || typeof snapshot !== 'object' ||
        typeof snapshot.fingerprint !== 'string' ||
        !Object.prototype.hasOwnProperty.call(snapshot, 'plan_id') ||
        !Array.isArray(snapshot.exercises)) {
      fail('پاسخ نسخه برنامه معتبر نیست؛ برای جلوگیری از ذخیره ناامن، دوباره طراح را باز کن.');
    }
    return Object.freeze({
      traineeId: String(value.traineeId),
      planId: snapshot.plan_id === null ? null : snapshot.plan_id,
      fingerprint: snapshot.fingerprint,
      plan: snapshot.plan,
      exercises: snapshot.exercises
    });
  }

  async function buildRpcPayload(value) {
    const client = value.supabase;
    const bankResult = await client.from('exercises').select('id,name');
    if (bankResult.error) fail('خواندن بانک حرکات ناموفق بود: ' + bankResult.error.message);
    const normalizeName = root.SehWorkoutPersistenceAdapter &&
      root.SehWorkoutPersistenceAdapter.normalizeName;
    if (typeof normalizeName !== 'function') fail('ماژول تبدیل نام حرکات بارگذاری نشده است.');
    const bank = new Map();
    for (const row of (bankResult.data || [])) {
      const key = normalizeName(row.name);
      if (!key) continue;
      if (!bank.has(key)) bank.set(key, []);
      bank.get(key).push(row.id);
    }
    const legacy = root.SehWorkoutPersistenceAdapter;
    if (!legacy || typeof legacy.buildPayload !== 'function') fail('ماژول اعتبارسنجی برنامه بارگذاری نشده است.');
    const payload = legacy.buildPayload(Object.assign({}, value, {
      planDate: legacy.normalizePlanDate(value.planDate),
      resolveExerciseId: name => {
        const ids = bank.get(normalizeName(name)) || [];
        if (ids.length > 1) fail('نام حرکت «' + name + '» در بانک تکراری است؛ برای جلوگیری از ثبت حرکت اشتباه، ابتدا باید نام‌ها یکتا شوند.');
        return ids.length === 1 ? ids[0] : null;
      }
    }));
    return payload;
  }

  async function saveAtomically(input) {
    const value = input || {};
    requireClient(value.supabase);
    if (!value.traineeId) fail('ابتدا یک شاگرد را در پنل مربی انتخاب کن.');
    const snapshot = value.snapshot;
    if (!snapshot || String(snapshot.traineeId) !== String(value.traineeId) ||
        typeof snapshot.fingerprint !== 'string' ||
        !Object.prototype.hasOwnProperty.call(snapshot, 'planId')) {
      fail('نسخه اولیه برنامه در دسترس نیست؛ این صفحه را ببند و دوباره از پنل مربی باز کن.');
    }
    const payload = await buildRpcPayload(value);
    const rpcPlan = {
      title: payload.plan.title,
      goal: payload.plan.goal,
      notes: payload.plan.notes,
      plan_date: payload.plan.plan_date
    };
    const result = await value.supabase.rpc('experimental_save_trainee_workout', {
      p_trainee_id: value.traineeId,
      p_expected_plan_id: snapshot.planId,
      p_expected_fingerprint: snapshot.fingerprint,
      p_plan: rpcPlan,
      p_exercises: payload.exercises
    });
    if (result.error) rpcError(result.error, 'ذخیره اتمی برنامه ناموفق بود');
    if (!result.data || result.data.plan_id === undefined || result.data.plan_id === null) {
      fail('نتیجه ذخیره امن قابل تأیید نیست؛ لطفاً برنامه شاگرد را بررسی کن.');
    }
    return {
      planId: result.data.plan_id,
      exerciseCount: Number(result.data.exercise_count),
      traineeId: value.traineeId,
      updatedExistingPlan: snapshot.planId !== null
    };
  }

  root.SehAtomicWorkoutAdapter = Object.freeze({ captureSnapshot, saveAtomically });
})(typeof window !== 'undefined' ? window : globalThis);
