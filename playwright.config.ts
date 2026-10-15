import { defineConfig, devices } from "@playwright/test";

/**
 * Testes do jogo num celular simulado. Rodam no GitHub antes de cada publicação:
 * se algum falhar, o site que ela usa não é atualizado.
 *
 *   npm run build && npm test
 */
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:4317/",
    ...devices["Pixel 7"],
    // Navegador local quando o ambiente já tem um Chromium instalado.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: "celular comprido", use: { viewport: { width: 412, height: 915 } } },
    { name: "celular pequeno", use: { viewport: { width: 360, height: 640 } } },
  ],
  webServer: {
    command: "npx vite preview --port 4317 --strictPort",
    url: "http://localhost:4317/",
    reuseExistingServer: !process.env.CI,
  },
});
