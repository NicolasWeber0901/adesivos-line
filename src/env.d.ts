/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "teste" na versão publicada em /teste/; vazio na versão de verdade. */
  readonly VITE_CANAL?: string;
}
