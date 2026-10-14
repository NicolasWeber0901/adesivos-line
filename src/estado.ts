import type { Colado } from "./tipos.ts";

/**
 * Tudo fica salvo no próprio navegador do celular.
 * O formato desta chave não pode mudar: é onde estão os cômodos que ela já decorou.
 */
const CHAVE = "adesivos-line:v1";

interface Salvo {
  faseAtual?: string;
  cenas: Record<string, Colado[]>;
}

function ler(): Salvo | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return { cenas: {} };
    const dados = JSON.parse(bruto) as Salvo;
    if (dados && typeof dados === "object" && dados.cenas && typeof dados.cenas === "object") return dados;
    return null;
  } catch {
    return null;
  }
}

/** Cópia em memória: vale quando o navegador não deixa salvar (aba anônima etc.). */
const memoria: Salvo = ler() ?? { cenas: {} };

/** Só o que mudou nesta aba é gravado, mesclado com o que já está salvo. */
const cenasPendentes = new Map<string, Colado[]>();
let fasePendente: string | undefined;

function gravar() {
  if (!cenasPendentes.size && fasePendente === undefined) return;
  try {
    const atual = ler();
    // Se o que está salvo não for legível, não sobrescreve: melhor perder a mudança do que o progresso.
    if (!atual) return;
    for (const [id, cena] of cenasPendentes) atual.cenas[id] = cena;
    if (fasePendente !== undefined) atual.faseAtual = fasePendente;
    localStorage.setItem(CHAVE, JSON.stringify(atual));
    cenasPendentes.clear();
    fasePendente = undefined;
  } catch {
    /* sem armazenamento: segue só com a memória */
  }
}

export function cenaSalva(faseId: string): Colado[] {
  const pendente = cenasPendentes.get(faseId);
  const cena = pendente ?? ler()?.cenas[faseId] ?? memoria.cenas[faseId] ?? [];
  return cena.map((c) => ({ ...c }));
}

export function faseSalva() {
  return ler()?.faseAtual ?? memoria.faseAtual;
}

let temporizador = 0;
export function salvarCena(faseId: string, colados: Colado[]) {
  const copia = colados.map((c) => ({ ...c }));
  memoria.cenas[faseId] = copia;
  cenasPendentes.set(faseId, copia);
  clearTimeout(temporizador);
  temporizador = window.setTimeout(gravar, 250);
}

export function salvarFase(faseId: string) {
  memoria.faseAtual = faseId;
  fasePendente = faseId;
  gravar();
}

export function salvarAgora() {
  clearTimeout(temporizador);
  gravar();
}
