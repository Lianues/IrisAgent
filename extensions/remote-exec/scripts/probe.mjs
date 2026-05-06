// remote-exec doctor/probe 脚本（不保存凭据）
// 用法：
//   node scripts/probe.mjs --host 1.2.3.4 --user root --password xxx [--port 22]
// 或：
//   REMOTE_EXEC_HOST=1.2.3.4 REMOTE_EXEC_USER=root REMOTE_EXEC_PASSWORD=xxx node scripts/probe.mjs
import { Client } from 'ssh2';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[`REMOTE_EXEC_${name.toUpperCase()}`] ?? def;
}

const target = {
  name: arg('name', 'target'),
  host: arg('host'),
  port: Number(arg('port', '22')),
  username: arg('user'),
  password: arg('password'),
};

if (!target.host || !target.username || !target.password) {
  console.error('缺少参数：--host --user --password');
  process.exit(2);
}

function probe(t) {
  return new Promise((resolve) => {
    const report = { name: t.name, target: `${t.username}@${t.host}:${t.port}`, connect: null, exec: null, sftp: null, tools: {}, sftpListSample: null, error: null };
    const c = new Client();
    const finish = () => { try { c.end(); } catch {} resolve(report); };
    c.on('error', (e) => { report.error = `${e.code || ''} ${e.message}`.trim(); finish(); });
    c.on('ready', async () => {
      report.connect = 'OK';
      const execCmd = (cmd) => new Promise((res) => {
        c.exec(cmd, (err, stream) => {
          if (err) return res({ ok: false, err: err.message });
          let out = '', errOut = '';
          stream.on('close', (rc) => res({ ok: true, rc, out: out.trim(), err: errOut.trim() }));
          stream.on('data', (d) => out += d.toString());
          stream.stderr.on('data', (d) => errOut += d.toString());
        });
      });
      const uname = await execCmd('uname -a; echo ---; cat /etc/os-release 2>/dev/null | head -3; echo ---; for t in bash sh find grep base64 sed awk wc printf mkdir rm cat sha256sum python python3; do command -v $t >/dev/null && echo "$t=$(command -v $t)" || echo "$t=MISSING"; done');
      report.exec = uname.ok ? `OK (rc=${uname.rc})` : `FAIL (${uname.err})`;
      if (uname.ok) {
        const lines = uname.out.split('\n');
        const sepIdx = [];
        lines.forEach((l, i) => { if (l === '---') sepIdx.push(i); });
        report.uname = lines.slice(0, sepIdx[0]).join(' | ');
        report.os = lines.slice(sepIdx[0]+1, sepIdx[1]).join(' | ');
        for (const l of lines.slice(sepIdx[1]+1)) {
          const m = l.match(/^(\w+)=(.+)$/);
          if (m) report.tools[m[1]] = m[2] === 'MISSING' ? 'NO' : m[2];
        }
      }
      await new Promise((res) => {
        c.sftp((err, sftp) => {
          if (err) { report.sftp = `FAIL (${err.message})`; return res(); }
          report.sftp = 'OK';
          sftp.readdir('.', (err2, list) => {
            if (err2) { report.sftpListSample = `readdir err: ${err2.message}`; return res(); }
            report.sftpListSample = list.slice(0, 5).map(e => e.filename).join(', ') + (list.length > 5 ? ` … (+${list.length - 5})` : '');
            res();
          });
        });
      });
      finish();
    });
    c.connect({ host: t.host, port: t.port, username: t.username, password: t.password, readyTimeout: 8000 });
  });
}

console.log(JSON.stringify(await probe(target), null, 2));
