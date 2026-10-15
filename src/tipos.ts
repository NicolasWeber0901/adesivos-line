/** Formato de `public/fases/manifest.json`, gerado por `scripts/recortar.ts`. */
export interface AdesivoManifest {
  id: string;
  src: string;
  /** Tamanho em pixels da folha original: mantém a proporção entre móveis e cômodo. */
  w: number;
  h: number;
  /** Impressão digital dos pixels: muda se o recorte mudar (veja scripts/conferir-fases.ts). */
  assinatura?: string;
}

export interface FaseManifest {
  id: string;
  nome: string;
  comodo: { src: string; w: number; h: number; assinatura?: string };
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
  /** Peça fixa: não sai do lugar até ser solta. (Ausente nos salvamentos antigos.) */
  fixo?: boolean;
  /** Rotação em graus, sentido horário. (Ausente = 0, como nos salvamentos antigos.) */
  rot?: number;
}
