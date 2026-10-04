import { generateQRCodeForUrl, getLocalIP } from './qr-generator.js';

/**
 * Render a small, mobile-camera-friendly page showing a QR for the
 * single-device conversation URL. Opened on any LAN device (e.g. the host's
 * laptop at https://<lan-ip>:<port>/join) and scanned by the phone, so the
 * phone never has to type the URL.
 */
export async function renderJoinPage(port: number): Promise<string> {
  const ip = await getLocalIP();
  const url = `https://${ip}:${port}/conversation`;
  const qr = await generateQRCodeForUrl(url);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Join conversation</title>
<style>
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#faf9f7;color:#2a2724;font-family:-apple-system,system-ui,sans-serif;padding:24px;box-sizing:border-box}
  h1{font-size:1.25rem;margin:0 0 .25rem;font-weight:600}
  p.sub{color:#6b6358;margin:.25rem 0 1.5rem;font-size:.9rem;text-align:center}
  img{width:300px;height:300px;background:#fff;padding:12px;border-radius:16px;border:1px solid #e7e0d6}
  p.url{margin-top:1.25rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;color:#6b6358;word-break:break-all;text-align:center;max-width:320px}
</style>
</head>
<body>
  <h1>Scan to translate</h1>
  <p class="sub">Point your phone camera at the code.</p>
  <img src="${qr}" alt="QR code for ${url}"/>
  <p class="url">${url}</p>
</body>
</html>`;
}
