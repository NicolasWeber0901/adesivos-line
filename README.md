# Cantinho de adesivos

Jogo de decorar cômodos isométricos com adesivos, feito para o celular.

**Jogar:** https://nicolasweber0901.github.io/adesivos-line/
**Versão de teste:** https://nicolasweber0901.github.io/adesivos-line/teste/ (salvamento separado, não mexe no de verdade)

## Como jogar

- Escolha a fase nas fitas lá em cima.
- Puxe um adesivo da cartela pontilhada para cima e solte no cômodo. Um toque rápido na cartela também cola o adesivo no meio do cômodo.
- Arraste um adesivo colado para mudar de lugar. Ao segurar, ele vai para a frente dos outros.
- Com um adesivo selecionado: **Virar** espelha, **Menor**/**Maior** mudam o tamanho, **Pra trás** manda para trás dos outros e **Tirar** descola.
  Para mudar o tamanho com os dedos, segure o adesivo com um dedo e faça pinça com o segundo.
- **Zoom:** pinça com dois dedos fora dos adesivos aproxima e afasta; com o cômodo ampliado, arraste o vazio com um dedo para andar pela cena.
  As lupas no canto esquerdo fazem o mesmo (aproximam no adesivo selecionado) e o botão de moldura volta a mostrar o cômodo inteiro.
  Segurando um adesivo perto da borda com zoom, a cena vai andando junto.
- **Girar:** no menu do adesivo, **Girar** abre um controle para inclinar a peça (ela "encaixa" no reto, em 45° e em 90°;
  **Reto** volta a 0°). Com dois dedos, segurando o adesivo com um e girando o outro, também gira.
- **Fixar:** no menu do adesivo, **Fixar** prende a peça no lugar (não arrasta, não muda de tamanho, não sai).
  Toque nela e use **Soltar** para mexer de novo. Adesivos soltos atrás de uma peça fixa continuam fáceis de pegar.
- **Desfazer / refazer:** as setas no canto direito voltam e avançam as ações (cada fase tem o seu histórico).
  No computador, Ctrl+Z e Ctrl+Shift+Z (ou Ctrl+Y).
- Arrastar um adesivo de volta para a cartela também descola.
- A câmera salva uma foto do cômodo; a lixeira limpa o cômodo.
- Tudo fica salvo no navegador do celular.
- Dá para instalar como app: no navegador, use "Adicionar à tela inicial".

## Adicionar uma fase nova

1. Coloque a imagem da folha de adesivos (PNG, JPG ou WebP) na pasta `folhas/`.
   A ordem das fases segue o nome do arquivo, então use um número maior que o último: `18-quarto.png`.
2. Faça o commit na branch `teste`. O GitHub Actions recorta a folha, monta a fase e publica em `/teste/`.

O recorte remove o fundo, separa cada desenho como um adesivo e usa a maior peça como cômodo.
Funciona melhor com folhas de fundo claro e liso, com os itens um pouco afastados.

### Ajustes opcionais

Se algum recorte não sair bom, crie um arquivo `.json` com o mesmo nome da imagem (`folhas/05-quarto.json`).
As coordenadas são em pixels da imagem original; `npm run recortar:debug` gera em `.cache/recortes/` uma
imagem com as caixas numeradas de cada peça para ajudar.

```json
{
  "nome": "Quarto",
  "ignorar": [[0, 0, 736, 90]],
  "unir": [[400, 540, 270, 230]],
  "fechar": [[455, 455, 140, 130, 5]],
  "remover": [[123, 264]],
  "separar": [[0, 1180, 250, 1180, 250, 1308, 0, 1308]],
  "comodo": [100, 400, 520, 560],
  "fundoFixo": true,
  "bordaFecha": ["cima"],
  "tolerancia": 30,
  "juntarAte": 3,
  "areaMinima": 120
}
```

| Campo | Para que serve |
| --- | --- |
| `nome` | Nome que aparece embaixo de "Fase N". Sem ele, vem do nome do arquivo. |
| `ignorar` | Retângulos `[x, y, largura, altura]` apagados antes do recorte (títulos, marcas). |
| `unir` | Junta numa peça só tudo que tem o centro dentro do retângulo. |
| `fechar` | Para desenhos de contorno aberto ou muito claros: junta e preenche o miolo. O 5º número é a força. |
| `remover` | Tira a peça que contém o ponto `[x, y]`. |
| `separar` | Separa itens que se encostam: cada polígono `[x1, y1, x2, y2, …]` vira uma peça própria. |
| `comodo` | Indica onde está o cômodo, se a maior peça não for ele. |
| `fundoFixo` | Para fundo branco liso com traço claro: evita que o recorte "coma" partes claras dos desenhos. |
| `bordaFecha` | Bordas da imagem (`cima`, `baixo`, `esquerda`, `direita`) que contam como parede ao usar `fechar`, para cômodos cortados pela folha. |
| `area` | Recorta só dentro deste retângulo (folhas com mais de um painel). |
| `formas` | Peças traçadas à mão: tudo dentro de cada polígono vira uma peça (tapetes da cor do fundo). |
| `brancoNaoEFundo` | Para adesivos brancos sobre fundo claro colorido: o branco deles não "vaza". |
| `vazarFuros` | Tira o fundo de vãos fechados (estantes, cercas) com a cor do fundo e pelo menos este tanto de px. |
| `descartarTracos` | Descarta peças que são só traço fino (sombras e contornos soltos). |
| `tolerancia` | Quanto a cor pode variar e ainda contar como fundo (padrão 30). |
| `juntarAte` | Distância em px para juntar partes próximas num adesivo só (padrão 3). Diminua se dois itens grudarem. |
| `areaMinima` | Tamanho mínimo para virar adesivo (padrão 120 px). |

Opções só da fase:

| Campo | Para que serve |
| --- | --- |
| `comodoRetangulo` | Cômodo desenhado de frente (como em jogos antigos): usa o retângulo inteiro como cômodo. |
| `extras` | Outras áreas da folha com fundo próprio (ex.: a cartela ao lado do cômodo), cada uma com as opções acima. |
| `remendar` | Cobre logotipos: `[x, y, w, h, dx, dy]` copia por cima os pixels deslocados (dx, dy). Vale para a folha toda. |
| `fases` | Uma folha com vários cenários: lista de fases, cada uma com `nome`, `sufixo` e as opções acima. |

## Como uma mudança chega até ela

1. Tudo novo vai primeiro para a branch **`teste`**. A cada push, o GitHub roda os testes num celular simulado
   e publica em `/teste/`. Essa versão guarda os cômodos numa chave separada, então dá para bagunçar à vontade.
2. Depois de testar no celular, a `teste` é juntada na **`main`**, que publica a versão de verdade.
3. Se os testes falharem em qualquer etapa, nada é publicado e o site continua na última versão boa.

O que os testes conferem: todas as fases abrem com todos os adesivos, colar/mover/devolver, desfazer/refazer,
peça fixa, girar, zoom e que um salvamento no formato da primeira versão continua aparecendo.

### Fases já publicadas são protegidas

Os cômodos salvos guardam o id de cada adesivo. Se o recorte de uma fase publicada mudasse, um adesivo
colado poderia virar outro. Por isso `folhas/publicadas.json` registra a "impressão digital" de cada recorte
publicado, e o build falha se algum mudar. Ao promover fases novas para a `main`, registre-as com
`npm run travar-fases`. Fases novas devem sempre entrar com um número maior que as existentes.

## Desenvolvimento

```bash
npm install
npm run dev       # recorta as folhas e abre o servidor (acessível pelo celular na mesma rede)
npm run build     # recorta, confere as fases publicadas e os tipos, e gera dist/
npm test          # testes no celular simulado (depois do build)
```

Feito com TypeScript e Vite, sem framework. Os recortes ficam em `public/fases/` e são gerados a cada build.
