import { test, expect, type Page, type CDPSession } from "@playwright/test";
import manifestJson from "../public/fases/manifest.json" with { type: "json" };
import type { Manifest } from "../src/tipos.ts";

const manifest = manifestJson as Manifest;
const CHAVE = "adesivos-line:v1";

// ------------------------------------------------------------------ toque de verdade (CDP)

type Ponto = [x: number, y: number];

async function toque(cdp: CDPSession, tipo: "touchStart" | "touchMove" | "touchEnd", pontos: Ponto[]) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: tipo,
    touchPoints: pontos.map(([x, y], id) => ({ x, y, id })),
  });
}

async function arrastar(page: Page, cdp: CDPSession, de: Ponto, para: Ponto, passos = 12) {
  await toque(cdp, "touchStart", [de]);
  for (let i = 1; i <= passos; i++) {
    const t = i / passos;
    await toque(cdp, "touchMove", [[de[0] + (para[0] - de[0]) * t, de[1] + (para[1] - de[1]) * t]]);
    await page.waitForTimeout(16);
  }
  await toque(cdp, "touchEnd", []);
  await page.waitForTimeout(150);
}

const tocar = (page: Page, cdp: CDPSession, p: Ponto) => arrastar(page, cdp, p, p, 1);

async function centro(page: Page, seletor: string, i = 0): Promise<Ponto> {
  const caixa = await page.locator(seletor).nth(i).boundingBox();
  if (!caixa) throw new Error(`sem caixa para ${seletor}`);
  return [caixa.x + caixa.width / 2, caixa.y + caixa.height / 2];
}

/** Ponto de tinta do adesivo (não um canto transparente). */
async function pontoDoAdesivo(page: Page, i = 0): Promise<Ponto> {
  return page.evaluate((i) => {
    const el = document.querySelectorAll<HTMLElement>(".colado")[i];
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height * 0.6] as [number, number];
  }, i);
}

async function abrir(page: Page, salvo?: unknown) {
  await page.goto("./");
  if (salvo !== undefined) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [CHAVE, salvo] as const);
    await page.reload();
  }
  await expect(page.locator(".fita")).toHaveCount(manifest.fases.length);
  return page.context().newCDPSession(page);
}

async function irParaFase(page: Page, i: number) {
  await page.locator(".fita").nth(i).click();
  await expect(page.locator(".fita").nth(i)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#comodo")).toHaveJSProperty("complete", true);
}

const salvo = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), CHAVE);
const posicao = (page: Page, i = 0) =>
  page.evaluate((i) => {
    const r = document.querySelectorAll(".colado")[i].getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y)];
  }, i);

let erros: string[];
test.beforeEach(({ page }) => {
  erros = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
});
test.afterEach(() => expect(erros, "erros no console").toEqual([]));

// ------------------------------------------------------------------ testes

test("todas as fases abrem com cômodo e cartela completos", async ({ page, request }) => {
  await abrir(page);
  for (const [i, fase] of manifest.fases.entries()) {
    await irParaFase(page, i);
    expect(await page.locator("#comodo").evaluate((img: HTMLImageElement) => img.naturalWidth), fase.id).toBeGreaterThan(0);
    await expect(page.locator(".figurinha")).toHaveCount(fase.adesivos.length);
  }
  for (const fase of manifest.fases)
    for (const a of fase.adesivos) expect((await request.get(a.src)).status(), a.src).toBe(200);
});

test("colar, mover e devolver para a cartela", async ({ page }) => {
  const cdp = await abrir(page);
  await irParaFase(page, 1);
  const palco = await page.locator("#palco").boundingBox();
  const destino: Ponto = [palco!.x + palco!.width / 2, palco!.y + palco!.height * 0.55];
  await arrastar(page, cdp, await centro(page, ".figurinha", 0), destino);
  await expect(page.locator(".colado")).toHaveCount(1);

  const antes = await posicao(page);
  const p = await pontoDoAdesivo(page);
  await arrastar(page, cdp, p, [p[0] + 40, p[1] - 30]);
  expect(await posicao(page)).not.toEqual(antes);

  await arrastar(page, cdp, await pontoDoAdesivo(page), await centro(page, "#paleta"));
  await expect(page.locator(".colado")).toHaveCount(0);
});

test("desfazer e refazer", async ({ page }) => {
  const cdp = await abrir(page);
  await irParaFase(page, 2);
  await expect(page.locator("#btn-desfazer")).toBeDisabled();

  await tocar(page, cdp, await centro(page, ".figurinha", 0));
  await tocar(page, cdp, await centro(page, ".figurinha", 1));
  await expect(page.locator(".colado")).toHaveCount(2);

  const p = await pontoDoAdesivo(page, 1);
  await arrastar(page, cdp, p, [p[0] + 50, p[1]]);
  const movido = await posicao(page, 1);

  await page.locator("#btn-desfazer").click();
  expect(await posicao(page, 1)).not.toEqual(movido);
  await page.locator("#btn-desfazer").click();
  await expect(page.locator(".colado")).toHaveCount(1);
  await page.locator("#btn-refazer").click();
  await expect(page.locator(".colado")).toHaveCount(2);
  await page.locator("#btn-refazer").click();
  expect(await posicao(page, 1)).toEqual(movido);
  await expect(page.locator("#btn-refazer")).toBeDisabled();

  // Teclado (para testar no computador).
  await page.keyboard.press("Control+z");
  expect(await posicao(page, 1)).not.toEqual(movido);
  await page.keyboard.press("Control+Shift+z");
  expect(await posicao(page, 1)).toEqual(movido);

  // Desfazer também salva: recarregando, fica como estava.
  await page.locator("#btn-desfazer").click();
  await page.locator("#btn-desfazer").click();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator(".colado")).toHaveCount(1);
});

test("peça fixa não sai do lugar até ser solta", async ({ page }) => {
  const cdp = await abrir(page);
  await irParaFase(page, 0);
  await tocar(page, cdp, await centro(page, ".figurinha", 0));
  await page.locator('[data-acao="fixar"]').click();
  await expect(page.locator(".colado").first()).toHaveClass(/fixo/);
  await expect(page.locator('[data-acao="tirar"]')).toBeHidden();

  const antes = await posicao(page);
  const p = await pontoDoAdesivo(page);
  await arrastar(page, cdp, p, [p[0] + 60, p[1] + 40]);
  expect(await posicao(page)).toEqual(antes);

  // Pinça em cima dela também não muda o tamanho (vira zoom da cena).
  await toque(cdp, "touchStart", [p]);
  await toque(cdp, "touchStart", [p, [p[0] + 40, p[1]]]);
  for (let i = 1; i <= 6; i++) await toque(cdp, "touchMove", [p, [p[0] + 40 + i * 10, p[1]]]);
  await toque(cdp, "touchEnd", []);
  const escala = await page.locator(".colado").first().evaluate((el) => el.style.getPropertyValue("--s"));
  expect(escala).toBe("1");
  await page.locator("#btn-ver-tudo").click();

  await tocar(page, cdp, p);
  await page.locator('[data-acao="fixar"]').click();
  await arrastar(page, cdp, p, [p[0] + 60, p[1] + 40]);
  expect(await posicao(page)).not.toEqual(antes);

  await page.waitForTimeout(400);
  const dados = await salvo(page);
  expect(dados.cenas[manifest.fases[0].id][0].fixo).toBeUndefined();
});

test("salvamento antigo continua aparecendo", async ({ page }) => {
  // Formato exato da primeira versão publicada (sem "fixo").
  const fase = manifest.fases[1];
  const antigo = {
    faseAtual: fase.id,
    cenas: {
      [fase.id]: [
        { uid: "a", aid: fase.adesivos[3].id, x: 150, y: 260, escala: 1, espelhado: false, z: 1 },
        { uid: "b", aid: fase.adesivos[5].id, x: 260, y: 300, escala: 1.15, espelhado: true, z: 2 },
      ],
      [manifest.fases[0].id]: [{ uid: "c", aid: manifest.fases[0].adesivos[0].id, x: 200, y: 300, escala: 1, espelhado: false, z: 1 }],
    },
  };
  await abrir(page, antigo);
  await expect(page.locator(".fita").nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".colado")).toHaveCount(2);
  await irParaFase(page, 0);
  await expect(page.locator(".colado")).toHaveCount(1);
  await page.waitForTimeout(400);
  expect((await salvo(page)).cenas).toEqual(antigo.cenas);
});

test("zoom com pinça no vazio e botões", async ({ page }) => {
  const cdp = await abrir(page);
  await irParaFase(page, 3);
  const palco = (await page.locator("#palco").boundingBox())!;
  const a: Ponto = [palco.x + palco.width * 0.4, palco.y + 30];
  const b: Ponto = [palco.x + palco.width * 0.6, palco.y + 60];
  await toque(cdp, "touchStart", [a]);
  await toque(cdp, "touchStart", [a, b]);
  for (let i = 1; i <= 8; i++) await toque(cdp, "touchMove", [[a[0] - i * 6, a[1] - i * 2], [b[0] + i * 6, b[1] + i * 6]]);
  await toque(cdp, "touchEnd", []);
  await expect(page.locator("#palco")).toHaveClass(/ampliado/);
  await page.locator("#btn-ver-tudo").click();
  await expect(page.locator("#palco")).not.toHaveClass(/ampliado/);
  await page.locator("#btn-aproximar").click();
  await expect(page.locator("#palco")).toHaveClass(/ampliado/);
});
