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
 * Uma folha pode ter várias fases (`fases`) e áreas separadas de adesivos (`extras`).
 * Todas as coordenadas são em pixels da imagem original.
 */
import sharp from "sharp";
import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AdesivoManifest, FaseManifest } from "../src/tipos.ts";

type Retangulo = [x: number, y: number, w: number, h: number];

/** Opções que valem para uma área de recorte. */
interface ConfigRecorte {
  /** Recorta só dentro deste retângulo; o fundo é lido a partir das bordas dele. */
  area?: Retangulo;
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
  /**
   * Bordas da imagem que contam como parede ao fechar (para cômodos cortados pela folha).
   * Ex.: ["cima"] quando o topo do cômodo encosta no topo da imagem.
   */
  bordaFecha?: ("cima" | "baixo" | "esquerda" | "direita")[];
  /**
   * Separa itens que se encostam: cada polígono [x1, y1, x2, y2, …] vira uma peça própria
   * com tudo o que estiver dentro dele.
   */
  separar?: number[][];
  /**
   * Peças traçadas à mão: tudo dentro de cada polígono [x1, y1, x2, y2, …] vira uma peça,
   * até o que parecia fundo. Para tapetes e peças da mesma cor do fundo da folha.
   */
  formas?: number[][];
  /** Remove a peça que contém cada ponto [x, y] (repetidos, enfeites da folha…). */
  remover?: [x: number, y: number][];
  /** Diferença de cor aceita ao "andar" pelo fundo (padrão 30). */
  tolerancia?: number;
  /** Distância em px para considerar duas partes como o mesmo adesivo (padrão 3). */
  juntarAte?: number;
  /**
   * Fundo de cor única (branco liso): a referência de cor não acompanha degradês.
   * Use em folhas com traço borrado, onde o recorte "come" peças claras.
   */
  fundoFixo?: boolean;
  /**
   * Desliga a regra que deixa qualquer branco/cinza claro virar fundo. Use quando há
   * adesivos brancos sobre fundo claro colorido (o branco deles não pode "vazar").
   */
  brancoNaoEFundo?: boolean;
  /** Área mínima em px para virar adesivo (padrão 120). */
  areaMinima?: number;
  /**
   * Também tira o fundo de "janelas" fechadas (vão de estante, cerca, alça), desde que tenham
   * quase exatamente a cor média do fundo e pelo menos este tanto de px.
   */
  vazarFuros?: number;
  /**
   * Descarta peças que são só traço fino (sombras e contornos soltos de adesivos recortados):
   * some a peça que desaparece ao "afinar" este tanto de px.
   */
  descartarTracos?: number;
}

/** Uma fase: cômodo + adesivos. */
interface ConfigFase extends ConfigRecorte {
  /** Nome exibido no botão da fase. */
  nome?: string;
  /** Para folhas com várias fases: final do id da fase (padrão: 1, 2, 3…). */
  sufixo?: string;
  /** Força a região do cômodo, caso a maior peça não seja ele. */
  comodo?: Retangulo;
  /** Cômodo desenhado de frente e encostado nas bordas: usa este retângulo inteiro como cômodo. */
  comodoRetangulo?: Retangulo;
  /** Outras áreas da folha (com fundo próprio) cujas peças viram adesivos desta fase. */
  extras?: ConfigRecorte[];
}

/** Arquivo `folhas/<nome>.json`: uma fase, ou várias em `fases`. */
interface ConfigFolha extends ConfigFase {
  fases?: ConfigFase[];
  /**
   * Cobre logotipos e marcas d'água antes de tudo: cada [x, y, w, h, dx, dy] copia por cima
   * do retângulo os pixels que estão deslocados (dx, dy) dele.
   */
  remendar?: [x: number, y: number, w: number, h: number, dx: number, dy: number][];
}

interface Peca {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: number[];
}

interface Imagem {
  px: Buffer;
  W: number;
  H: number;
}

interface Analise {
  pecas: Peca[];
  fundo: Uint8Array;
  ref: Float32Array;
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

/** Remove o fundo e separa as peças de uma área da folha. */
function analisar({ px, W, H }: Imagem, config: ConfigRecorte): Analise {
  const N = W * H;
  const tolerancia = config.tolerancia ?? 30;
  const juntarAte = config.juntarAte ?? 3;
  const fundoFixo = config.fundoFixo ?? false;
  const areaMinima = config.areaMinima ?? 120;
  const [ax, ay, aw, ah] = config.area ?? [0, 0, W, H];
  const ax0 = Math.max(0, ax);
  const ay0 = Math.max(0, ay);
  const ax1 = Math.min(W, ax + aw) - 1;
  const ay1 = Math.min(H, ay + ah) - 1;

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
  // Fora da área não existe nada para recortar.
  if (config.area)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (x < ax0 || x > ax1 || y < ay0 || y > ay1) fundo[y * W + x] = 1;
  const semear = (i: number) => {
    if (fundo[i]) return;
    fundo[i] = 1;
    ref[i * 3] = px[i * 4];
    ref[i * 3 + 1] = px[i * 4 + 1];
    ref[i * 3 + 2] = px[i * 4 + 2];
    fila[fim++] = i;
  };
  for (let x = ax0; x <= ax1; x++) {
    semear(ay0 * W + x);
    semear(ay1 * W + x);
  }
  for (let y = ay0; y <= ay1; y++) {
    semear(y * W + ax0);
    semear(y * W + ax1);
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
      const passoSuave =
        !fundoFixo && dist(r, g, b, pr, pg, pb) <= tolerancia * 0.5 && dist(r, g, b, rr, rg, rb) <= tolerancia * 1.6;
      const viraNeutro = !config.brancoNaoEFundo && neutroClaro(r, g, b) && neutroClaro(pr, pg, pb);
      if (pertoRef || passoSuave || viraNeutro) {
        fundo[j] = 1;
        const peso = fundoFixo ? 0 : 0.15;
        ref[j * 3] = rr * (1 - peso) + r * peso;
        ref[j * 3 + 1] = rg * (1 - peso) + g * peso;
        ref[j * 3 + 2] = rb * (1 - peso) + b * peso;
        fila[fim++] = j;
      }
    }
  }

  // Vãos fechados com a cor do fundo também são fundo.
  if (config.vazarFuros) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let i = 0; i < N; i++)
      if (fundo[i] && !ignorado[i] && (i % W) >= ax0 && (i % W) <= ax1 && ((i / W) | 0) >= ay0 && ((i / W) | 0) <= ay1) {
        sr += px[i * 4];
        sg += px[i * 4 + 1];
        sb += px[i * 4 + 2];
        n++;
      }
    const [mr, mg, mb] = [sr / n, sg / n, sb / n];
    const cor = new Uint8Array(N);
    for (let i = 0; i < N; i++)
      if (!fundo[i] && dist(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], mr, mg, mb) <= 14) cor[i] = 1;
    const visto = new Uint8Array(N);
    for (let s = 0; s < N; s++) {
      if (!cor[s] || visto[s]) continue;
      const grupo = [s];
      visto[s] = 1;
      for (let k = 0; k < grupo.length; k++) {
        const i = grupo[k];
        const x = i % W;
        const y = (i / W) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
          if (j >= 0 && cor[j] && !visto[j]) {
            visto[j] = 1;
            grupo.push(j);
          }
      }
      if (grupo.length >= config.vazarFuros)
        for (const i of grupo) {
          fundo[i] = 1;
          ref[i * 3] = mr;
          ref[i * 3 + 1] = mg;
          ref[i * 3 + 2] = mb;
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
    // A dilatação pode alcançar fora da área; só conta o que tem desenho.
    if (peca.pixels.length) pecas.push(peca);
  }
  // Separações manuais por polígono.
  const tocadas = new Set<Peca>();
  for (const poligono of config.separar ?? []) {
    const nova: Peca = { minX: W, minY: H, maxX: 0, maxY: 0, pixels: [] };
    for (const p of pecas) {
      const ficam: number[] = [];
      for (const i of p.pixels) {
        if (dentroDoPoligono((i % W) + 0.5, ((i / W) | 0) + 0.5, poligono)) nova.pixels.push(i);
        else ficam.push(i);
      }
      if (ficam.length !== p.pixels.length) {
        recalcularCaixa(p, ficam, W);
        tocadas.add(p);
      }
    }
    pecas = pecas.filter((p) => p.pixels.length > 0);
    if (nova.pixels.length) {
      recalcularCaixa(nova, nova.pixels, W);
      pecas.push(nova);
      tocadas.add(nova);
    }
  }
  // O corte deixa lascas soltas da peça vizinha; tira os fragmentos pequenos.
  for (const p of tocadas) if (p.pixels.length) removerLascas(p, W, H);

  // Peças traçadas à mão: o polígono inteiro, inclusive pixels que pareciam fundo.
  for (const poligono of config.formas ?? []) {
    const xs = poligono.filter((_, k) => k % 2 === 0);
    const ys = poligono.filter((_, k) => k % 2 === 1);
    const dentro = new Set<number>();
    for (let y = Math.max(ay0, Math.floor(Math.min(...ys))); y <= Math.min(ay1, Math.ceil(Math.max(...ys))); y++)
      for (let x = Math.max(ax0, Math.floor(Math.min(...xs))); x <= Math.min(ax1, Math.ceil(Math.max(...xs))); x++)
        if (dentroDoPoligono(x + 0.5, y + 0.5, poligono)) dentro.add(y * W + x);
    for (const p of pecas) {
      const ficam = p.pixels.filter((i) => !dentro.has(i));
      if (ficam.length !== p.pixels.length) recalcularCaixa(p, ficam, W);
    }
    pecas = pecas.filter((p) => p.pixels.length > 0);
    const forma: Peca = { minX: W, minY: H, maxX: 0, maxY: 0, pixels: [] };
    recalcularCaixa(forma, [...dentro], W);
    if (forma.pixels.length) pecas.push(forma);
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
    if (peca) fecharContorno(peca, W, H, raio ?? 4, config.bordaFecha ?? []);
  }
  // Fragmentos pequenos (sujeira, traços soltos) só entram se foram unidos a algo acima.
  pecas = pecas.filter((p) => p.pixels.length >= areaMinima);
  if (config.descartarTracos) pecas = pecas.filter((p) => temCorpo(p, W, config.descartarTracos!));
  // Com vãos vazados, sobram pontinhos da estampa do fundo soltos dentro das peças.
  if (config.vazarFuros) for (const p of pecas) removerLascas(p, W, H);

  return { pecas, fundo, ref };
}

const porPosicao = (a: Peca, b: Peca) => a.minY - b.minY || a.minX - b.minX;

/** Grava a peça como WebP transparente; devolve tamanho e uma assinatura dos pixels. */
async function exportar(
  { px, W, H }: Imagem,
  { fundo, ref }: Pick<Analise, "fundo" | "ref">,
  p: Peca,
  destino: string,
  preencherInterior: boolean,
) {
  const N = W * H;
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
    .toFile(destino);
  return { w, h, assinatura: assinar(out, w, h) };
}

/** Cômodo desenhado de frente: o retângulo inteiro, sem tirar fundo. */
async function exportarRetangulo({ px, W, H }: Imagem, [rx, ry, rw, rh]: Retangulo, destino: string) {
  const x0 = Math.max(0, rx);
  const y0 = Math.max(0, ry);
  const w = Math.min(W, rx + rw) - x0;
  const h = Math.min(H, ry + rh) - y0;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) px.copy(out, y * w * 4, ((y + y0) * W + x0) * 4, ((y + y0) * W + x0 + w) * 4);
  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 92 })
    .toFile(destino);
  return { w, h, assinatura: assinar(out, w, h) };
}

const assinar = (pixels: Buffer, w: number, h: number) =>
  createHash("sha1").update(`${w}x${h}:`).update(pixels).digest("hex").slice(0, 16);

async function recortarFase(img: Imagem, config: ConfigFase, id: string, nome: string, rotulo: string) {
  const pastaFase = path.join(PASTA_SAIDA, id);
  await mkdir(pastaFase, { recursive: true });
  const destinoComodo = path.join(pastaFase, "comodo.webp");

  let comodo: Awaited<ReturnType<typeof exportar>>;
  const grupos: { analise: Analise; pecas: Peca[] }[] = [];
  const pecasDebug: Peca[] = [];

  if (config.comodoRetangulo) {
    comodo = await exportarRetangulo(img, config.comodoRetangulo, destinoComodo);
    // O resto da folha (fora do cômodo) é a cartela de adesivos.
    const analise = analisar(img, { ...config, ignorar: [...(config.ignorar ?? []), config.comodoRetangulo] });
    grupos.push({ analise, pecas: analise.pecas.sort(porPosicao) });
    const [x, y, w, h] = config.comodoRetangulo;
    pecasDebug.push({ minX: x, minY: y, maxX: x + w - 1, maxY: y + h - 1, pixels: [] });
  } else {
    const analise = analisar(img, config);
    const { pecas } = analise;
    // Cômodo = maior peça (ou a indicada na config).
    const areaCaixa = (p: Peca) => (p.maxX - p.minX + 1) * (p.maxY - p.minY + 1);
    let principal: Peca;
    if (config.comodo) {
      const [cx, cy, cw, ch] = config.comodo;
      const sobreposicao = (q: Peca) =>
        Math.max(0, Math.min(q.maxX, cx + cw) - Math.max(q.minX, cx)) *
        Math.max(0, Math.min(q.maxY, cy + ch) - Math.max(q.minY, cy));
      principal = pecas.reduce((melhor, p) => (sobreposicao(p) > sobreposicao(melhor) ? p : melhor));
    } else {
      principal = pecas.reduce((a, b) => (areaCaixa(b) > areaCaixa(a) ? b : a));
    }
    comodo = await exportar(img, analise, principal, destinoComodo, true);
    grupos.push({ analise, pecas: pecas.filter((p) => p !== principal).sort(porPosicao) });
    pecasDebug.push(principal);
  }

  for (const extra of config.extras ?? []) {
    const analise = analisar(img, extra);
    grupos.push({ analise, pecas: analise.pecas.sort(porPosicao) });
  }

  const lista: AdesivoManifest[] = [];
  for (const { analise, pecas } of grupos)
    for (const p of pecas) {
      const n = lista.length + 1;
      const arquivo = `${String(n).padStart(2, "0")}.webp`;
      const { w, h, assinatura } = await exportar(img, analise, p, path.join(pastaFase, arquivo), false);
      lista.push({ id: `${id}-${n}`, src: `fases/${id}/${arquivo}`, w, h, assinatura });
      if (DEBUG) console.log(`    ${arquivo}: x ${p.minX}–${p.maxX}, y ${p.minY}–${p.maxY}`);
      pecasDebug.push(p);
    }

  if (DEBUG) await salvarDebug(id, img, grupos[0].analise.fundo, pecasDebug);

  console.log(`  ${rotulo}: cômodo ${comodo.w}×${comodo.h}, ${lista.length} adesivos`);
  const fase: FaseManifest = {
    id,
    nome,
    comodo: { src: `fases/${id}/comodo.webp`, w: comodo.w, h: comodo.h, assinatura: comodo.assinatura },
    adesivos: lista,
  };
  return fase;
}

async function recortarFolha(arquivo: string): Promise<FaseManifest[]> {
  const caminho = path.join(PASTA_FOLHAS, arquivo);
  const caminhoConfig = caminho.replace(/\.[^.]+$/, ".json");
  const config: ConfigFolha = existsSync(caminhoConfig) ? JSON.parse(await readFile(caminhoConfig, "utf8")) : {};

  const { data: px, info } = await sharp(caminho)
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const img: Imagem = { px, W: info.width, H: info.height };
  for (const [x, y, w, h, dx, dy] of config.remendar ?? [])
    for (let yy = Math.max(0, y); yy < Math.min(img.H, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(img.W, x + w); xx++) {
        const de = ((yy + dy) * img.W + xx + dx) * 4;
        px.copy(px, (yy * img.W + xx) * 4, de, de + 4);
      }
  const base = slug(arquivo);

  if (!config.fases?.length) return [await recortarFase(img, config, base, config.nome ?? nomeBonito(arquivo), arquivo)];

  const fases: FaseManifest[] = [];
  for (const [i, f] of config.fases.entries()) {
    const id = `${base}-${slug(f.sufixo ?? String(i + 1))}`;
    const nome = f.nome ?? `${nomeBonito(arquivo)} ${i + 1}`;
    fases.push(await recortarFase(img, f, id, nome, `${arquivo} [${i + 1}]`));
  }
  return fases;
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

function dentroDoPoligono(x: number, y: number, pts: number[]) {
  let dentro = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** A peça continua existindo depois de afinada `raio` px? (Traços finos somem.) */
function temCorpo(p: Peca, W: number, raio: number) {
  const w = p.maxX - p.minX + 1;
  const h = p.maxY - p.minY + 1;
  const fora = new Uint8Array(w * h).fill(1);
  for (const i of p.pixels) fora[(((i / W) | 0) - p.minY) * w + (i % W) - p.minX] = 0;
  const foraDilatado = dilatar(fora, w, h, raio);
  for (let y = raio; y < h - raio; y++) for (let x = raio; x < w - raio; x++) if (!foraDilatado[y * w + x]) return true;
  return false;
}

/** Mantém só os pedaços conectados que têm pelo menos 6% do tamanho do maior. */
function removerLascas(p: Peca, W: number, H: number) {
  const marca = new Set(p.pixels);
  const visto = new Set<number>();
  const grupos: number[][] = [];
  for (const s of p.pixels) {
    if (visto.has(s)) continue;
    const grupo: number[] = [];
    const pilha = [s];
    visto.add(s);
    while (pilha.length) {
      const i = pilha.pop()!;
      grupo.push(i);
      const x = i % W;
      const y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (marca.has(j) && !visto.has(j)) {
            visto.add(j);
            pilha.push(j);
          }
        }
    }
    grupos.push(grupo);
  }
  const maior = Math.max(...grupos.map((g) => g.length));
  recalcularCaixa(p, grupos.filter((g) => g.length >= maior * 0.06).flat(), W);
}

function recalcularCaixa(p: Peca, pixels: number[], W: number) {
  p.pixels = pixels;
  p.minX = p.minY = Infinity;
  p.maxX = p.maxY = -Infinity;
  for (const i of pixels) {
    const x = i % W;
    const y = (i / W) | 0;
    if (x < p.minX) p.minX = x;
    if (y < p.minY) p.minY = y;
    if (x > p.maxX) p.maxX = x;
    if (y > p.maxY) p.maxY = y;
  }
}

/** Fecha contornos abertos dentro da caixa da peça. */
function fecharContorno(p: Peca, W: number, H: number, raio: number, bordaFecha: NonNullable<ConfigRecorte["bordaFecha"]>) {
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
  preencherBuracos(global, W, H, x0, y0, x1, y1, bordaFecha);
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
function preencherBuracos(
  m: Uint8Array,
  W: number,
  H: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bordaFecha: NonNullable<ConfigRecorte["bordaFecha"]> = [],
) {
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
  // Uma borda da caixa que coincide com uma borda da imagem marcada em `bordaFecha` não deixa o "fora" entrar.
  const cima = y0 === 0 && bordaFecha.includes("cima");
  const baixo = y1 === H - 1 && bordaFecha.includes("baixo");
  const esquerda = x0 === 0 && bordaFecha.includes("esquerda");
  const direita = x1 === W - 1 && bordaFecha.includes("direita");
  for (let x = 0; x < w; x++) {
    if (!cima) tentar(x, 0);
    if (!baixo) tentar(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    if (!esquerda) tentar(0, y);
    if (!direita) tentar(w - 1, y);
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
async function salvarDebug(id: string, { px, W, H }: Imagem, fundo: Uint8Array, pecas: Peca[]) {
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
  for (const arquivo of arquivos) fases.push(...(await recortarFolha(arquivo)));

  await writeFile(path.join(PASTA_SAIDA, "manifest.json"), JSON.stringify({ fases }, null, 2));
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
