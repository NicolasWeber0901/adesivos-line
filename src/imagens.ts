/**
 * Carrega imagens uma vez só e guarda o canal alfa de cada adesivo,
 * para que tocar na parte transparente de um móvel pegue o que está atrás dele.
 */
export interface ImagemCarregada {
  img: HTMLImageElement;
  w: number;
  h: number;
  alfa: Uint8Array;
}

const cache = new Map<string, Promise<ImagemCarregada>>();
const prontas = new Map<string, ImagemCarregada>();

export function carregar(src: string): Promise<ImagemCarregada> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise<ImagemCarregada>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const rgba = ctx.getImageData(0, 0, w, h).data;
        const alfa = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) alfa[i] = rgba[i * 4 + 3];
        const pronta = { img, w, h, alfa };
        prontas.set(src, pronta);
        resolve(pronta);
      };
      img.onerror = () => reject(new Error(`Não consegui abrir ${src}`));
      img.src = src;
    });
    cache.set(src, p);
  }
  return p;
}

/** Imagem já carregada (ou undefined se ainda está chegando). */
export function pronta(src: string) {
  return prontas.get(src);
}

/** O ponto (em pixels da imagem) cai em tinta? Olha uma pequena vizinhança para facilitar o toque. */
export function temTinta(im: ImagemCarregada, x: number, y: number, raio = 3) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -raio; dy <= raio; dy += raio)
    for (let dx = -raio; dx <= raio; dx += raio) {
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || py < 0 || px >= im.w || py >= im.h) continue;
      if (im.alfa[py * im.w + px] > 60) return true;
    }
  return false;
}
