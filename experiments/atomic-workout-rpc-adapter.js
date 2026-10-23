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
    const legacy = root.SehWorkoutPersistenceAdapter;
    const normalizeName = legacy && legacy.normalizeName;
    if (typeof normalizeName !== 'function' || !legacy || typeof legacy.buildPayload !== 'function') {
      fail('ماژول اعتبارسنجی برنامه بارگذاری نشده است.');
    }

    // The coach's own exercise bank is the source of truth.
    const personalResult = await client.from('trainer_exercises')
      .select('id,name,target_muscle,category,equipment,coach_note')
      .order('name', { ascending: true });
    if (personalResult.error) fail('خواندن بانک تمرین شخصی مربی ناموفق بود: ' + personalResult.error.message);
    const personalBank = new Map();
    for (const row of (personalResult.data || [])) {
      const key = normalizeName(row.name);
      if (!key) continue;
      if (!personalBank.has(key)) personalBank.set(key, []);
      personalBank.get(key).push(row);
    }

    // trainee_workout_exercises references public.exercises. Create a compatible
    // row only for an exercise explicitly present in the coach's personal bank.
    const publicResult = await client.from('exercises')
      .select('id,name,category,muscle_group,equipment,instructions');
    if (publicResult.error) fail('خواندن شناسه‌های سازگار با برنامه شاگرد ناموفق بود: ' + publicResult.error.message);
    const publicBank = new Map();
    for (const row of (publicResult.data || [])) {
      const key = normalizeName(row.name);
      if (!key) continue;
      if (!publicBank.has(key)) publicBank.set(key, []);
      publicBank.get(key).push(row);
    }

    const resolveExerciseId = async name => {
      const key = normalizeName(name);
      const personalRows = personalBank.get(key) || [];
      if (personalRows.length !== 1) {
        if (personalRows.length > 1) fail('نام حرکت «' + name + '» در بانک تمرین شخصی تکراری است؛ ابتدا همان بانک را اصلاح کن.');
        fail('حرکت «' + name + '» در بانک تمرین شخصی تو پیدا نشد؛ از بانک خودت انتخابش کن یا ابتدا آن را به بانک شخصی اضافه کن.');
      }
      const matches = publicBank.get(key) || [];
      if (matches.length > 1) fail('برای حرکت «' + name + '» چند شناسه در بانک سازگار برنامه وجود دارد؛ ذخیره متوقف شد تا حرکت اشتباه انتخاب نشود.');
      if (matches.length === 1) return matches[0].id;

      // Do not copy personal movements into public.exercises: that table is
      // readable by all authenticated users and has no owner column. The
      // current trainee-workout schema requires a public exercise FK, so a
      // private-only movement cannot safely be saved until the schema/UI
      // support trainer_exercise_id.
      fail('حرکت «' + name + '» در بانک شخصی تو هست، اما هنوز شناسه سازگار در بانک عمومی برنامه ندارد. برای جلوگیری از انتشار ناخواسته حرکت شخصی، ذخیره متوقف شد؛ ابتدا باید اتصال امن شناسه حرکت شخصی به برنامه شاگرد تکمیل شود.');
    };

    const trial = value.trial;
    if (!trial || !Array.isArray(trial.moves)) fail('فهرست حرکات برنامه معتبر نیست.');
    // Validate all non-bank fields before creating compatibility rows.
    legacy.buildPayload(Object.assign({}, value, {
      planDate: legacy.normalizePlanDate(value.planDate),
      resolveExerciseId: () => 1
    }));
    const resolved = new Map();
    for (const move of trial.moves) {
      const name = String(move && move.name || '').trim();
      if (!name) fail('یک حرکت بدون نام در برنامه وجود دارد.');
      if (!resolved.has(name)) resolved.set(name, await resolveExerciseId(name));
    }
    return legacy.buildPayload(Object.assign({}, value, {
      planDate: legacy.normalizePlanDate(value.planDate),
      resolveExerciseId: name => resolved.get(String(name || '').trim()) ?? null
    }));
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
