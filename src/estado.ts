import type { Colado } from "./tipos.ts";

/** Tudo fica salvo no próprio navegador do celular. */
const CHAVE = "adesivos-line:v1";

interface Salvo {
  faseAtual?: string;
  cenas: Record<string, Colado[]>;
}

function ler(): Salvo {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) {
      const dados = JSON.parse(bruto) as Salvo;
      if (dados && typeof dados === "object" && dados.cenas) return dados;
    }
  } catch {
    /* sem armazenamento (aba anônima etc.): o jogo funciona, só não lembra */
  }
  return { cenas: {} };
}

let salvo = ler();

function gravar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(salvo));
  } catch {
    /* idem */
  }
}

export function cenaSalva(faseId: string): Colado[] {
  return (salvo.cenas[faseId] ?? []).map((c) => ({ ...c }));
}

export function faseSalva() {
  return salvo.faseAtual;
}

let temporizador = 0;
export function salvarCena(faseId: string, colados: Colado[]) {
  salvo.cenas[faseId] = colados.map((c) => ({ ...c }));
  clearTimeout(temporizador);
  temporizador = window.setTimeout(gravar, 250);
}

export function salvarFase(faseId: string) {
  salvo.faseAtual = faseId;
  gravar();
}

export function salvarAgora() {
  clearTimeout(temporizador);
  gravar();
}
