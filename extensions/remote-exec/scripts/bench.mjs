// remote-exec 微基准脚本（不保存凭据）
// 用法：node scripts/bench.mjs --host 1.2.3.4 --user root --password xxx [--port 22]
import { Client } from 'ssh2';
import { performance } from 'node:perf_hooks';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[`REMOTE_EXEC_${name.toUpperCase()}`] ?? def;
}
const N = Number(arg('n', '20'));
const TARGET = {
  host: arg('host'),
  port: Number(arg('port', '22')),
  username: arg('user'),
  password: arg('password'),
};
if (!TARGET.host || !TARGET.username || !TARGET.password) {
  console.error('缺少参数：--host --user --password');
  process.exit(2);
}

const c = new Client();
await new Promise((res, rej) => {
  c.on('ready', res).on('error', rej);
  c.connect({ ...TARGET, readyTimeout: 8000 });
});
const sftp = await new Promise((res, rej) => c.sftp((e, s) => e ? rej(e) : res(s)));
await new Promise((res, rej) => c.exec('mkdir -p /tmp/iris-bench && head -c 10240 /dev/urandom | base64 > /tmp/iris-bench/test.txt', (e, s) => {
  if (e) return rej(e);
  s.on('close', () => res()).on('data', () => {}).stderr.on('data', () => {});
}));
function exec(cmd) {
  return new Promise((res) => {
    c.exec(cmd, (err, stream) => {
      if (err) return res({ ok: false });
      let out = '';
      stream.on('close', () => res({ ok: true, out })).on('data', (d) => out += d);
      stream.stderr.on('data', () => {});
    });
  });
}
async function bench(name, fn) {
  await fn();
  const samples = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p50 = samples[Math.floor(N * 0.5)];
  const p95 = samples[Math.floor(N * 0.95)];
  console.log(`${name.padEnd(45)}  avg=${avg.toFixed(1).padStart(6)}ms  p50=${p50.toFixed(1).padStart(6)}ms  p95=${p95.toFixed(1).padStart(6)}ms`);
}
console.log(`\n=== 远端: ${TARGET.username}@${TARGET.host}, N=${N} ===\n`);
console.log('— "什么也不做"基准（衡量 ssh exec / sftp 通道开销）—');
await bench('exec  : true                                  ', () => exec('true'));
await bench('sftp  : stat(/tmp/iris-bench/test.txt)       ', () => new Promise((res) => sftp.stat('/tmp/iris-bench/test.txt', () => res())));
console.log('\n— 读取一个 10KB 文件 —');
await bench('exec  : cat | base64 -w0                     ', () => exec('cat /tmp/iris-bench/test.txt | base64 -w0'));
await bench('exec  : python3 -c "open().read()"           ', () => exec(`python3 -c "import sys,base64;sys.stdout.write(base64.b64encode(open('/tmp/iris-bench/test.txt','rb').read()).decode())"`));
await bench('sftp  : readFile                              ', () => new Promise((res, rej) => sftp.readFile('/tmp/iris-bench/test.txt', (e, b) => e ? rej(e) : res(b))));
console.log('\n— 列目录（约 20 个条目）—');
await bench('exec  : find -maxdepth 1 -print0 | base64 -w0', () => exec('find /root -maxdepth 1 -print0 | base64 -w0'));
await bench('exec  : python3 os.listdir + json.dumps      ', () => exec(`python3 -c "import os,json;print(json.dumps(os.listdir('/root')))"`));
await bench('sftp  : readdir(/root)                        ', () => new Promise((res, rej) => sftp.readdir('/root', (e, l) => e ? rej(e) : res(l))));
console.log('\n— 创建+删除目录 —');
await bench('exec  : bash mkdir+rmdir                      ', () => exec('mkdir /tmp/iris-bench/x && rmdir /tmp/iris-bench/x'));
await bench('exec  : python3 os.mkdir+os.rmdir             ', () => exec(`python3 -c "import os;os.mkdir('/tmp/iris-bench/x');os.rmdir('/tmp/iris-bench/x')"`));
await bench('sftp  : mkdir + rmdir                         ', () => new Promise((res, rej) => sftp.mkdir('/tmp/iris-bench/x', (e) => e ? rej(e) : sftp.rmdir('/tmp/iris-bench/x', (e2) => e2 ? rej(e2) : res()))));
console.log('\n— 写一个小文件 —');
const content = 'hello world\n'.repeat(50);
await bench('exec  : printf | base64 -d > file            ', () => {
  const b64 = Buffer.from(content).toString('base64');
  return exec(`printf '%s' '${b64}' | base64 -d > /tmp/iris-bench/w.txt`);
});
await bench('exec  : python3 open().write()                ', () => {
  const b64 = Buffer.from(content).toString('base64');
  return exec(`python3 -c "import base64;open('/tmp/iris-bench/w.txt','wb').write(base64.b64decode('${b64}'))"`);
});
await bench('sftp  : writeFile                              ', () => new Promise((res, rej) => sftp.writeFile('/tmp/iris-bench/w.txt', content, (e) => e ? rej(e) : res())));
c.end();
console.log('\n完成');
