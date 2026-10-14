/**
 * Recorta cada folha em `folhas/` em adesivos com fundo transparente.
 *
 * Para cada imagem:
 *  1. Remove o fundo com um preenchimento a partir das bordas que tolera degradês.
 *  2. Separa cada "ilha" de desenho como um adesivo (peças muito próximas são agrupadas).
 *  3. A maior peça vira o cômodo (fundo da fase).
 *  4. Gera WebPs em `public/fases/<id>/` e o índice `public/fases/manifest.json`.
 *
 * Ajustes opcionais por folha: `folhas/<mesmo-nome>.json` (veja ConfigFolha).
 */
import sharp from "sharp";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AdesivoManifest, FaseManifest } from "../src/tipos.ts";

type Retangulo = [x: number, y: number, w: number, h: number];

interface ConfigFolha {
  /** Nome exibido no botão da fase. */
  nome?: string;
  /** Regiões apagadas antes do recorte (títulos, marcas d'água, decoração da folha). */
  ignorar?: Retangulo[];
  /** Cada retângulo junta numa peça só todas as peças cujo centro cai dentro dele. */
  unir?: Retangulo[];
  /**
   * Para desenhos com contorno aberto (pelúcia, traço pontilhado, peças muito claras):
   * junta as peças do retângulo e "fecha" o contorno, preenchendo o miolo.
   * O 5º número opcional é o raio de fechamento (padrão 4).
   */
  fechar?: [x: number, y: number, w: number, h: number, raio?: number][];
  /** Remove a peça que contém cada ponto [x, y] (repetidos, enfeites da folha…). */
  remover?: [x: number, y: number][];
  /** Força a região do cômodo, caso a maior peça não seja ele. */
  comodo?: Retangulo;
  /** Diferença de cor aceita ao "andar" pelo fundo (padrão 30). */
  tolerancia?: number;
  /** Distância em px para considerar duas partes como o mesmo adesivo (padrão 3). */
  juntarAte?: number;
  /** Área mínima em px para virar adesivo (padrão 120). */
  areaMinima?: number;
}

interface Peca {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: number[];
}

const RAIZ = path.resolve(import.meta.dirname, "..");
const PASTA_FOLHAS = path.join(RAIZ, "folhas");
const PASTA_SAIDA = path.join(RAIZ, "public", "fases");
const PASTA_DEBUG = path.join(RAIZ, ".cache", "recortes");
const DEBUG = process.argv.includes("--debug");

const dist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) =>
  Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);

/** Branco/cinza claro sem cor: sempre pode ser fundo quando encostado no fundo. */
const neutroClaro = (r: number, g: number, b: number) =>
  Math.min(r, g, b) >= 196 && Math.max(r, g, b) - Math.min(r, g, b) <= 16;

function nomeBonito(arquivo: string) {
  const base = arquivo.replace(/\.[^.]+$/, "").replace(/^\d+[-_ ]*/, "");
  const texto = base.replace(/[-_]+/g, " ").trim();
  return texto ? texto[0].toUpperCase() + texto.slice(1) : arquivo;
}

function slug(arquivo: string) {
  return arquivo
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function recortarFolha(arquivo: string): Promise<FaseManifest> {
  const caminho = path.join(PASTA_FOLHAS, arquivo);
  const caminhoConfig = caminho.replace(/\.[^.]+$/, ".json");
  const config: ConfigFolha = existsSync(caminhoConfig)
    ? JSON.parse(await readFile(caminhoConfig, "utf8"))
    : {};

  const tolerancia = config.tolerancia ?? 30;
  const juntarAte = config.juntarAte ?? 3;
  const areaMinima = config.areaMinima ?? 120;

  const { data: px, info } = await sharp(caminho)
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const N = W * H;

  // Regiões ignoradas viram fundo direto.
  const ignorado = new Uint8Array(N);
  for (const [x, y, w, h] of config.ignorar ?? []) {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) ignorado[yy * W + xx] = 1;
  }

  // ---- 1. Fundo: BFS a partir das bordas com cor de referência que acompanha degradês.
  const fundo = new Uint8Array(N);
  const ref = new Float32Array(N * 3);
  const fila = new Int32Array(N);
  let ini = 0;
  let fim = 0;
  const semear = (i: number) => {
    if (fundo[i]) return;
    fundo[i] = 1;
    ref[i * 3] = px[i * 4];
    ref[i * 3 + 1] = px[i * 4 + 1];
    ref[i * 3 + 2] = px[i * 4 + 2];
    fila[fim++] = i;
  };
  for (let x = 0; x < W; x++) {
    semear(x);
    semear((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    semear(y * W);
    semear(y * W + W - 1);
  }
  for (let i = 0; i < N; i++) if (ignorado[i]) semear(i);

  while (ini < fim) {
    const i = fila[ini++];
    const x = i % W;
    const y = (i / W) | 0;
    const rr = ref[i * 3];
    const rg = ref[i * 3 + 1];
    const rb = ref[i * 3 + 2];
    const pr = px[i * 4];
    const pg = px[i * 4 + 1];
    const pb = px[i * 4 + 2];
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? x - 1 : k === 1 ? x + 1 : x;
      const ny = k === 2 ? y - 1 : k === 3 ? y + 1 : y;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (fundo[j]) continue;
      const r = px[j * 4];
      const g = px[j * 4 + 1];
      const b = px[j * 4 + 2];
      const pertoRef = dist(r, g, b, rr, rg, rb) <= tolerancia;
      const passoSuave = dist(r, g, b, pr, pg, pb) <= tolerancia * 0.5 && dist(r, g, b, rr, rg, rb) <= tolerancia * 1.6;
      const viraNeutro = neutroClaro(r, g, b) && neutroClaro(pr, pg, pb);
      if (pertoRef || passoSuave || viraNeutro) {
        fundo[j] = 1;
        ref[j * 3] = rr * 0.85 + r * 0.15;
        ref[j * 3 + 1] = rg * 0.85 + g * 0.15;
        ref[j * 3 + 2] = rb * 0.85 + b * 0.15;
        fila[fim++] = j;
      }
    }
  }

  // ---- 2. Peças: componentes conectados do desenho, com uma "folga" para juntar partes próximas.
  const desenho = new Uint8Array(N);
  for (let i = 0; i < N; i++) desenho[i] = fundo[i] ? 0 : 1;

  const dilatado = dilatar(desenho, W, H, juntarAte);
  const rotulo = new Int32Array(N).fill(-1);
  let pecas: Peca[] = [];
  for (let s = 0; s < N; s++) {
    if (!dilatado[s] || rotulo[s] !== -1) continue;
    const id = pecas.length;
    const peca: Peca = { minX: W, minY: H, maxX: 0, maxY: 0, pixels: [] };
    ini = 0;
    fim = 0;
    fila[fim++] = s;
    rotulo[s] = id;
    while (ini < fim) {
      const i = fila[ini++];
      const x = i % W;
      const y = (i / W) | 0;
      if (desenho[i]) {
        peca.pixels.push(i);
        if (x < peca.minX) peca.minX = x;
        if (y < peca.minY) peca.minY = y;
        if (x > peca.maxX) peca.maxX = x;
        if (y > peca.maxY) peca.maxY = y;
      }
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (dilatado[j] && rotulo[j] === -1) {
            rotulo[j] = id;
            fila[fim++] = j;
          }
        }
    }
    pecas.push(peca);
  }
  // Remoções manuais.
  for (const [rx, ry] of config.remover ?? []) {
    const alvo = pecas
      .filter((p) => p.pixels.length >= areaMinima && rx >= p.minX && rx <= p.maxX && ry >= p.minY && ry <= p.maxY)
      .sort((a, b) => a.pixels.length - b.pixels.length)[0];
    if (alvo) pecas = pecas.filter((p) => p !== alvo);
  }

  // Uniões manuais.
  const unirNoRetangulo = ([ux, uy, uw, uh]: Retangulo): Peca | undefined => {
    const dentro = pecas.filter((p) => {
      const cx = (p.minX + p.maxX) / 2;
      const cy = (p.minY + p.maxY) / 2;
      return cx >= ux && cx <= ux + uw && cy >= uy && cy <= uy + uh;
    });
    if (!dentro.length) return undefined;
    if (dentro.length === 1) return dentro[0];
    const unida: Peca = {
      minX: Math.min(...dentro.map((p) => p.minX)),
      minY: Math.min(...dentro.map((p) => p.minY)),
      maxX: Math.max(...dentro.map((p) => p.maxX)),
      maxY: Math.max(...dentro.map((p) => p.maxY)),
      pixels: dentro.flatMap((p) => p.pixels),
    };
    pecas = [...pecas.filter((p) => !dentro.includes(p)), unida];
    return unida;
  };
  for (const r of config.unir ?? []) unirNoRetangulo(r);
  for (const [fx, fy, fw, fh, raio] of config.fechar ?? []) {
    const peca = unirNoRetangulo([fx, fy, fw, fh]);
    if (peca) fecharContorno(peca, W, H, raio ?? 4);
  }
  // Fragmentos pequenos (sujeira, traços soltos) só entram se foram unidos a algo acima.
  pecas = pecas.filter((p) => p.pixels.length >= areaMinima);

  // ---- 3. Cômodo = maior peça (ou a indicada na config).
  const areaCaixa = (p: Peca) => (p.maxX - p.minX + 1) * (p.maxY - p.minY + 1);
  let comodo: Peca;
  if (config.comodo) {
    const [cx, cy, cw, ch] = config.comodo;
    comodo = pecas.reduce((melhor, p) => {
      const sobreposicao = (q: Peca) =>
        Math.max(0, Math.min(q.maxX, cx + cw) - Math.max(q.minX, cx)) *
        Math.max(0, Math.min(q.maxY, cy + ch) - Math.max(q.minY, cy));
      return sobreposicao(p) > sobreposicao(melhor) ? p : melhor;
    });
  } else {
    comodo = pecas.reduce((a, b) => (areaCaixa(b) > areaCaixa(a) ? b : a));
  }
  const adesivos = pecas
    .filter((p) => p !== comodo)
    .sort((a, b) => a.minY - b.minY || a.minX - b.minX);

  // ---- 4. Exporta.
  const id = slug(arquivo);
  const pastaFase = path.join(PASTA_SAIDA, id);
  await mkdir(pastaFase, { recursive: true });

  const exportar = async (p: Peca, nomeArquivo: string, preencherInterior: boolean) => {
    const pad = 2;
    const x0 = Math.max(0, p.minX - pad);
    const y0 = Math.max(0, p.minY - pad);
    const x1 = Math.min(W - 1, p.maxX + pad);
    const y1 = Math.min(H - 1, p.maxY + pad);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const mascara = new Uint8Array(N);
    for (const i of p.pixels) mascara[i] = 1;
    if (preencherInterior) preencherBuracos(mascara, W, H, x0, y0, x1, y1);

    const out = Buffer.alloc(w * h * 4);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const o = ((y - y0) * w + (x - x0)) * 4;
        if (!mascara[i]) continue;
        let r = px[i * 4];
        let g = px[i * 4 + 1];
        let b = px[i * 4 + 2];
        let a = 255;
        // Borda suave: pixels do desenho encostados no fundo ganham transparência parcial.
        const vizFundo = vizinhoFundo(i, W, H, fundo, mascara);
        if (vizFundo >= 0) {
          const fr = ref[vizFundo * 3];
          const fg = ref[vizFundo * 3 + 1];
          const fb = ref[vizFundo * 3 + 2];
          const alfa = Math.min(1, dist(r, g, b, fr, fg, fb) / 110);
          if (alfa < 1) {
            a = Math.round(Math.max(0.25, alfa) * 255);
            const af = a / 255;
            r = clamp((r - (1 - af) * fr) / af);
            g = clamp((g - (1 - af) * fg) / af);
            b = clamp((b - (1 - af) * fb) / af);
          }
        }
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
    await sharp(out, { raw: { width: w, height: h, channels: 4 } })
      .webp({ quality: 92, alphaQuality: 100 })
      .toFile(path.join(pastaFase, nomeArquivo));
    return { w, h };
  };

  const dimComodo = await exportar(comodo, "comodo.webp", true);
  const lista: AdesivoManifest[] = [];
  for (const [n, p] of adesivos.entries()) {
    const nome = `${String(n + 1).padStart(2, "0")}.webp`;
    const { w, h } = await exportar(p, nome, false);
    lista.push({ id: `${id}-${n + 1}`, src: `fases/${id}/${nome}`, w, h });
  }

  if (DEBUG) await salvarDebug(id, px, W, H, fundo, [comodo, ...adesivos]);

  console.log(`  ${arquivo}: cômodo ${dimComodo.w}×${dimComodo.h}, ${lista.length} adesivos`);
  return {
    id,
    nome: config.nome ?? nomeBonito(arquivo),
    comodo: { src: `fases/${id}/comodo.webp`, ...dimComodo },
    adesivos: lista,
  };
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function vizinhoFundo(i: number, W: number, H: number, fundo: Uint8Array, mascara: Uint8Array) {
  const x = i % W;
  const y = (i / W) | 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (fundo[j] && !mascara[j]) return j;
    }
  return -1;
}

/** Dilatação quadrada separável (max-filter) de raio r. */
function dilatar(m: Uint8Array, W: number, H: number, r: number) {
  if (r <= 0) return m.slice();
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) {
        const nx = x + d;
        if (nx >= 0 && nx < W && m[y * W + nx]) v = 1;
      }
      tmp[y * W + x] = v;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) {
        const ny = y + d;
        if (ny >= 0 && ny < H && tmp[ny * W + x]) v = 1;
      }
      out[y * W + x] = v;
    }
  return out;
}

/** Fecha contornos abertos dentro da caixa da peça. */
function fecharContorno(p: Peca, W: number, H: number, raio: number) {
  const x0 = Math.max(0, p.minX - raio - 1);
  const y0 = Math.max(0, p.minY - raio - 1);
  const x1 = Math.min(W - 1, p.maxX + raio + 1);
  const y1 = Math.min(H - 1, p.maxY + raio + 1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const local = new Uint8Array(w * h);
  for (const i of p.pixels) {
    const x = i % W;
    const y = (i / W) | 0;
    local[(y - y0) * w + (x - x0)] = 1;
  }
  // Dilata (fecha as falhas do traço), preenche o miolo e só então erode de volta ao contorno.
  const dil = dilatar(local, w, h, raio);
  const global = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dil[y * w + x]) global[(y + y0) * W + x + x0] = 1;
  preencherBuracos(global, W, H, x0, y0, x1, y1);
  const inv = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inv[y * w + x] = global[(y + y0) * W + x + x0] ? 0 : 1;
  const ero = dilatar(inv, w, h, raio);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) global[(y + y0) * W + x + x0] = !ero[y * w + x] || local[y * w + x] ? 1 : 0;
  const pixels: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (!global[i]) continue;
      pixels.push(i);
      if (x < p.minX) p.minX = x;
      if (y < p.minY) p.minY = y;
      if (x > p.maxX) p.maxX = x;
      if (y > p.maxY) p.maxY = y;
    }
  p.pixels = pixels;
}

/** Marca como sólido tudo que não é alcançável a partir da borda da caixa (buracos internos). */
function preencherBuracos(m: Uint8Array, W: number, _H: number, x0: number, y0: number, x1: number, y1: number) {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const fora = new Uint8Array(w * h);
  const fila: number[] = [];
  const tentar = (x: number, y: number) => {
    const k = y * w + x;
    if (fora[k] || m[(y + y0) * W + x + x0]) return;
    fora[k] = 1;
    fila.push(k);
  };
  for (let x = 0; x < w; x++) {
    tentar(x, 0);
    tentar(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tentar(0, y);
    tentar(w - 1, y);
  }
  while (fila.length) {
    const k = fila.pop()!;
    const x = k % w;
    const y = (k / w) | 0;
    if (x > 0) tentar(x - 1, y);
    if (x < w - 1) tentar(x + 1, y);
    if (y > 0) tentar(x, y - 1);
    if (y < h - 1) tentar(x, y + 1);
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (!fora[y * w + x]) m[(y + y0) * W + x + x0] = 1;
}

/** Imagem de conferência: fundo removido em xadrez e caixas numeradas. */
async function salvarDebug(id: string, px: Buffer, W: number, H: number, fundo: Uint8Array, pecas: Peca[]) {
  await mkdir(PASTA_DEBUG, { recursive: true });
  const out = Buffer.from(px);
  for (let i = 0; i < W * H; i++)
    if (fundo[i]) {
      const x = i % W;
      const y = (i / W) | 0;
      const c = ((x >> 3) + (y >> 3)) % 2 ? 90 : 60;
      out[i * 4] = c;
      out[i * 4 + 1] = c + 30;
      out[i * 4 + 2] = c;
      out[i * 4 + 3] = 255;
    }
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${pecas
    .map(
      (p, n) =>
        `<rect x="${p.minX}" y="${p.minY}" width="${p.maxX - p.minX + 1}" height="${p.maxY - p.minY + 1}" fill="none" stroke="${n ? "#ff0055" : "#0066ff"}" stroke-width="1.5"/><text x="${p.minX + 2}" y="${p.minY + 12}" font-size="12" font-family="sans-serif" fill="#ff0055" stroke="white" stroke-width="3" paint-order="stroke">${n || "C"}</text>`,
    )
    .join("")}</svg>`;
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(path.join(PASTA_DEBUG, `${id}.png`));
}

async function main() {
  const arquivos = (await readdir(PASTA_FOLHAS))
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  if (!arquivos.length) throw new Error("Nenhuma imagem encontrada em folhas/");

  await rm(PASTA_SAIDA, { recursive: true, force: true });
  await mkdir(PASTA_SAIDA, { recursive: true });
  console.log(`Recortando ${arquivos.length} folha(s)…`);

  const fases: FaseManifest[] = [];
  for (const arquivo of arquivos) fases.push(await recortarFolha(arquivo));

  await writeFile(path.join(PASTA_SAIDA, "manifest.json"), JSON.stringify({ fases }, null, 2));
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
