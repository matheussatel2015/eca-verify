import { canActivateCamera, ConsentState } from './consent';
import { buildVerifyPayload } from './payload';

interface PluginOptions {
  sessionToken: string;
  apiBase: string;
  encryptionKeyHex: string; // ephemeral session key issued by tenant backend
  privacyPolicyUrl: string;
}

export async function mountEcaVerify(container: HTMLElement, opts: PluginOptions): Promise<void> {
  const state: ConsentState = { consentGiven: false };

  container.innerHTML = `
    <div class="eca-consent">
      <p>Para comprovar sua idade, capturaremos uma imagem do seu rosto, usada
         <strong>exclusivamente</strong> para verificação etária e descartada logo após.
         <a href="${opts.privacyPolicyUrl}" target="_blank" rel="noopener">Política de Privacidade</a>.</p>
      <label><input type="checkbox" id="eca-consent-box"/> Eu concordo com a captura biométrica para verificação de idade.</label>
      <button id="eca-start" disabled>Iniciar verificação</button>
    </div>`;

  const box = container.querySelector('#eca-consent-box') as HTMLInputElement;
  const btn = container.querySelector('#eca-start') as HTMLButtonElement;
  box.addEventListener('change', () => {
    state.consentGiven = box.checked;
    btn.disabled = !canActivateCamera(state);
  });

  btn.addEventListener('click', async () => {
    if (!canActivateCamera(state)) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    try {
      const frame = await captureFrame(stream);
      const enc = await encryptWithWebCrypto(frame, opts.encryptionKeyHex);
      const payload = buildVerifyPayload(opts.sessionToken, enc);
      await fetch(`${opts.apiBase}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      container.innerHTML = '<p>Verificação enviada.</p>';
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  });
}

async function captureFrame(stream: MediaStream): Promise<Uint8Array> {
  const video = document.createElement('video');
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

async function encryptWithWebCrypto(plain: Uint8Array, keyHex: string) {
  const keyBytes = Uint8Array.from(keyHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  // WebCrypto appends the 16-byte tag to the ciphertext; split it for the API contract.
  const tag = out.slice(out.length - 16);
  const ciphertext = out.slice(0, out.length - 16);
  return {
    iv: Buffer.from(iv),
    tag: Buffer.from(tag),
    ciphertext: Buffer.from(ciphertext),
  };
}
