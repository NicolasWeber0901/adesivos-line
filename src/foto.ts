import { carregar } from "./imagens.ts";
import type { AdesivoManifest, Colado, FaseManifest } from "./tipos.ts";

/** Desenha o cômodo decorado num PNG e oferece para compartilhar ou baixar. */
export async function salvarFoto(fase: FaseManifest, colados: Colado[], porId: Map<string, AdesivoManifest>) {
  const comodo = await carregar(fase.comodo.src);
  const itens = await Promise.all(
    [...colados]
      .sort((a, b) => a.z - b.z)
      .map(async (c) => {
        const a = porId.get(c.aid);
        return a ? { c, a, im: await carregar(a.src) } : null;
      }),
  );

  // Área da foto: o cômodo mais o que tiver sido colado para fora dele.
  let minX = 0;
  let minY = 0;
  let maxX = fase.comodo.w;
  let maxY = fase.comodo.h;
  for (const item of itens) {
    if (!item) continue;
    // Caixa do adesivo já girado.
    const r = ((item.c.rot ?? 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(r));
    const sin = Math.abs(Math.sin(r));
    const meiaW = ((item.a.w * cos + item.a.h * sin) * item.c.escala) / 2;
    const meiaH = ((item.a.w * sin + item.a.h * cos) * item.c.escala) / 2;
    minX = Math.min(minX, item.c.x - meiaW);
    minY = Math.min(minY, item.c.y - meiaH);
    maxX = Math.max(maxX, item.c.x + meiaW);
    maxY = Math.max(maxY, item.c.y + meiaH);
  }
  const margem = 24;
  const ampliar = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((maxX - minX + margem * 2) * ampliar);
  canvas.height = Math.ceil((maxY - minY + margem * 2) * ampliar);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff6f8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ampliar, ampliar);
  ctx.translate(margem - minX, margem - minY);
  ctx.drawImage(comodo.img, 0, 0, fase.comodo.w, fase.comodo.h);
  for (const item of itens) {
    if (!item) continue;
    ctx.save();
    ctx.translate(item.c.x, item.c.y);
    ctx.rotate(((item.c.rot ?? 0) * Math.PI) / 180);
    ctx.scale(item.c.escala * (item.c.espelhado ? -1 : 1), item.c.escala);
    ctx.drawImage(item.im.img, -item.a.w / 2, -item.a.h / 2, item.a.w, item.a.h);
    ctx.restore();
  }

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Não consegui gerar a foto");
  const nome = `${fase.id}.png`;
  const arquivo = new File([blob], nome, { type: "image/png" });

  if (navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: fase.nome });
      return "compartilhada";
    } catch (erro) {
      if ((erro as DOMException).name === "AbortError") return "cancelada";
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "baixada";
}
