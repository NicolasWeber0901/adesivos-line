# Cantinho de adesivos

Jogo de decorar cômodos isométricos com adesivos, feito para o celular.

**Jogar:** https://nicolasweber0901.github.io/adesivos-line/

## Como jogar

- Escolha a fase nas fitas lá em cima.
- Puxe um adesivo da cartela pontilhada para cima e solte no cômodo. Um toque rápido na cartela também cola o adesivo no meio do cômodo.
- Arraste um adesivo colado para mudar de lugar. Ao segurar, ele vai para a frente dos outros.
- Com um adesivo selecionado: **Virar** espelha, **Menor**/**Maior** mudam o tamanho (ou faça pinça com dois dedos), **Pra trás** manda para trás dos outros e **Tirar** descola.
- Arrastar um adesivo de volta para a cartela também descola.
- A câmera salva uma foto do cômodo; a lixeira limpa o cômodo.
- Tudo fica salvo no navegador do celular.
- Dá para instalar como app: no navegador, use "Adicionar à tela inicial".

## Adicionar uma fase nova

1. Coloque a imagem da folha de adesivos (PNG, JPG ou WebP) na pasta `folhas/`.
   A ordem das fases segue o nome do arquivo, então use um número na frente: `05-quarto.png`.
2. Faça o commit. O GitHub Actions recorta a folha, monta a fase e publica sozinho.

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
  "comodo": [100, 400, 520, 560],
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
| `comodo` | Indica onde está o cômodo, se a maior peça não for ele. |
| `tolerancia` | Quanto a cor pode variar e ainda contar como fundo (padrão 30). |
| `juntarAte` | Distância em px para juntar partes próximas num adesivo só (padrão 3). Diminua se dois itens grudarem. |
| `areaMinima` | Tamanho mínimo para virar adesivo (padrão 120 px). |

## Desenvolvimento

```bash
npm install
npm run dev       # recorta as folhas e abre o servidor (acessível pelo celular na mesma rede)
npm run build     # recorta, confere os tipos e gera dist/
```

Feito com TypeScript e Vite, sem framework. Os recortes ficam em `public/fases/` e são gerados a cada build.
