// Runs inside the n8n container: asks the Remotion service to render one story.
// usage: node remotion-call.js /files/work/props_0.json video.mp4
const http = require('http');
const [, , props, out] = process.argv;
const body = JSON.stringify({ props, out });
const req = http.request({ host: 'remotion', port: 3000, path: '/render', method: 'POST',
  headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
  let d = '';
  res.on('data', (c) => { d += c; });
  res.on('end', () => { console.log(res.statusCode, d.slice(0, 1500)); process.exit(res.statusCode === 200 ? 0 : 1); });
});
req.on('error', (e) => { console.error('Remotion service not reachable:', e.message); process.exit(1); });
req.setTimeout(25 * 60 * 1000, () => { console.error('Remotion timed out'); req.destroy(); process.exit(1); });
req.end(body);
