import { canActivateCamera, ConsentState } from './consent';
import { buildVerifyPayload } from './payload';

interface PluginOptions {
  sessionToken: string;
  apiBase: string;
  encryptionKeyHex: string; // ephemeral session key issued by tenant backend
  privacyPolicyUrl: string;
  policyVersion: string; // version of the privacy policy shown to the user
}

export async function mountEcaVerify(container: HTMLElement, opts: PluginOptions): Promise<void> {
  const state: ConsentState = { consentGiven: false };

  container.innerHTML = `
    <style>
      .eca-consent {
        --eca-accent: #6d8bff;
        --eca-accent-2: #b06dff;
        --eca-grad: linear-gradient(120deg, #6d8bff 0%, #b06dff 100%);
        --eca-text: #1a1f33;
        --eca-muted: #5b6480;
        --eca-border: #e4e8f4;
        --eca-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        box-sizing: border-box;
        font-family: var(--eca-font);
        color: var(--eca-text);
        max-width: 400px;
        margin: 0 auto;
        padding: 28px 26px 26px;
        background: #fff;
        border: 1px solid var(--eca-border);
        border-radius: 20px;
        box-shadow: 0 24px 60px -28px rgba(40, 50, 90, 0.45), 0 2px 8px -4px rgba(40, 50, 90, 0.18);
        -webkit-font-smoothing: antialiased;
        animation: eca-rise .45s cubic-bezier(.2,.7,.3,1) both;
      }
      .eca-consent *, .eca-consent *::before, .eca-consent *::after { box-sizing: border-box; }
      .eca-consent .eca-badge {
        width: 52px; height: 52px;
        border-radius: 15px;
        background: var(--eca-grad);
        display: grid; place-items: center;
        box-shadow: 0 12px 26px -10px rgba(109, 139, 255, 0.85);
        margin-bottom: 16px;
      }
      .eca-consent .eca-badge svg { width: 28px; height: 28px; display: block; }
      .eca-consent h2 {
        margin: 0 0 6px;
        font-size: 19px; font-weight: 650; letter-spacing: -0.2px;
      }
      .eca-consent .eca-lead {
        margin: 0 0 18px;
        font-size: 14px; line-height: 1.55; color: var(--eca-muted);
      }
      .eca-consent .eca-lead strong { color: var(--eca-text); font-weight: 650; }
      .eca-consent .eca-trust {
        display: flex; flex-direction: column; gap: 10px;
        margin: 0 0 20px;
        padding: 14px 16px;
        background: linear-gradient(135deg, rgba(109,139,255,0.07), rgba(176,109,255,0.05));
        border: 1px solid var(--eca-border);
        border-radius: 14px;
      }
      .eca-consent .eca-trust .row { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--eca-muted); }
      .eca-consent .eca-trust .row strong { color: var(--eca-text); font-weight: 600; }
      .eca-consent .eca-trust svg { width: 17px; height: 17px; flex: 0 0 auto; color: var(--eca-accent); }
      .eca-consent a {
        color: var(--eca-accent); font-weight: 600; text-decoration: none;
        border-bottom: 1px solid rgba(109,139,255,0.35); transition: border-color .15s ease;
      }
      .eca-consent a:hover { border-bottom-color: var(--eca-accent); }
      .eca-consent label {
        display: flex; align-items: flex-start; gap: 11px;
        font-size: 13.5px; line-height: 1.45; color: var(--eca-text);
        cursor: pointer; margin-bottom: 18px;
      }
      .eca-consent label input[type="checkbox"] {
        appearance: none; -webkit-appearance: none;
        width: 20px; height: 20px; flex: 0 0 auto; margin: 1px 0 0;
        border: 1.5px solid #c2c9de; border-radius: 6px; background: #fff;
        cursor: pointer; position: relative;
        transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
      }
      .eca-consent label input[type="checkbox"]:hover { border-color: var(--eca-accent); }
      .eca-consent label input[type="checkbox"]:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(109,139,255,0.3); }
      .eca-consent label input[type="checkbox"]:checked { background: var(--eca-grad); border-color: transparent; }
      .eca-consent label input[type="checkbox"]:checked::after {
        content: ""; position: absolute; left: 6px; top: 2px;
        width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
      .eca-consent button {
        width: 100%;
        padding: 13px 18px;
        border: none; border-radius: 12px;
        font: inherit; font-size: 15px; font-weight: 650; color: #fff;
        background: var(--eca-grad);
        cursor: pointer;
        box-shadow: 0 14px 30px -12px rgba(109, 139, 255, 0.9);
        transition: transform .15s ease, box-shadow .15s ease, filter .15s ease, opacity .15s ease;
      }
      .eca-consent button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 18px 36px -12px rgba(176, 109, 255, 0.9); }
      .eca-consent button:active:not(:disabled) { transform: translateY(0); }
      .eca-consent button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(176,109,255,0.4); }
      .eca-consent button:disabled { cursor: not-allowed; opacity: .5; box-shadow: none; filter: grayscale(.3); }
      @keyframes eca-rise { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: none; } }
      @media (prefers-color-scheme: dark) {
        .eca-consent {
          --eca-text: #eef1fb; --eca-muted: #9aa3c4; --eca-border: rgba(120,140,200,0.18);
          background: #131a33;
          box-shadow: 0 24px 60px -28px rgba(0,0,0,0.7), 0 0 0 1px rgba(120,140,200,0.08);
        }
        .eca-consent label input[type="checkbox"] { background: rgba(7,11,24,0.6); border-color: rgba(120,140,200,0.4); }
      }
      @media (prefers-reduced-motion: reduce) {
        .eca-consent, .eca-consent * { animation: none !important; transition: none !important; }
      }
    </style>
    <div class="eca-consent" role="group" aria-label="Consentimento de verificação de idade">
      <span class="eca-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      </span>
      <h2>Verificação de idade</h2>
      <p class="eca-lead">Para comprovar sua idade, capturaremos uma imagem do seu rosto, usada
         <strong>exclusivamente</strong> para verificação etária e descartada logo após.</p>
      <div class="eca-trust">
        <span class="row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z"/></svg>
          <span><strong>Sem armazenamento</strong> — a imagem é processada e descartada.</span>
        </span>
        <span class="row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>Criptografada de ponta a ponta, conforme a <strong>LGPD</strong>.</span>
        </span>
      </div>
      <p class="eca-lead">Saiba mais na <a href="${opts.privacyPolicyUrl}" target="_blank" rel="noopener">Política de Privacidade</a>.</p>
      <label><input type="checkbox" id="eca-consent-box"/> <span>Eu concordo com a captura biométrica para verificação de idade.</span></label>
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
      const res = await fetch(`${opts.apiBase}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      container.innerHTML = res.ok
        ? '<p>Verificação enviada.</p>'
        : '<p>Falha ao enviar a verificação. Tente novamente.</p>';
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
