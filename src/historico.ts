import type { Colado } from "./tipos.ts";

/**
 * Desfazer/refazer por fase. Cada passo é uma foto do cômodo inteiro (são poucos adesivos,
 * então é simples e não tem como "dessincronizar"). Fica só na memória da aba.
 */
const LIMITE = 80;

interface Linha {
  passado: string[];
  futuro: string[];
  atual: string;
}

const linhas = new Map<string, Linha>();
const foto = (colados: Colado[]) => JSON.stringify(colados);

/** Começa (ou retoma) o histórico de uma fase a partir do estado carregado. */
export function iniciarHistorico(faseId: string, colados: Colado[]) {
  const atual = foto(colados);
  const linha = linhas.get(faseId);
  // Se o salvo mudou por fora (outra aba), recomeça para não desfazer para um estado estranho.
  if (!linha || linha.atual !== atual) linhas.set(faseId, { passado: [], futuro: [], atual });
}

/** Registra o estado depois de uma mudança. Devolve true se algo mudou de fato. */
export function registrar(faseId: string, colados: Colado[]) {
  const linha = linhas.get(faseId);
  const atual = foto(colados);
  if (!linha) {
    linhas.set(faseId, { passado: [], futuro: [], atual });
    return false;
  }
  if (atual === linha.atual) return false;
  linha.passado.push(linha.atual);
  if (linha.passado.length > LIMITE) linha.passado.shift();
  linha.futuro = [];
  linha.atual = atual;
  return true;
}

export function desfazer(faseId: string): Colado[] | null {
  const linha = linhas.get(faseId);
  const anterior = linha?.passado.pop();
  if (!linha || anterior === undefined) return null;
  linha.futuro.push(linha.atual);
  linha.atual = anterior;
  return JSON.parse(anterior);
}

export function refazer(faseId: string): Colado[] | null {
  const linha = linhas.get(faseId);
  const proximo = linha?.futuro.pop();
  if (!linha || proximo === undefined) return null;
  linha.passado.push(linha.atual);
  linha.atual = proximo;
  return JSON.parse(proximo);
}

export function podeDesfazer(faseId: string) {
  return (linhas.get(faseId)?.passado.length ?? 0) > 0;
}

export function podeRefazer(faseId: string) {
  return (linhas.get(faseId)?.futuro.length ?? 0) > 0;
}
