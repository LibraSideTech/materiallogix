// Companion connection: turns the bridge's Wi-Fi address into a link a phone
// camera can open directly. The typed address stays as the fallback for
// phones without a camera shortcut. Everything here is pure except the final
// canvas paint, so the node suite can verify the link and the matrix.
import qrcodegen from './vendor/qrcodegen.js';

const BRIDGE_PIN_KEY = 'cros:bridgePin';
const PIN_SHAPE = /^\d{4,10}$/;

/**
 * The address a phone on the same Wi-Fi opens. The bridge PIN travels in the
 * fragment: fragments never leave the browser, so the PIN cannot land in a
 * server log or a Referer header. A malformed PIN is dropped, not encoded.
 */
export function companionUrl(lanAddresses, port, pin = '') {
  const host = Array.isArray(lanAddresses) ? String(lanAddresses[0] || '') : '';
  if (!host) return '';
  const base = `http://${host}:${Number(port) || 80}/`;
  return PIN_SHAPE.test(String(pin || '')) ? `${base}#bridge-pin=${pin}` : base;
}

/**
 * On the phone: adopt a PIN delivered by a scanned companion link so the
 * bridge never has to prompt for it. Returns true when a PIN was stored;
 * the caller then clears the fragment from the address bar.
 */
export function adoptBridgePinFromHash(hash, storage) {
  const match = /^#bridge-pin=(\d{4,10})$/.exec(String(hash || ''));
  if (!match) return false;
  storage.setItem(BRIDGE_PIN_KEY, match[1]);
  return true;
}

/** Encode a companion link as a QR module matrix (medium error correction). */
export function companionQrMatrix(text) {
  const qr = qrcodegen.QrCode.encodeText(String(text), qrcodegen.QrCode.Ecc.MEDIUM);
  return { size: qr.size, dark: (x, y) => qr.getModule(x, y) };
}

/**
 * Paint the matrix onto a canvas. Near-black on warm paper keeps the studio
 * look while staying camera-readable; the quiet-zone border is required by
 * the QR specification, so it is part of the painted tile.
 */
export function paintCompanionQr(canvas, matrix, { scale = 4, border = 4, dark = '#161310', light = '#f5efe3' } = {}) {
  const px = (matrix.size + border * 2) * scale;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = dark;
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.dark(x, y)) ctx.fillRect((border + x) * scale, (border + y) * scale, scale, scale);
    }
  }
}
