import os from 'node:os';
import QRCode from 'qrcode';

export async function getLocalIP(): Promise<string> {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

export async function generateQRCode(port: number = 3000): Promise<{ url: string; dataUrl: string }> {
  const ip = await getLocalIP();
  const url = `http://${ip}:${port}`;
  const dataUrl = await QRCode.toDataURL(url, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  return { url, dataUrl };
}

export async function generateQRCodeForUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}
