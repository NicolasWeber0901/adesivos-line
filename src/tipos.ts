/** Formato de `public/fases/manifest.json`, gerado por `scripts/recortar.ts`. */
export interface AdesivoManifest {
  id: string;
  src: string;
  /** Tamanho em pixels da folha original: mantém a proporção entre móveis e cômodo. */
  w: number;
  h: number;
}

export interface FaseManifest {
  id: string;
  nome: string;
  comodo: { src: string; w: number; h: number };
  adesivos: AdesivoManifest[];
}

export interface Manifest {
  fases: FaseManifest[];
}

/** Um adesivo já colado no cômodo. Coordenadas no espaço da imagem do cômodo. */
export interface Colado {
  uid: string;
  /** id do adesivo no manifest */
  aid: string;
  /** centro do adesivo */
  x: number;
  y: number;
  escala: number;
  espelhado: boolean;
  z: number;
}
