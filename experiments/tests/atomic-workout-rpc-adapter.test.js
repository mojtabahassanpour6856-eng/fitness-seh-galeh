'use strict';
const assert = require('node:assert/strict');
require('../workout-persistence-adapter.js');
require('../atomic-workout-rpc-adapter.js');

const traineeId = '11111111-1111-4111-8111-111111111111';
const bank = [{ id: 7, name: 'اسکوات' }];
const trial = {
  gender: 'men',
  sessions: 1,
  errors: [],
  moves: [{ name: 'اسکوات', system: 'عادی', session: 1, sets: 3, reps: '8-10', rest: 60, group: '' }]
};
function clientFactory({ snapshot, save, bankRows = bank, snapshotError, saveError } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      calls.push({ type: 'from', table });
      return {
        select(columns) {
          calls.push({ type: 'select', table, columns });
          return Promise.resolve({ data: table === 'exercises' ? bankRows : [], error: null });
        }
      };
    },
    async rpc(name, args) {
      calls.push({ type: 'rpc', name, args });
      if (name === 'experimental_workout_snapshot') return { data: snapshot, error: snapshotError || null };
      if (name === 'experimental_save_trainee_workout') return { data: save, error: saveError || null };
      throw new Error('Unexpected RPC: ' + name);
    }
  };
  return client;
}
const initialSnapshot = {
  plan_id: 55,
  plan_count: 1,
  fingerprint: 'stable-fingerprint',
  plan: { id: 55, title: 'قبلی' },
  exercises: [{ id: 91, exercise_id: 7 }]
};

(async () => {
  {
    const client = clientFactory({ snapshot: initialSnapshot });
    const snapshot = await global.SehAtomicWorkoutAdapter.captureSnapshot({ supabase: client, traineeId });
    assert.equal(snapshot.traineeId, traineeId);
    assert.equal(snapshot.planId, 55);
    assert.equal(snapshot.fingerprint, 'stable-fingerprint');
    assert.equal(client.calls.filter(c => c.type === 'rpc').length, 1);
    assert.equal(client.calls[0].name, 'experimental_workout_snapshot');
  }
  {
    const client = clientFactory({
      save: { plan_id: 55, exercise_count: 1 },
      snapshot: initialSnapshot
    });
    const result = await global.SehAtomicWorkoutAdapter.saveAtomically({
      supabase: client, traineeId, snapshot: {
        traineeId, planId: 55, fingerprint: 'captured-before-edit'
      }, planDate: '2026-10-22', title: 'برنامه جدید', goal: 'قدرت', notes: '', trial
    });
    assert.equal(result.planId, 55);
    assert.equal(result.exerciseCount, 1);
    const saveCall = client.calls.find(c => c.type === 'rpc' && c.name === 'experimental_save_trainee_workout');
    assert.ok(saveCall, 'atomic save RPC must be called');
    assert.equal(saveCall.args.p_expected_fingerprint, 'captured-before-edit');
    assert.equal(saveCall.args.p_expected_plan_id, 55);
    assert.equal(saveCall.args.p_plan.title, 'برنامه جدید');
    assert.equal(saveCall.args.p_exercises[0].exercise_id, 7);
    assert.equal(saveCall.args.p_exercises[0].training_day, 'جلسه 1');
    assert.deepEqual(client.calls.filter(c => c.type === 'from').map(c => c.table), ['exercises']);
    assert.equal(client.calls.some(c => ['trainee_workout_plans','trainee_workout_exercises'].includes(c.table)), false,
      'adapter must not perform multi-request direct writes');
  }
  {
    const client = clientFactory({ saveError: { code: '40001', message: 'workout changed since it was opened; reload before saving' } });
    await assert.rejects(() => global.SehAtomicWorkoutAdapter.saveAtomically({
      supabase: client, traineeId, snapshot: { traineeId, planId: 55, fingerprint: 'old' },
      planDate: '2026-10-22', title: 'برنامه', trial
    }), /بعد از بازشدن طراح تغییر کرده است/);
  }
  {
    const client = clientFactory({ save: { plan_id: 55, exercise_count: 1 } });
    await assert.rejects(() => global.SehAtomicWorkoutAdapter.saveAtomically({
      supabase: client, traineeId, snapshot: null, planDate: '2026-10-22', title: 'برنامه', trial
    }), /نسخه اولیه برنامه در دسترس نیست/);
    assert.equal(client.calls.some(c => c.type === 'rpc' && c.name === 'experimental_save_trainee_workout'), false);
  }
  {
    const client = clientFactory({ bankRows: [{ id: 7, name: 'اسکوات' }, { id: 8, name: 'اسکوات' }] });
    await assert.rejects(() => global.SehAtomicWorkoutAdapter.saveAtomically({
      supabase: client, traineeId, snapshot: { traineeId, planId: 55, fingerprint: 'old' },
      planDate: '2026-10-22', title: 'برنامه', trial
    }), /نام حرکت.*تکراری است/);
    assert.equal(client.calls.some(c => c.type === 'rpc' && c.name === 'experimental_save_trainee_workout'), false);
  }
  console.log('PASS: snapshot capture pins the expected plan fingerprint');
  console.log('PASS: atomic adapter sends validated payload through one save RPC');
  console.log('PASS: stale concurrent edit is surfaced safely');
  console.log('PASS: missing baseline snapshot prevents saving');
  console.log('PASS: duplicate exercise names prevent saving');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
