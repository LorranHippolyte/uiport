# UIport ↗

**Da seção no navegador ao ponto de partida no seu projeto.**

O UIport captura uma seção renderizada como HTML editável, CSS original e assets locais. Inspecione a implementação, compare com a origem e use como base para continuar seu projeto. Executa localmente, pelo terminal ou pelo seu agente de código, sem conta, chave de IA ou serviço hospedado.

[English](README.md) · [Matriz de suporte](docs/support.md) · [Contribuição](CONTRIBUTING.md)

![Seção responsiva autoral criada para o UIport](docs/demo.png)

## O que você recebe

```text
minha-secao/
├── index.html     # HTML, estilos e reprodução de animações suportadas
└── assets/        # Imagens, fontes e outros recursos localizados
```

O CSS é preservado de forma conservadora, incluindo regras fora da seção escolhida. A saída usa o DOM do primeiro tamanho de tela; a validação compara vários tamanhos. A ferramenta não gera componentes React, não percorre um site inteiro e não recupera qualquer comportamento JavaScript. Scripts dentro do conteúdo selecionado, eventos inline e scripts de bibliotecas visuais reconhecidas são preservados por padrão, como no protótipo. Use `capture --omit-scripts` para omiti-los. CSS e animações Web Animations serializáveis podem ser preservados; dependências e inicialização fora do recorte continuam exigindo análise manual.

## Instalação e uso

Requer **Node.js 22.14+**; recomendamos Node 24 LTS. O Chromium é instalado explicitamente, ou a ferramenta usa Chrome/Edge já disponível. Sessões pessoais do navegador não são importadas.

Execute os comandos em uma pasta de sua escolha, que pode estar vazia. O `npx` obtém o UIport automaticamente; não é necessário criar um `package.json` nem rodar `npm install` nessa pasta. `browser install` prepara o Chromium no cache compartilhado do Playwright.

```sh
npx uiport@0.1.1 browser install
npx uiport@0.1.1 capture --url "https://seu-site.example" --selector "#hero" --out ./minha-secao
npx uiport@0.1.1 serve --dir ./minha-secao
npx uiport@0.1.1 validate --url "https://seu-site.example" --selector "#hero" --dir ./minha-secao
```

Para escolher o seletor, use **Inspecionar elemento** no navegador. Ele precisa encontrar exatamente um container, como `main`, `section` ou `div`. Use `body` para capturar a página visível completa ou `html` para incluir também scripts originais do head. Isso captura uma página, sem percorrer automaticamente outras URLs do site.

Para uso frequente: `npm install -g uiport`, depois `uiport --help`. Fixe uma versão quando precisar reproduzir uma captura; `npx uiport@latest` acompanha versões futuras.

### Experimentar o exemplo autoral pelo repositório

```sh
git clone https://github.com/LorranHippolyte/uiport.git
cd uiport
npm ci
node bin/cli.mjs browser install
node bin/cli.mjs serve --dir examples/responsive-hero --port 4173
```

Em outro terminal, na mesma pasta:

```sh
node bin/cli.mjs capture --url http://127.0.0.1:4173 --selector '#hero' --out ./extractions/hero
node bin/cli.mjs validate --url http://127.0.0.1:4173 --selector '#hero' --dir ./extractions/hero
node bin/cli.mjs serve --dir ./extractions/hero --port 4174
```

Abra `http://127.0.0.1:4174`. A pasta de saída pode ser movida e servida novamente. O segundo exemplo, `examples/css-motion`, usa o seletor `#motion` e contém hover, foco e animações CSS. Os exemplos e suas ilustrações são autorais do UIport.

## Comandos e opções

| Comando | Resultado |
|---|---|
| `capture --url URL --selector CSS --out PASTA` | Captura uma seção renderizada |
| `serve --dir PASTA --port 4173` | Abre servidor local; encerra com Ctrl+C |
| `validate --url URL --selector CSS --dir PASTA` | Compara imagens e verifica erros de recursos |
| `browser install` | Instala Chromium compatível com a versão de Playwright do pacote |
| `--help` / `--version` | Mostra ajuda ou versão sem abrir navegador |

Capture e validate aceitam `--viewports`, `--wait`, `--timeout`, `--max-scroll-steps`, `--locale`, `--color-scheme` e `--json`. Padrões: `1440x900,1024x768,768x1024,375x812`, espera de 1200 ms, prazo total de 120 s, 80 passos de rolagem, idioma `pt-BR` e tema `light`. Use o mesmo `--locale` nos dois comandos quando precisar de outro idioma.

A captura limita recursos copiados a 20 MiB por arquivo e 100 MiB no total, configuráveis por `--max-resource-mb` e `--max-total-mb`. A captura reaproveita respostas recebidas pelo navegador, incluindo recursos que exigem Referer, e usa fetch HTTP como fallback. Os orçamentos limitam bytes retidos e baixados pela exportação, não a memória completa do navegador nem o buffer temporário materializado pelo Playwright. O fetch de fallback tem prazo de até 15 s.

`UIPORT_BROWSER_PATH` define o executável do navegador. Sem override, o UIport tenta Chromium compatível, Chrome e Edge instalados, incluindo macOS.

## Como interpretar o resultado

- **Capture retorna 0:** criou o artefato sem limitações conhecidas relatadas. Não certifica equivalência funcional completa.
- **Capture retorna 2:** criou um artefato parcial. Leia `limitations` antes de usar.
- **Retorno 1:** falha operacional ou falha das verificações pedidas no validate.
- **Validate retorna 0:** verificações visuais/de rede passaram nos estados observados. Comportamento continua `not-tested`.

`--json` retorna um único resultado no stdout para capture/validate/browser; progresso vai para stderr. `serve --json` emite um único documento de início e permanece ativo até ser encerrado. Automações precisam tratar retorno 2 separadamente. A captura não sobrescreve uma pasta de saída existente com conteúdo. Código de origem preservado gera `SOURCE_RUNTIME_UNVERIFIED`: teste suas interações; igualdade de screenshots não comprova que todas as dependências foram recuperadas.

A comparação visual desativa animações, aceita por padrão 2% de diferença de pixels e até 5 px de diferença de altura. Ela não comprova cliques, hover, efeitos de scroll ou estado de framework. Requisições externas da saída são bloqueadas por padrão, inclusive outra porta de localhost. `--allow-external` permite essas requisições e desativa esse teste de funcionamento sem rede externa. O `validate` também reconhece o marcador de extrações do protótipo sem reescrever a pasta; novas extrações usam os marcadores UIport. Consulte os casos suportados em [docs/support.md](docs/support.md).

Compatibilidade com o protótipo e mudanças intencionais de comandos/limites: [notas de migração](docs/migration.md).

## Usar com agentes e contribuir

Comece por [uiport.md](uiport.md). Leia [skills/uiport/SKILL.md](skills/uiport/SKILL.md) ou copie para a pasta de skills do seu agente. A skill também acompanha o pacote npm. O agente deve capturar, ler limitações, inspecionar interações suportadas e validar, sem inventar efeitos substitutos. O UIport não chama uma API de LLM.

Contribuições em recursos, documentação, testes e diagnóstico são bem-vindas. Veja [CONTRIBUTING.md](CONTRIBUTING.md). Use fixtures locais autorais; não envie extrações de clientes. Depois de instalar o browser, `npm run check` executa as verificações de desenvolvimento.

## Autoria e licença

Criado e mantido por **[Lorran Hippolyte](https://github.com/LorranHippolyte)**, com desenvolvimento e manutenção da **LuminaSoft**. Compartilhado com a comunidade **AI Coders Academy**.

Código e exemplos autorais sob [licença MIT](LICENSE). Use páginas próprias ou cujo uso esteja autorizado. A licença da ferramenta não concede direitos sobre material de terceiros capturado; veja [NOTICE](NOTICE). [Segurança](SECURITY.md) · [Governança](GOVERNANCE.md) · [Conduta](CODE_OF_CONDUCT.md).
