(function (root) {
  'use strict';
  const SYSTEMS = {
    'عادی': 'normal',
    'سوپرست': 'superset',
    'تری‌ست': 'triset',
    'تری ست': 'triset',
    'جاینت‌ست': 'giant',
    'جاینت ست': 'giant',
    'دراپ‌ست': 'drop-set'
  };
  function fail(message) { throw new Error(message); }
  function normalizeName(name) { return String(name || '').normalize('NFKC').replace(/[\u200c\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('fa'); }
  function normalizePlanDate(value) {
    let date = String(value || '').trim().replace(/[۰-۹]/g, ch => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch))).replace(/[٠-٩]/g, ch => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number(date.slice(0, 4)) >= 1300 && Number(date.slice(0, 4)) <= 1500) {
      const [jy, jm, jd] = date.split('-').map(Number);
      const fmt = new Intl.DateTimeFormat('en-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
      const base = Date.UTC(jy + 621, 2, 19);
      for (let offset = -35; offset <= 370; offset++) {
        const d = new Date(base + offset * 86400000), parts = {};
        fmt.formatToParts(d).forEach(part => { if (part.type === 'year' || part.type === 'month' || part.type === 'day') parts[part.type] = Number(part.value); });
        if (parts.year === jy && parts.month === jm && parts.day === jd) return d.toISOString().slice(0, 10);
      }
      fail('تبدیل تاریخ شمسی به میلادی ممکن نشد؛ تاریخ را دوباره بررسی کن.');
    }
    return date;
  }
  function buildPayload(input) {
    const value = input || {};
    const trial = value.trial;
    const traineeId = value.traineeId;
    const date = String(value.planDate || '').trim();
    if (!traineeId || !String(traineeId).trim()) fail('برای ذخیره، شناسه شاگرد الزامی است.');
    if (!trial || !Array.isArray(trial.moves) || !trial.moves.length) fail('برنامه معتبر و دارای حرکت لازم است.');
    if (Array.isArray(trial.errors) && trial.errors.length) fail('ابتدا خطاهای اعتبارسنجی برنامه را برطرف کنید.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date) fail('تاریخ شروع باید به شکل YYYY-MM-DD معتبر باشد.');
    if (!Number.isInteger(Number(trial.sessions)) || Number(trial.sessions) < 1 || Number(trial.sessions) > 6) fail('تعداد جلسات باید بین ۱ تا ۶ باشد.');
    const resolveExerciseId = value.resolveExerciseId;
    if (typeof resolveExerciseId !== 'function') fail('برای جلوگیری از ثبت حرکت اشتباه، باید نام هر حرکت به شناسه بانک حرکات نگاشت شود.');
    const plan = {
      trainee_id: traineeId,
      title: String(value.title || '').trim() || 'برنامه تمرینی',
      plan_date: date,
      goal: String(value.goal || '').trim() || null,
      notes: String(value.notes || '').trim() || null
    };
    const groupKeys = new Map();
    const exercises = trial.moves.map((move, index) => {
      const name = String(move.name || '').trim();
      const exerciseId = resolveExerciseId(name);
      if (exerciseId === null || exerciseId === undefined || exerciseId === '') fail('شناسه حرکت «' + name + '» در بانک حرکات پیدا نشد؛ هیچ داده‌ای ثبت نشد.');
      const systemName = String(move.system || 'عادی').trim();
      const system = SYSTEMS[systemName];
      if (!system) fail('سیستم تمرینی پشتیبانی‌نشده برای حرکت «' + name + '»: ' + systemName);
      const session = Number(move.session);
      if (!Number.isInteger(session) || session < 1 || session > Number(trial.sessions)) fail('شماره جلسه حرکت «' + name + '» معتبر نیست.');
      const rawGroup = String(move.group || '').trim();
      let groupKey = null;
      if (system !== 'normal' && rawGroup && rawGroup !== '—') {
        const key = session + '|' + system + '|' + rawGroup;
        if (!groupKeys.has(key)) groupKeys.set(key, system.toUpperCase().replace(/[^A-Z]/g, '') + '-' + session + '-' + (groupKeys.size + 1));
        groupKey = groupKeys.get(key);
      }
      const sets = Number(move.sets), rest = Number(move.rest);
      if (!Number.isInteger(sets) || sets < 0 || !Number.isInteger(rest) || rest < 0) fail('ست یا استراحت برای حرکت «' + name + '» معتبر نیست.');
      return {
        exercise_id: Number(exerciseId),
        sets: sets,
        reps: String(move.reps || '').trim() || null,
        rest_seconds: rest,
        notes: null,
        sort_order: index + 1,
        training_system: system,
        group_key: groupKey,
        training_day: 'جلسه ' + session,
        is_completed: false
      };
    });
    return { plan, exercises, metadata: { gender: String(trial.gender || ''), sessions: Number(trial.sessions), exercise_count: exercises.length } };
  }
  async function verifyLiveAccess(input) {
    const value = input || {}, client = value.supabase;
    if (!client || typeof client.from !== 'function' || !client.auth || typeof client.auth.getSession !== 'function') fail('اتصال احرازشده Supabase از پنل مربی در دسترس نیست.');
    if (!value.traineeId) fail('ابتدا یک شاگرد را در پنل مربی انتخاب کن.');
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error || !sessionResult.data || !sessionResult.data.session || !sessionResult.data.session.user) fail('نشست ورود مربی معتبر نیست؛ دوباره وارد پنل مربی شو.');
    const traineeResult = await client.from('trainees').select('id').eq('id', value.traineeId).limit(1);
    if (traineeResult.error) fail('دسترسی خواندن شاگرد از نشست فعلی تأیید نشد: ' + traineeResult.error.message);
    if (!(traineeResult.data || []).some(row => String(row.id) === String(value.traineeId))) fail('شاگرد انتخاب‌شده از نشست فعلی قابل دسترسی نیست؛ هیچ تغییری انجام نشد.');
    const plansResult = await client.from('trainee_workout_plans').select('id,trainee_id,title,plan_date,created_at').eq('trainee_id', value.traineeId).order('plan_date', {ascending:false, nullsFirst:false}).order('created_at', {ascending:false}).limit(10);
    if (plansResult.error) fail('خواندن برنامه‌های شاگرد از نشست فعلی ناموفق بود: ' + plansResult.error.message);
    const bankResult = await client.from('exercises').select('id,name').limit(500);
    if (bankResult.error) fail('خواندن بانک حرکات از نشست فعلی ناموفق بود: ' + bankResult.error.message);
    return { userId: sessionResult.data.session.user.id, traineeId: value.traineeId, planCount: (plansResult.data || []).length, exerciseCount: (bankResult.data || []).length };
  }
  function workoutRowsForRestore(rows, planId) {
    return (rows || []).map(row => ({
      workout_plan_id: planId,
      exercise_id: row.exercise_id,
      sets: row.sets,
      reps: row.reps,
      rest_seconds: row.rest_seconds,
      notes: row.notes,
      sort_order: row.sort_order,
      training_system: row.training_system,
      group_key: row.group_key,
      training_day: row.training_day,
      is_completed: row.is_completed
    }));
  }
  async function saveToSupabase(input) {
    const value = input || {};
    const client = value.supabase;
    if (!client || typeof client.from !== 'function') fail('اتصال امن Supabase از پنل مربی در دسترس نیست.');
    if (!value.traineeId) fail('ابتدا یک شاگرد را در پنل مربی انتخاب کن.');
    const bankResult = await client.from('exercises').select('id,name');
    if (bankResult.error) fail('دریافت بانک حرکات ناموفق بود: ' + bankResult.error.message);
    const bank = new Map();
    for (const row of (bankResult.data || [])) {
      const key = normalizeName(row.name);
      if (!key) continue;
      if (!bank.has(key)) bank.set(key, []);
      bank.get(key).push(row.id);
    }
    const payload = buildPayload(Object.assign({}, value, { planDate: normalizePlanDate(value.planDate),
      resolveExerciseId: name => {
        const ids = bank.get(normalizeName(name)) || [];
        if (ids.length > 1) fail('نام حرکت «' + name + '» در بانک تکراری است؛ برای جلوگیری از ثبت حرکت اشتباه، ابتدا باید نام‌ها یکتا شوند.');
        return ids.length === 1 ? ids[0] : null;
      }
    }));
    const existingResult = await client.from('trainee_workout_plans')
      .select('id,trainee_id,title,goal,notes,plan_date')
      .eq('trainee_id', value.traineeId)
      .order('plan_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(2);
    if (existingResult.error) fail('بررسی برنامه قبلی شاگرد ناموفق بود: ' + existingResult.error.message);
    if ((existingResult.data || []).length > 1) fail('این شاگرد بیش از یک برنامه تمرینی دارد. برای جلوگیری از ترکیب حرکات قدیمی و جدید، هیچ تغییری انجام نشد؛ ابتدا باید برنامه‌های قبلی در پنل بررسی شوند.');
    const existing = (existingResult.data || [])[0] || null;
    let planId, oldExercises = [], oldPlan = null, createdNewPlan = false;
    if (existing) {
      planId = existing.id;
      oldPlan = { title: existing.title, goal: existing.goal, notes: existing.notes, plan_date: existing.plan_date, trainee_id: existing.trainee_id };
      const oldRowsResult = await client.from('trainee_workout_exercises').select('*').eq('workout_plan_id', planId);
      if (oldRowsResult.error) fail('خواندن حرکات برنامه قبلی ناموفق بود؛ برنامه قبلی دست‌نخورده باقی ماند: ' + oldRowsResult.error.message);
      oldExercises = oldRowsResult.data || [];
      const updateResult = await client.from('trainee_workout_plans').update(payload.plan).eq('id', planId).eq('trainee_id', value.traineeId).select('id').single();
      if (updateResult.error || !updateResult.data) fail('به‌روزرسانی مشخصات برنامه ناموفق بود: ' + (updateResult.error && updateResult.error.message || 'برنامه قابل تأیید نبود.'));
      const deleteResult = await client.from('trainee_workout_exercises').delete().eq('workout_plan_id', planId);
      if (deleteResult.error) {
        const restorePlan = await client.from('trainee_workout_plans').update(oldPlan).eq('id', planId).eq('trainee_id', value.traineeId);
        fail('پاک‌سازی حرکات قدیمی ناموفق بود: ' + deleteResult.error.message + (restorePlan.error ? ' همچنین بازگردانی مشخصات قبلی نیازمند بررسی است.' : ' مشخصات قبلی بازگردانده شد.'));
      }
    } else {
      const planResult = await client.from('trainee_workout_plans').insert(payload.plan).select('id').single();
      if (planResult.error || !planResult.data || planResult.data.id === undefined) fail('ذخیره مشخصات برنامه ناموفق بود: ' + (planResult.error && planResult.error.message || 'شناسه برنامه برنگشت.'));
      planId = planResult.data.id;
      createdNewPlan = true;
    }
    const rows = payload.exercises.map(row => Object.assign({}, row, { workout_plan_id: planId }));
    const exerciseResult = await client.from('trainee_workout_exercises').insert(rows);
    if (exerciseResult.error) {
      if (createdNewPlan) {
        const rollback = await client.from('trainee_workout_plans').delete().eq('id', planId);
        const suffix = rollback.error ? ' توجه: حذف برنامه ناقص هم ناموفق شد و باید در پنل مربی بررسی شود.' : ' برنامه ناقص پاک شد.';
        fail('ذخیره حرکات برنامه ناموفق بود: ' + exerciseResult.error.message + '.' + suffix);
      }
      const restoreRows = workoutRowsForRestore(oldExercises, planId);
      const restoredRows = restoreRows.length ? await client.from('trainee_workout_exercises').insert(restoreRows) : { error: null };
      const restoredPlan = await client.from('trainee_workout_plans').update(oldPlan).eq('id', planId).eq('trainee_id', value.traineeId);
      const rollbackFailed = restoredRows.error || restoredPlan.error;
      fail('ذخیره حرکات جدید ناموفق بود: ' + exerciseResult.error.message + (rollbackFailed ? '. هشدار: بازگردانی کامل برنامه قبلی تأیید نشد؛ لطفاً برنامه این شاگرد را بررسی کن.' : '. برنامه قبلی بازگردانده شد.'));
    }
    return { planId, exerciseCount: rows.length, traineeId: value.traineeId, updatedExistingPlan: !createdNewPlan };
  }
  root.SehWorkoutPersistenceAdapter = Object.freeze({ buildPayload, saveToSupabase, verifyLiveAccess, normalizeName, normalizePlanDate });
})(typeof window !== 'undefined' ? window : globalThis);
