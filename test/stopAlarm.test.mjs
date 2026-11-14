import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "./build.mjs";
import { reset } from "./mocks.mjs";

const file = join(tmpdir(), `stopAlarm-${process.pid}.mjs`);
writeFileSync(file, await bundle());
let n = 0;
// Each load is a fresh module instance: same as a new JS context after process death.
const load = () => import(`${file}?v=${n++}`);
const S = globalThis.__alarm;
const TASK = "background-notification-location";
const stop = { stopId: "S1", title: "Stop", body: "Arrived", lat: 22.3, lng: 114.17 };
const near = { coords: { latitude: 22.3005, longitude: 114.17 } }; // ~55 m
const far = { coords: { latitude: 22.4, longitude: 114.17 } }; // ~11 km
const run = async (locations) => { await S.tasks[TASK]({ data: { locations }, error: null }); await new Promise((r) => setTimeout(r, 20)); };
const posted = async (mod) => { let v; await mod.postAlarmToWebView({ current: { postMessage: (s) => (v = JSON.parse(s).value) } }); return v; };

beforeEach(() => { reset(); S.storage.clear(); });

test("happy path: arrives near the stop, notifies once and stops updates", async () => {
  const mod = await load();
  assert.equal(await mod.toggleAlarm(stop), true);
  assert.equal(await posted(mod), "S1");
  await run([far]);
  assert.equal(S.notified.length, 0);
  await new Promise((r) => setTimeout(r, 600)); // let the 500 ms throttle window pass
  await run([near]);
  assert.equal(S.notified.length, 1);
  assert.ok(S.stopped >= 1);
});

test("refused background permission does not leave the alarm shown as armed", async () => {
  reset({ bg: "denied" });
  const mod = await load();
  assert.equal(await mod.toggleAlarm(stop), false);
  assert.equal(S.started.length, 0);
  assert.equal(await posted(mod), "");
});

test("a throw from startLocationUpdatesAsync does not leave the alarm shown as armed", async () => {
  reset({ startThrows: true });
  const mod = await load();
  assert.equal(await mod.toggleAlarm(stop).catch(() => false), false);
  assert.equal(await posted(mod), "");
});

test("a batched update whose newest fix is near the stop notifies", async () => {
  const mod = await load();
  await mod.toggleAlarm(stop);
  await run([far, far, near]); // Android delivers deferred batches oldest first
  assert.equal(S.notified.length, 1);
});

test("task running in a fresh JS context (after process death) still knows the target", async () => {
  const mod = await load();
  await mod.toggleAlarm(stop);
  await load(); // headless relaunch re-registers the task with fresh module state
  await run([near]);
  assert.equal(S.notified.length, 1);
  assert.equal(S.notified[0].title, "Stop");
});

test("task in a fresh JS context with no saved target stops the updates instead of running forever", async () => {
  await load();
  await run([near]);
  assert.equal(S.notified.length, 0);
  assert.ok(S.stopped >= 1);
});

test("arming B while a fresh task is still reading saved stop A keeps B", async () => {
  const first = await load();
  await first.toggleAlarm(stop); // saves S1
  S.getDelay = 50; // the restore read of S1 is still pending while B arms
  const mod = await load(); // fresh context, empty memory
  const pending = run([far]);
  await mod.toggleAlarm({ ...stop, stopId: "B", title: "B stop" });
  await pending;
  assert.equal(await posted(mod), "B");
  assert.equal(JSON.parse(S.storage.get("stopAlarmTarget")).stopId, "B");
});

test("an older arm that fails late does not clear a newer armed stop", async () => {
  const mod = await load();
  let rejectA;
  S.startImpl = () => new Promise((_, rej) => { rejectA = rej; });
  const a = mod.toggleAlarm(stop);
  await new Promise((r) => setTimeout(r, 10));
  S.startImpl = null;
  assert.equal(await mod.toggleAlarm({ ...stop, stopId: "B" }), true);
  rejectA(new Error("late failure"));
  assert.equal(await a, false);
  assert.equal(await posted(mod), "B");
  assert.equal(JSON.parse(S.storage.get("stopAlarmTarget")).stopId, "B");
});

test("after the app is killed and reopened, a still-running alarm shows as armed", async () => {
  const first = await load();
  await first.toggleAlarm(stop);
  const mod = await load();
  assert.equal(await posted(mod), "S1");
});

test("after reopen, an early tap on the still-running stop disarms it", async () => {
  const first = await load();
  await first.toggleAlarm(stop); // updates running, S1 saved
  S.getDelay = 30; // the user taps before the restore read returns
  const mod = await load(); // app reopened: fresh JS context
  assert.equal(await mod.toggleAlarm(stop), true); // the tap is a disarm
  assert.equal(await posted(mod), "");
  assert.equal(S.running, false);
});

test("a saved target whose updates are no longer running is dropped on reopen", async () => {
  const first = await load();
  await first.toggleAlarm(stop);
  S.running = false; // e.g. the OS stopped the updates
  const mod = await load();
  assert.equal(await posted(mod), "");
  assert.equal(S.storage.has("stopAlarmTarget"), false);
});
