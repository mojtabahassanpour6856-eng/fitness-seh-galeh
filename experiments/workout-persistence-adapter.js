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
    const planResult = await client.from('trainee_workout_plans').insert(payload.plan).select('id').single();
    if (planResult.error || !planResult.data || planResult.data.id === undefined) fail('ذخیره مشخصات برنامه ناموفق بود: ' + (planResult.error && planResult.error.message || 'شناسه برنامه برنگشت.'));
    const planId = planResult.data.id;
    const rows = payload.exercises.map(row => Object.assign({}, row, { workout_plan_id: planId }));
    const exerciseResult = await client.from('trainee_workout_exercises').insert(rows);
    if (exerciseResult.error) {
      const rollback = await client.from('trainee_workout_plans').delete().eq('id', planId);
      const suffix = rollback.error ? ' توجه: حذف برنامه ناقص هم ناموفق شد و باید در پنل مربی بررسی شود.' : ' برنامه ناقص پاک شد.';
      fail('ذخیره حرکات برنامه ناموفق بود: ' + exerciseResult.error.message + '.' + suffix);
    }
    return { planId, exerciseCount: rows.length, traineeId: value.traineeId };
  }
  root.SehWorkoutPersistenceAdapter = Object.freeze({ buildPayload, saveToSupabase, normalizeName, normalizePlanDate });
})(typeof window !== 'undefined' ? window : globalThis);
