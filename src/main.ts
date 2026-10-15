import "@fontsource/gaegu/latin-400.css";
import "@fontsource/gaegu/latin-700.css";
import "@fontsource/mali/latin-500.css";
import "@fontsource/mali/latin-600.css";
import "./estilo.css";
import { carregar, pronta, temTinta } from "./imagens.ts";
import { cenaSalva, faseSalva, salvarAgora, salvarCena, salvarFase } from "./estado.ts";
import { salvarFoto } from "./foto.ts";
import { desfazer, iniciarHistorico, podeDesfazer, podeRefazer, refazer, registrar } from "./historico.ts";
import type { AdesivoManifest, Colado, FaseManifest, Manifest } from "./tipos.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const elFases = $("fases");
const palco = $("palco");
const mundo = $("mundo");
const imgComodo = $<HTMLImageElement>("comodo");
const camadaColados = $("colados");
const dica = $("dica");
const ferramentas = $("ferramentas");
const paleta = $("paleta");
const trilho = $("paleta-trilho");
const dialogoLimpar = $<HTMLDialogElement>("dialogo-limpar");
const btnAproximar = $<HTMLButtonElement>("btn-aproximar");
const btnAfastar = $<HTMLButtonElement>("btn-afastar");
const btnVerTudo = $<HTMLButtonElement>("btn-ver-tudo");
const btnDesfazer = $<HTMLButtonElement>("btn-desfazer");
const btnRefazer = $<HTMLButtonElement>("btn-refazer");

const ZOOM_MAX = 4;
const PASSO_ZOOM = 1.5;
/** Faixa perto da borda do palco que puxa a vista ao arrastar um adesivo com zoom. */
const BORDA_ROLAGEM = 36;

const ESCALA_MIN = 0.35;
const ESCALA_MAX = 3;
const PASSO_ESCALA = 1.15;
/** Quanto o dedo precisa andar para virar arrasto (px de tela). */
const LIMIAR = 8;

let manifest: Manifest;
let fase: FaseManifest;
let porId = new Map<string, AdesivoManifest>();
let colados: Colado[] = [];
const elementos = new Map<string, HTMLElement>();
let selecionado: string | null = null;

// Transformação do mundo (pixels da folha) para o palco (pixels de tela).
let escalaMundo = 1;
let origemX = 0;
let origemY = 0;
/** Vista sem zoom: o cômodo inteiro cabendo no palco. */
const base = { s: 1, x: 0, y: 0 };
let zoom = 1;

// ---------------------------------------------------------------- utilidades

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function paraMundo(clientX: number, clientY: number) {
  const r = palco.getBoundingClientRect();
  return { x: (clientX - r.left - origemX) / escalaMundo, y: (clientY - r.top - origemY) / escalaMundo };
}

function sobreAPaleta(clientX: number, clientY: number) {
  const r = paleta.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

function aviso(texto: string) {
  document.querySelector(".aviso")?.remove();
  const el = document.createElement("div");
  el.className = "aviso";
  el.setAttribute("role", "status");
  el.textContent = texto;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

/** Fim de uma ação: salva no celular e vira um passo do desfazer. */
function guardar() {
  salvarCena(fase.id, colados);
  registrar(fase.id, colados);
  atualizarHistorico();
}

function atualizarHistorico() {
  btnDesfazer.disabled = !fase || !podeDesfazer(fase.id);
  btnRefazer.disabled = !fase || !podeRefazer(fase.id);
}

/** Troca todos os adesivos do cômodo pelos de um estado (desfazer/refazer). */
function restaurar(estado: Colado[]) {
  const manter = selecionado;
  colados = estado.filter((c) => porId.has(c.aid));
  camadaColados.replaceChildren();
  elementos.clear();
  selecionado = null;
  colados.forEach(criarElemento);
  selecionar(colados.some((c) => c.uid === manter) ? manter : null);
  salvarCena(fase.id, colados);
  atualizarHistorico();
}

function voltar() {
  if (arrasto || pinca) return;
  const estado = desfazer(fase.id);
  if (estado) restaurar(estado);
}

function avancar() {
  if (arrasto || pinca) return;
  const estado = refazer(fase.id);
  if (estado) restaurar(estado);
}

// ---------------------------------------------------------------- palco

/** Área do mundo visível sem zoom. A vista ampliada nunca sai dela. */
function areaBase() {
  return {
    minX: -base.x / base.s,
    minY: -base.y / base.s,
    maxX: (palco.clientWidth - base.x) / base.s,
    maxY: (palco.clientHeight - base.y) / base.s,
  };
}

function aplicarVista() {
  const a = areaBase();
  origemX = limitar(origemX, palco.clientWidth - a.maxX * escalaMundo, -a.minX * escalaMundo);
  origemY = limitar(origemY, palco.clientHeight - a.maxY * escalaMundo, -a.minY * escalaMundo);
  mundo.style.transform = `translate(${origemX}px, ${origemY}px) scale(${escalaMundo})`;
  const ampliado = zoom > 1.001;
  palco.classList.toggle("ampliado", ampliado);
  btnVerTudo.hidden = !ampliado;
  btnAfastar.disabled = !ampliado;
  btnAproximar.disabled = zoom >= ZOOM_MAX - 0.001;
}

/** Aproxima ou afasta mantendo parado o ponto (sx, sy) do palco. */
function zoomEm(sx: number, sy: number, novoZoom: number) {
  const wx = (sx - origemX) / escalaMundo;
  const wy = (sy - origemY) / escalaMundo;
  zoom = limitar(novoZoom, 1, ZOOM_MAX);
  escalaMundo = base.s * zoom;
  origemX = sx - wx * escalaMundo;
  origemY = sy - wy * escalaMundo;
  aplicarVista();
}

function verTudo() {
  zoom = 1;
  escalaMundo = base.s;
  origemX = base.x;
  origemY = base.y;
  aplicarVista();
}

function ajustarMundo() {
  if (!fase) return;
  const { w, h } = fase.comodo;
  const pw = palco.clientWidth;
  const ph = palco.clientHeight;
  // Ponto do mundo no centro da tela, para não perder o lugar quando a barra do navegador some ou aparece.
  const centroX = (pw / 2 - origemX) / escalaMundo;
  const centroY = (ph / 2 - origemY) / escalaMundo;
  const margem = Math.min(16, pw * 0.04);
  base.s = Math.max(0.1, Math.min((pw - margem * 2) / w, (ph - margem * 2) / h));
  base.x = (pw - w * base.s) / 2;
  base.y = (ph - h * base.s) / 2;
  mundo.style.width = `${w}px`;
  mundo.style.height = `${h}px`;
  if (zoom <= 1.001) {
    verTudo();
    return;
  }
  escalaMundo = base.s * zoom;
  origemX = pw / 2 - centroX * escalaMundo;
  origemY = ph / 2 - centroY * escalaMundo;
  aplicarVista();
}

new ResizeObserver(ajustarMundo).observe(palco);

/** Mantém o centro do adesivo dentro do palco (na vista sem zoom). */
function prenderNaTela(c: Colado) {
  const a = areaBase();
  c.x = limitar(c.x, a.minX + 6, a.maxX - 6);
  c.y = limitar(c.y, a.minY + 6, a.maxY - 6);
}

// ---------------------------------------------------------------- adesivos colados

function desenhar(c: Colado) {
  const el = elementos.get(c.uid);
  if (!el) return;
  el.style.setProperty("--x", String(c.x));
  el.style.setProperty("--y", String(c.y));
  el.style.setProperty("--s", String(c.escala));
  el.style.setProperty("--fx", c.espelhado ? "-1" : "1");
  el.style.zIndex = String(c.z);
  el.classList.toggle("fixo", !!c.fixo);
  if (c.uid === selecionado) atualizarFerramentas(c);
}

function atualizarFerramentas(c: Colado | undefined) {
  ferramentas.classList.toggle("fixo", !!c?.fixo);
  ferramentas.querySelector('[data-acao="fixar"]')?.setAttribute("aria-pressed", String(!!c?.fixo));
}

function criarElemento(c: Colado) {
  const a = porId.get(c.aid);
  if (!a) return;
  const el = document.createElement("div");
  el.className = "colado";
  el.style.width = `${a.w}px`;
  el.style.height = `${a.h}px`;
  const img = document.createElement("img");
  img.src = a.src;
  img.alt = "";
  img.draggable = false;
  el.append(img);
  camadaColados.append(el);
  elementos.set(c.uid, el);
  desenhar(c);
}

function proximoZ() {
  return colados.reduce((m, c) => Math.max(m, c.z), 0) + 1;
}

function trazerPraFrente(c: Colado) {
  if (colados.some((o) => o !== c && o.z >= c.z)) c.z = proximoZ();
  desenhar(c);
}

function selecionar(id: string | null) {
  if (selecionado) elementos.get(selecionado)?.classList.remove("selecionado");
  selecionado = id;
  if (id) elementos.get(id)?.classList.add("selecionado");
  ferramentas.hidden = !id;
  atualizarFerramentas(colados.find((c) => c.uid === id));
  atualizarDica();
}

function atualizarDica() {
  dica.hidden = colados.length > 0;
}

function colar(aid: string, x: number, y: number): Colado {
  const c: Colado = { uid: uid(), aid, x, y, escala: 1, espelhado: false, z: proximoZ() };
  colados.push(c);
  criarElemento(c);
  atualizarDica();
  return c;
}

function descolar(id: string) {
  const el = elementos.get(id);
  colados = colados.filter((c) => c.uid !== id);
  elementos.delete(id);
  if (selecionado === id) selecionar(null);
  if (el) {
    el.classList.add("saindo");
    setTimeout(() => el.remove(), 200);
  }
  atualizarDica();
  guardar();
}

/**
 * Qual adesivo está sob o dedo? Respeita a transparência e a ordem de empilhamento.
 * Peças fixas ficam "por baixo" do toque: um adesivo solto atrás delas ainda pode ser pego.
 */
function adesivoEm(wx: number, wy: number): Colado | undefined {
  const ordem = [...colados].sort((a, b) => b.z - a.z);
  return acertar(ordem.filter((c) => !c.fixo), wx, wy) ?? acertar(ordem.filter((c) => c.fixo), wx, wy);
}

function acertar(ordem: Colado[], wx: number, wy: number): Colado | undefined {
  for (const c of ordem) {
    const a = porId.get(c.aid);
    if (!a) continue;
    const lx = (wx - c.x) / (c.escala * (c.espelhado ? -1 : 1)) + a.w / 2;
    const ly = (wy - c.y) / c.escala + a.h / 2;
    if (lx < 0 || ly < 0 || lx >= a.w || ly >= a.h) continue;
    const im = pronta(a.src);
    if (!im || temTinta(im, lx, ly, Math.max(2, Math.round(4 / (c.escala * escalaMundo))))) return c;
  }
  return undefined;
}

// ---------------------------------------------------------------- gestos

interface Arrasto {
  pid: number;
  c: Colado;
  /** Camada antes de segurar: um toque sem arrastar não mexe na ordem. */
  z0: number;
  dx: number;
  dy: number;
  x0: number;
  y0: number;
  moveu: boolean;
}

interface Pinca {
  c: Colado;
  dist0: number;
  escala0: number;
}

interface Candidato {
  pid: number;
  aid: string;
  x0: number;
  y0: number;
}

/** Um dedo no vazio: toque desmarca; com zoom, arrastar move a vista. */
interface Vazio {
  pid: number;
  /** Peça fixa sob o dedo: um toque seleciona (para poder soltar). */
  fixo?: Colado;
  x0: number;
  y0: number;
  ox0: number;
  oy0: number;
  moveu: boolean;
}

/** Dois dedos fora de um adesivo: pinça aproxima/afasta e arrastar move a vista. */
interface PincaVista {
  dist0: number;
  zoom0: number;
  wx: number;
  wy: number;
}

const dedos = new Map<number, { x: number; y: number }>();
let arrasto: Arrasto | null = null;
let pinca: Pinca | null = null;
let candidato: Candidato | null = null;
let vazio: Vazio | null = null;
let pincaVista: PincaVista | null = null;
let ultimoPonteiro = { x: 0, y: 0 };
let rolagem = 0;

function distanciaDedos() {
  const [a, b] = [...dedos.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

/** Ponto médio dos dois dedos, em coordenadas do palco. */
function meioDedos() {
  const [a, b] = [...dedos.values()];
  const r = palco.getBoundingClientRect();
  return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
}

/** Com zoom, segurar um adesivo perto da borda do palco vai revelando o resto do cômodo. */
function rolarNaBorda() {
  rolagem = 0;
  if (!arrasto || zoom <= 1.001) return;
  const r = palco.getBoundingClientRect();
  const { x, y } = ultimoPonteiro;
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
  const forca = (d: number) => (d < BORDA_ROLAGEM ? ((BORDA_ROLAGEM - d) / BORDA_ROLAGEM) * 9 : 0);
  const vx = forca(x - r.left) - forca(r.right - x);
  const vy = forca(y - r.top) - forca(r.bottom - y);
  if (!vx && !vy) return;
  const antesX = origemX;
  const antesY = origemY;
  origemX += vx;
  origemY += vy;
  aplicarVista();
  if (origemX === antesX && origemY === antesY) return;
  const p = paraMundo(x, y);
  arrasto.c.x = p.x + arrasto.dx;
  arrasto.c.y = p.y + arrasto.dy;
  desenhar(arrasto.c);
  rolagem = requestAnimationFrame(rolarNaBorda);
}

function iniciarArrasto(pid: number, c: Colado, clientX: number, clientY: number, x0 = clientX, y0 = clientY) {
  const p = paraMundo(clientX, clientY);
  arrasto = { pid, c, z0: c.z, dx: c.x - p.x, dy: c.y - p.y, x0, y0, moveu: false };
  trazerPraFrente(c);
  selecionar(c.uid);
  elementos.get(c.uid)?.classList.add("segurando");
  palco.classList.add("arrastando");
}

function moverArrasto(clientX: number, clientY: number) {
  if (!arrasto) return;
  if (!arrasto.moveu && Math.hypot(clientX - arrasto.x0, clientY - arrasto.y0) < LIMIAR) return;
  arrasto.moveu = true;
  const p = paraMundo(clientX, clientY);
  arrasto.c.x = p.x + arrasto.dx;
  arrasto.c.y = p.y + arrasto.dy;
  desenhar(arrasto.c);
  paleta.classList.toggle("alvo", sobreAPaleta(clientX, clientY));
  ultimoPonteiro = { x: clientX, y: clientY };
  if (!rolagem) rolagem = requestAnimationFrame(rolarNaBorda);
}

function terminarArrasto(clientX: number, clientY: number) {
  if (!arrasto) return;
  const { c, moveu, z0 } = arrasto;
  elementos.get(c.uid)?.classList.remove("segurando");
  paleta.classList.remove("alvo");
  palco.classList.remove("arrastando");
  arrasto = null;
  cancelAnimationFrame(rolagem);
  rolagem = 0;
  if (!moveu) {
    // Só um toque: seleciona, sem virar passo do desfazer.
    c.z = z0;
    desenhar(c);
    return;
  }
  if (sobreAPaleta(clientX, clientY)) {
    descolar(c.uid);
    return;
  }
  prenderNaTela(c);
  desenhar(c);
  guardar();
}

palco.addEventListener("pointerdown", (e) => {
  if ((e.target as HTMLElement).closest(".ferramentas, .acoes, .zoom")) return;
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (dedos.size === 2) {
    if (arrasto) {
      // Primeiro dedo em cima de um adesivo: a pinça muda o tamanho dele.
      const { c } = arrasto;
      pinca = { c, dist0: distanciaDedos(), escala0: c.escala };
      elementos.get(c.uid)?.classList.remove("segurando");
      palco.classList.remove("arrastando");
      arrasto = null;
    } else {
      // Pinça no vazio: zoom na vista, sem perder o adesivo selecionado.
      const m = meioDedos();
      pincaVista = {
        dist0: distanciaDedos(),
        zoom0: zoom,
        wx: (m.x - origemX) / escalaMundo,
        wy: (m.y - origemY) / escalaMundo,
      };
      vazio = null;
    }
    return;
  }
  if (dedos.size > 2) return;

  const p = paraMundo(e.clientX, e.clientY);
  const c = adesivoEm(p.x, p.y);
  if (c && !c.fixo) iniciarArrasto(e.pointerId, c, e.clientX, e.clientY);
  else vazio = { pid: e.pointerId, fixo: c, x0: e.clientX, y0: e.clientY, ox0: origemX, oy0: origemY, moveu: false };
});

palco.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = palco.getBoundingClientRect();
    zoomEm(e.clientX - r.left, e.clientY - r.top, zoom * Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);

trilho.addEventListener("pointerdown", (e) => {
  const fig = (e.target as HTMLElement).closest<HTMLElement>(".figurinha");
  if (!fig || arrasto) return;
  candidato = { pid: e.pointerId, aid: fig.dataset.aid!, x0: e.clientX, y0: e.clientY };
});

window.addEventListener("pointermove", (e) => {
  if (dedos.has(e.pointerId)) dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pinca && dedos.size >= 2) {
    pinca.c.escala = limitar((pinca.escala0 * distanciaDedos()) / pinca.dist0, ESCALA_MIN, ESCALA_MAX);
    desenhar(pinca.c);
    return;
  }

  if (pincaVista && dedos.size >= 2) {
    const m = meioDedos();
    zoom = limitar((pincaVista.zoom0 * distanciaDedos()) / pincaVista.dist0, 1, ZOOM_MAX);
    escalaMundo = base.s * zoom;
    origemX = m.x - pincaVista.wx * escalaMundo;
    origemY = m.y - pincaVista.wy * escalaMundo;
    aplicarVista();
    return;
  }

  if (vazio && e.pointerId === vazio.pid) {
    const dx = e.clientX - vazio.x0;
    const dy = e.clientY - vazio.y0;
    if (!vazio.moveu && Math.hypot(dx, dy) >= LIMIAR) vazio.moveu = true;
    if (vazio.moveu && zoom > 1.001) {
      origemX = vazio.ox0 + dx;
      origemY = vazio.oy0 + dy;
      aplicarVista();
    }
    return;
  }

  if (candidato && e.pointerId === candidato.pid) {
    const dx = e.clientX - candidato.x0;
    const dy = e.clientY - candidato.y0;
    // Puxar para cima descola o adesivo da cartela; andar para o lado rola a cartela.
    if (Math.hypot(dx, dy) >= LIMIAR && -dy > Math.abs(dx) * 0.8) {
      const a = porId.get(candidato.aid);
      if (a) {
        const p = paraMundo(e.clientX, e.clientY);
        // O dedo segura a parte de baixo do adesivo, para dar para ver onde vai colar.
        const c = colar(a.id, p.x, p.y - a.h * 0.3);
        iniciarArrasto(e.pointerId, c, e.clientX, e.clientY, candidato.x0, candidato.y0);
        arrasto!.moveu = true;
        dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      candidato = null;
    } else if (Math.abs(dx) > LIMIAR * 1.5) {
      candidato = null;
    }
  }

  if (arrasto && e.pointerId === arrasto.pid) moverArrasto(e.clientX, e.clientY);
});

function soltar(e: PointerEvent) {
  dedos.delete(e.pointerId);

  if (candidato && e.pointerId === candidato.pid) {
    // Toque simples na cartela: cola no meio do que está à vista.
    if (e.type === "pointerup") {
      let x = fase.comodo.w / 2;
      let y = fase.comodo.h * 0.6;
      if (zoom > 1.001) {
        const r = palco.getBoundingClientRect();
        ({ x, y } = paraMundo(r.left + r.width / 2, r.top + r.height / 2));
      }
      const espalhar = 40 / zoom;
      const c = colar(candidato.aid, x + (Math.random() - 0.5) * espalhar, y + (Math.random() - 0.5) * espalhar * 0.75);
      selecionar(c.uid);
      guardar();
    }
    candidato = null;
    return;
  }

  if (pinca) {
    if (dedos.size < 2) {
      guardar();
      pinca = null;
    }
    return;
  }

  if (pincaVista) {
    if (dedos.size < 2) pincaVista = null;
    return;
  }

  if (vazio && e.pointerId === vazio.pid) {
    if (!vazio.moveu && e.type === "pointerup") selecionar(vazio.fixo?.uid ?? null);
    else if (vazio.moveu && vazio.fixo && zoom <= 1.001 && e.type === "pointerup") {
      selecionar(vazio.fixo.uid);
      aviso("Peça fixa: toque em Soltar para mover");
    }
    vazio = null;
    return;
  }

  if (arrasto && e.pointerId === arrasto.pid) terminarArrasto(e.clientX, e.clientY);
}

window.addEventListener("pointerup", soltar);
window.addEventListener("pointercancel", soltar);

// ---------------------------------------------------------------- ferramentas

ferramentas.addEventListener("click", (e) => {
  const botao = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-acao]");
  const c = colados.find((o) => o.uid === selecionado);
  if (!botao || !c) return;
  if (c.fixo && botao.hasAttribute("data-so-solto")) return;
  switch (botao.dataset.acao) {
    case "fixar":
      c.fixo = !c.fixo || undefined;
      aviso(c.fixo ? "Peça fixada" : "Peça solta");
      break;
    case "espelhar":
      c.espelhado = !c.espelhado;
      break;
    case "menor":
      c.escala = limitar(c.escala / PASSO_ESCALA, ESCALA_MIN, ESCALA_MAX);
      break;
    case "maior":
      c.escala = limitar(c.escala * PASSO_ESCALA, ESCALA_MIN, ESCALA_MAX);
      break;
    case "tras": {
      const menor = colados.reduce((m, o) => Math.min(m, o.z), Infinity);
      c.z = menor - 1;
      // Normaliza para manter os z positivos e pequenos.
      // Peças fixas atrás das soltas continuam atrás: a ordem relativa delas é mantida.
      [...colados].sort((a, b) => a.z - b.z).forEach((o, i) => {
        o.z = i + 1;
        desenhar(o);
      });
      break;
    }
    case "tirar":
      descolar(c.uid);
      return;
  }
  desenhar(c);
  guardar();
});

// ---------------------------------------------------------------- fases

function montarAbas() {
  elFases.replaceChildren(
    ...manifest.fases.map((f, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fita";
      b.setAttribute("role", "tab");
      b.dataset.fase = f.id;
      b.innerHTML = `<b>Fase ${i + 1}</b><small></small>`;
      b.querySelector("small")!.textContent = f.nome;
      b.addEventListener("click", () => abrirFase(f.id));
      return b;
    }),
  );
}

function montarPaleta() {
  trilho.replaceChildren(
    ...fase.adesivos.map((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "figurinha";
      b.dataset.aid = a.id;
      b.setAttribute("aria-label", "Colar adesivo");
      const img = document.createElement("img");
      img.src = a.src;
      img.alt = "";
      img.draggable = false;
      img.loading = "lazy";
      b.append(img);
      return b;
    }),
  );
  trilho.scrollLeft = 0;
}

async function abrirFase(id: string) {
  const nova = manifest.fases.find((f) => f.id === id) ?? manifest.fases[0];
  if (fase && nova.id === fase.id) return;
  if (fase) salvarAgora();

  arrasto = null;
  pinca = null;
  candidato = null;
  vazio = null;
  pincaVista = null;
  palco.classList.remove("arrastando");
  fase = nova;
  zoom = 1;
  porId = new Map(fase.adesivos.map((a) => [a.id, a]));
  salvarFase(fase.id);

  for (const b of elFases.querySelectorAll<HTMLElement>(".fita")) {
    const ativa = b.dataset.fase === fase.id;
    b.setAttribute("aria-selected", String(ativa));
    if (ativa) b.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  imgComodo.src = fase.comodo.src;
  imgComodo.width = fase.comodo.w;
  imgComodo.height = fase.comodo.h;
  ajustarMundo();

  camadaColados.replaceChildren();
  elementos.clear();
  selecionado = null;
  ferramentas.hidden = true;
  colados = cenaSalva(fase.id).filter((c) => porId.has(c.aid));
  colados.forEach(criarElemento);
  iniciarHistorico(fase.id, colados);
  atualizarHistorico();
  atualizarDica();
  montarPaleta();

  // Máscaras de transparência para o toque preciso.
  fase.adesivos.forEach((a) => carregar(a.src).catch(() => undefined));
}

// ---------------------------------------------------------------- zoom

/** Os botões aproximam no adesivo selecionado (se estiver à vista) ou no centro do palco. */
function focoDoZoom() {
  const c = colados.find((o) => o.uid === selecionado);
  if (c) {
    const sx = origemX + c.x * escalaMundo;
    const sy = origemY + c.y * escalaMundo;
    if (sx >= 0 && sy >= 0 && sx <= palco.clientWidth && sy <= palco.clientHeight) return [sx, sy] as const;
  }
  return [palco.clientWidth / 2, palco.clientHeight / 2] as const;
}
btnAproximar.addEventListener("click", () => zoomEm(...focoDoZoom(), zoom * PASSO_ZOOM));
btnAfastar.addEventListener("click", () => zoomEm(...focoDoZoom(), zoom / PASSO_ZOOM));
btnVerTudo.addEventListener("click", verTudo);

// ---------------------------------------------------------------- desfazer / refazer

btnDesfazer.addEventListener("click", voltar);
btnRefazer.addEventListener("click", avancar);
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const tecla = e.key.toLowerCase();
  if (tecla === "z" && !e.shiftKey) voltar();
  else if ((tecla === "z" && e.shiftKey) || tecla === "y") avancar();
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- topo

$("btn-limpar").addEventListener("click", () => {
  if (!colados.length) {
    aviso("Este cômodo já está vazio");
    return;
  }
  dialogoLimpar.returnValue = "";
  dialogoLimpar.showModal();
});

dialogoLimpar.addEventListener("close", () => {
  if (dialogoLimpar.returnValue !== "sim") return;
  colados = [];
  camadaColados.replaceChildren();
  elementos.clear();
  selecionar(null);
  guardar();
});

$("btn-foto").addEventListener("click", async () => {
  selecionar(null);
  try {
    const r = await salvarFoto(fase, colados, porId);
    if (r === "baixada") aviso("Foto salva");
  } catch {
    aviso("Não deu para gerar a foto agora");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") salvarAgora();
});

// Bloqueia o zoom por gesto do iOS, que ignora user-scalable.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------------------------------------------------------------- início

if (import.meta.env.VITE_CANAL === "teste") {
  document.title = `Teste · ${document.title}`;
  const selo = document.createElement("div");
  selo.className = "selo-teste";
  selo.textContent = "versão de teste";
  document.body.append(selo);
}

async function iniciar() {
  try {
    const resposta = await fetch("fases/manifest.json", { cache: "no-cache" });
    if (!resposta.ok) throw new Error(String(resposta.status));
    manifest = (await resposta.json()) as Manifest;
    if (!manifest.fases.length) throw new Error("sem fases");
  } catch {
    document.getElementById("app")!.innerHTML =
      '<p class="erro">Não encontrei as fases. Confira se há imagens na pasta <b>folhas/</b> e rode o recorte de novo.</p>';
    return;
  }
  montarAbas();
  await abrirFase(faseSalva() ?? manifest.fases[0].id);
}

iniciar();
