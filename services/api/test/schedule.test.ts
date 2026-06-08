import test from 'node:test';
import assert from 'node:assert/strict';
import { isWeekday, isoDate, nextRunAt, nextTradeDate, tradeDateOf } from '../src/lib/schedule.js';
import { Db } from '../src/db/sqlite.js';
import { migrate } from '../src/db/migrator.js';
import { Repository } from '../src/db/repository.js';
import { SchedulerService } from '../src/modules/scheduler.js';

// 2024-01-10 是周三、01-13 周六、01-12 周五。
const WED = new Date(2024, 0, 10, 10, 0, 0);
const WED_PM = new Date(2024, 0, 10, 16, 0, 0);
const FRI_PM = new Date(2024, 0, 12, 16, 0, 0);
const SAT = new Date(2024, 0, 13, 9, 0, 0);

test('nextRunAt: 当天未到点用当天,过点/周末顺延到下个工作日', () => {
  assert.equal(isoDate(nextRunAt(WED, '15:30')), '2024-01-10'); // 周三 10:00 → 当天 15:30
  assert.equal(nextRunAt(WED, '15:30').getHours(), 15);
  assert.equal(isoDate(nextRunAt(WED_PM, '15:30')), '2024-01-11'); // 周三 16:00 → 周四
  assert.equal(isoDate(nextRunAt(FRI_PM, '15:30')), '2024-01-15'); // 周五盘后 → 下周一
  assert.equal(isoDate(nextRunAt(SAT, '15:30')), '2024-01-15'); // 周六 → 下周一
});

test('nextTradeDate 跳过周末', () => {
  assert.equal(nextTradeDate(new Date(2024, 0, 10)), '2024-01-11'); // 周三→周四
  assert.equal(nextTradeDate(new Date(2024, 0, 12)), '2024-01-15'); // 周五→下周一
});

test('isWeekday / tradeDateOf', () => {
  assert.equal(isWeekday(WED), true);
  assert.equal(isWeekday(SAT), false);
  assert.equal(tradeDateOf(WED), '2024-01-10');
});

function svc() {
  const db = new Db(':memory:');
  migrate(db);
  const repo = new Repository(db);
  const calls: any[] = [];
  const fakePaper = { run: async (input: any) => calls.push(input) } as any;
  return { repo, calls, sched: new SchedulerService(repo, fakePaper) };
}

test('runDaily 在工作日触发 paper.run(today → 下一交易日)', async () => {
  const { calls, sched } = svc();
  const res = await sched.runDaily(WED);
  assert.equal(res.ran, true);
  assert.deepEqual(calls[0], { today: '2024-01-10', effective_date: '2024-01-11' });
});

test('runDaily 周末跳过', async () => {
  const { calls, sched } = svc();
  const res = await sched.runDaily(SAT);
  assert.equal(res.ran, false);
  assert.equal(calls.length, 0);
});

test('auto_signal=false 时跳过', async () => {
  const { repo, calls, sched } = svc();
  repo.settingPut('auto_signal', false);
  const res = await sched.runDaily(WED);
  assert.equal(res.ran, false);
  assert.equal(calls.length, 0);
});
