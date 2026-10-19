import { test } from "node:test";
import assert from "node:assert/strict";
import { runJson } from "../src/extractor.ts";

test("extractor preserves UTF-8 characters split between stdout chunks", async () => {
  const result = await runJson(process.execPath, [
    "-e",
    `
    const data = Buffer.from(JSON.stringify({ title: 'Blå kveld 🎵' }));
    const split = data.indexOf(Buffer.from('å')) + 1;
    process.stdout.write(data.subarray(0, split));
    setTimeout(() => process.stdout.write(data.subarray(split)), 20);
  `,
  ]);
  assert.deepEqual(result, { title: "Blå kveld 🎵" });
});

test("oversized extractor output is rejected and releases admission for the next job", async () => {
  await assert.rejects(
    runJson(process.execPath, [
      "-e",
      `
    process.stdout.write('x'.repeat(8_100_000));
    setInterval(() => {}, 1000);
  `,
    ]),
    /response was too large/,
  );
  assert.deepEqual(
    await runJson(process.execPath, ["-e", "process.stdout.write('{}')"]),
    {},
  );
});

test("deadline kills a hung extractor before its slot becomes available again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const job = runJson(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    const rejected = assert.rejects(job, /did not respond in time/);
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(30000);
    await rejected;
  } finally {
    t.mock.timers.reset();
  }
  assert.deepEqual(
    await runJson(process.execPath, ["-e", "process.stdout.write('{}')"]),
    {},
  );
});

test("running extractor cancellation and spawn failure do not exhaust the pool", async () => {
  for (let i = 0; i < 6; i++) {
    const controller = new AbortController();
    const job = runJson(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      controller.signal,
    );
    const rejected = assert.rejects(job, /cancelled/);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await rejected;
  }
  await assert.rejects(runJson("/synthetic-missing-extractor", []));
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      runJson(process.execPath, ["-e", "process.stdout.write('{}')"]),
    ),
  );
  assert.deepEqual(results, [{}, {}, {}, {}]);
});

test('cancelling an extractor also stops its owned POSIX helper process', {skip:process.platform==='win32'}, async () => {
 const {mkdtempSync,existsSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const directory=mkdtempSync(join(tmpdir(),'extractor-group-')),file=join(directory,'pids.json');
 const controller=new AbortController();let helper=0;
 const job=runJson(process.execPath,['-e',`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(file)},JSON.stringify({helper:child.pid}));setInterval(()=>{},1000);`],controller.signal);
 const cancelled=assert.rejects(job,/cancelled/);
 try {
  for(let i=0;i<100&&!existsSync(file);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert(existsSync(file),'Synthetic extractor must report its owned helper');helper=JSON.parse(readFileSync(file,'utf8')).helper;
  controller.abort();await cancelled;
  // A terminated child may briefly be a zombie awaiting PID1's reaper.
  const alive=()=>{try{const stat=readFileSync('/proc/'+helper+'/stat','utf8');return !/\) Z /.test(stat);}catch{return false;}};
  for(let i=0;i<100&&alive();i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(alive(),false,'The JavaScript helper must not outlive its cancelled extractor');
 }finally{controller.abort();if(helper)try{process.kill(helper,'SIGKILL');}catch{}await cancelled;rmSync(directory,{recursive:true,force:true});}
});
