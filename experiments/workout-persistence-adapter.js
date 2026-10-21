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
  function buildPayload(input) {
    const value = input || {};
    const trial = value.trial;
    const traineeId = value.traineeId;
    const date = String(value.planDate || '').trim();
    if (!traineeId || !String(traineeId).trim()) fail('برای ذخیره، شناسه شاگرد الزامی است.');
    if (!trial || !Array.isArray(trial.moves) || !trial.moves.length) fail('برنامه معتبر و دارای حرکت لازم است.');
    if (Array.isArray(trial.errors) && trial.errors.length) fail('ابتدا خطاهای اعتبارسنجی برنامه را برطرف کنید.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))) fail('تاریخ شروع باید به شکل YYYY-MM-DD معتبر باشد.');
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
      const exerciseId = resolveExerciseId(String(move.name || '').trim());
      if (exerciseId === null || exerciseId === undefined || exerciseId === '') fail('شناسه حرکت «' + String(move.name || '') + '» در بانک حرکات پیدا نشد؛ هیچ داده‌ای ثبت نشد.');
      const systemName = String(move.system || 'عادی').trim();
      const system = SYSTEMS[systemName];
      if (!system) fail('سیستم تمرینی پشتیبانی‌نشده برای حرکت «' + String(move.name || '') + '»: ' + systemName);
      const session = Number(move.session);
      if (!Number.isInteger(session) || session < 1 || session > Number(trial.sessions)) fail('شماره جلسه حرکت «' + String(move.name || '') + '» معتبر نیست.');
      const rawGroup = String(move.group || '').trim();
      let groupKey = null;
      if (system !== 'normal' && rawGroup && rawGroup !== '—') {
        const key = session + '|' + system + '|' + rawGroup;
        if (!groupKeys.has(key)) groupKeys.set(key, system.toUpperCase().replace(/[^A-Z]/g, '') + '-' + session + '-' + (groupKeys.size + 1));
        groupKey = groupKeys.get(key);
      }
      const sets = Number(move.sets), rest = Number(move.rest);
      if (!Number.isFinite(sets) || sets < 0 || !Number.isFinite(rest) || rest < 0) fail('ست یا استراحت برای حرکت «' + String(move.name || '') + '» معتبر نیست.');
      return {
        exercise_id: exerciseId,
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
    return {
      plan,
      exercises: exercises.map(function (row) { return Object.assign({ _plan_ref: 'new-plan' }, row); }),
      metadata: { gender: String(trial.gender || ''), sessions: Number(trial.sessions), exercise_count: exercises.length }
    };
  }
  root.SehWorkoutPersistenceAdapter = Object.freeze({ buildPayload: buildPayload });
})(typeof window !== 'undefined' ? window : globalThis);
