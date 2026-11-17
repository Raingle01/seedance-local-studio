import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['scripts/build.mjs', '--watch'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit' }),
];
let closing = false;
function stop() { if (closing) return; closing = true; for (const child of children) child.kill('SIGTERM'); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
for (const child of children) {
  child.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
  child.on('exit', code => { if (code && !closing) { process.exitCode = code; stop(); } });
}
