/**
 * Protege os cômodos já salvos no celular dela.
 *
 * Um adesivo colado fica salvo pelo id (ex.: "02-cozinha-rosa-7") e pela posição no cômodo.
 * Se o recorte de uma fase publicada mudar, o mesmo id pode virar outro móvel, ou mudar de
 * tamanho, e a decoração dela fica bagunçada. Este script compara o recorte atual com
 * `folhas/publicadas.json` e falha se algo publicado mudou.
 *
 *   npx tsx scripts/conferir-fases.ts            confere (roda no build e no CI)
 *   npx tsx scripts/conferir-fases.ts --travar   registra as fases novas como publicadas
 *   npx tsx scripts/conferir-fases.ts --travar --aceitar <id-da-fase>
 *                                                aceita de propósito uma mudança numa fase publicada
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Manifest } from "../src/tipos.ts";

type Trava = Record<string, { comodo: string; adesivos: Record<string, string> }>;

const RAIZ = path.resolve(import.meta.dirname, "..");
const ARQUIVO_TRAVA = path.join(RAIZ, "folhas", "publicadas.json");
const args = process.argv.slice(2);
const travar = args.includes("--travar");
const aceitar = new Set(args.filter((_, i) => args[i - 1] === "--aceitar"));

const manifest: Manifest = JSON.parse(await readFile(path.join(RAIZ, "public", "fases", "manifest.json"), "utf8"));
const trava: Trava = existsSync(ARQUIVO_TRAVA) ? JSON.parse(await readFile(ARQUIVO_TRAVA, "utf8")) : {};

const impressao = (a: { w: number; h: number; assinatura?: string }) => `${a.w}x${a.h}:${a.assinatura ?? "?"}`;
const atual = new Map(manifest.fases.map((f) => [f.id, f]));
const problemas: string[] = [];

for (const [id, publicada] of Object.entries(trava)) {
  if (aceitar.has(id)) continue;
  const fase = atual.get(id);
  if (!fase) {
    problemas.push(`A fase "${id}" sumiu. Os cômodos salvos dela deixariam de aparecer.`);
    continue;
  }
  if (impressao(fase.comodo) !== publicada.comodo)
    problemas.push(`O cômodo de "${id}" mudou. As posições salvas ficariam deslocadas.`);
  const adesivos = new Map(fase.adesivos.map((a) => [a.id, a]));
  for (const [aid, marca] of Object.entries(publicada.adesivos)) {
    const a = adesivos.get(aid);
    if (!a) problemas.push(`O adesivo "${aid}" sumiu.`);
    else if (impressao(a) !== marca) problemas.push(`O adesivo "${aid}" mudou (outro desenho ou tamanho).`);
  }
}

if (problemas.length) {
  console.error("Fases já publicadas mudaram:\n  - " + problemas.join("\n  - "));
  console.error(
    "\nSe foi sem querer, desfaça a mudança no recorte (fases novas devem vir depois, com número maior)." +
      "\nSe foi de propósito, rode: npx tsx scripts/conferir-fases.ts --travar --aceitar <id-da-fase>",
  );
  process.exit(1);
}

if (travar) {
  const nova: Trava = {};
  for (const f of manifest.fases) {
    const antiga = trava[f.id];
    if (antiga && !aceitar.has(f.id)) {
      // Fase publicada: mantém o registro e acrescenta adesivos novos no fim, se houver.
      const adesivos = { ...antiga.adesivos };
      for (const a of f.adesivos) adesivos[a.id] ??= impressao(a);
      nova[f.id] = { comodo: antiga.comodo, adesivos };
    } else {
      nova[f.id] = { comodo: impressao(f.comodo), adesivos: Object.fromEntries(f.adesivos.map((a) => [a.id, impressao(a)])) };
    }
  }
  await writeFile(ARQUIVO_TRAVA, JSON.stringify(nova, null, 2) + "\n");
  const novas = manifest.fases.filter((f) => !trava[f.id]).map((f) => f.id);
  console.log(novas.length ? `Fases registradas como publicadas: ${novas.join(", ")}` : "Nenhuma fase nova para registrar.");
} else {
  const naoPublicadas = manifest.fases.filter((f) => !trava[f.id]).length;
  console.log(
    `Fases publicadas intactas (${Object.keys(trava).length}).` +
      (naoPublicadas ? ` ${naoPublicadas} fase(s) nova(s) ainda não registrada(s).` : ""),
  );
}
