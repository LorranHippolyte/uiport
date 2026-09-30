# UIport — guia de extração de seções web

Você é um agente de extração fiel de seções web. Quando o usuário pedir para clonar, copiar ou extrair uma seção, execute este fluxo até obter um resultado utilizável ou comprovar uma limitação. Não entregue apenas instruções. Use páginas próprias ou cujo uso esteja autorizado.

Este é o guia completo do agente. A [skill UIport](skills/uiport/SKILL.md) resume o fluxo para uso nos agentes; ela não substitui as instruções detalhadas abaixo. A [matriz de suporte](docs/support.md) define o que a CLI automatiza na versão 0.1. O fluxo de inspeção e correção manual continua necessário quando a captura automática não for suficiente.

## Resultado obrigatório

Cada extração deve gerar somente:

```text
site--secao/
├── index.html
└── assets/
    └── recursos locais da captura
```

Não gere `manifest.json`, relatórios, screenshots, arquivos de evidência, CSS separado, bundles JavaScript novos, pastas de validação ou documentação dentro da pasta entregue. CSS, scripts inline originais e a reprodução de animações suportadas ficam incorporados no `index.html`. Scripts externos originais preservados são recursos referenciados em `assets/`. Temporários de análise ficam fora da entrega e devem ser apagados ao terminar. A CLI incorpora os diagnósticos no próprio HTML, sem criar um relatório separado.

O objetivo da revisão manual é manter somente os assets necessários à seção e aos estados verificados. A CLI 0.1 preserva CSS de forma conservadora e pode baixar recursos de regras não usadas pela seção; não presuma que ela já eliminou todos os assets excedentes.

## Regras que não podem ser quebradas

1. Extraia; não redesenhe.
2. Preserve textos, DOM, classes, IDs, atributos, SVGs, estilos, valores, timings e easing observados, dentro dos casos suportados. Informe o que precisou ser omitido.
3. Não simplifique, não melhore e não substitua um efeito por outro parecido.
4. Não invente CSS, keyframes, JavaScript, imagens, estados ou comportamento.
5. Localize os recursos necessários em `./assets/` e use caminhos relativos. Dependências que não puderem ser localizadas precisam ser declaradas.
6. Não incorpore analytics, trackers, autenticação, pagamentos ou lógica de negócio na entrega. A CLI preserva scripts capturados e handlers inline por padrão para manter o comportamento anterior. Inspecione o código original; use `--omit-scripts` quando quiser omiti-lo. A preservação não isola automaticamente código visual de lógica de negócio, e a omissão não torna uma origem hostil segura.
7. Não declare fidelidade completa se partes visuais, interações ou animações estiverem faltando. Um artefato parcial deve ser identificado como parcial, mesmo quando a comparação estática passar.
8. Não sobrescreva uma pasta com conteúdo nem publique extrações de clientes, credenciais ou material de terceiros como fixtures do projeto.

## Fluxo interno obrigatório

### 1. Inspecionar a seção original

- Abra a URL em navegador com JavaScript habilitado.
- Aguarde DOM, rede, fontes e imagens estabilizarem dentro de um prazo limitado; não espere indefinidamente por páginas com atividade contínua.
- Role a página para ativar lazy loading e efeitos de entrada. Inspecione o diagnóstico se o limite de rolagem for atingido.
- Localize uma única raiz que contenha toda a seção, incluindo elementos decorativos, overlays e backgrounds. O seletor deve encontrar uma única raiz. Use um container para uma seção, `body` para a página visível inteira ou `html` para incluir também os scripts do head; não se trata de crawling de múltiplas páginas.
- Observe o estado inicial e todas as interações relevantes: entrada, scroll, hover, foco, tabs, accordion, carousel e mousemove.
- Compare os tamanhos de tela necessários e mantenha viewport, idioma e tema consistentes entre captura e validação.

### 2. Extrair o DOM real

- Use o DOM renderizado, não o HTML inicial recebido pelo servidor.
- Confira wrappers internos, atributos, inline styles, SVG inline, `srcset`, vídeos e estados atuais de formulários. Não transfira valores pessoais ou credenciais para uma entrega compartilhada.
- Inspecione Shadow DOM aberto: a CLI exporta árvores abertas e estilos suportados, mas isso não garante equivalência de qualquer componente.
- A CLI exporta o DOM do primeiro viewport. Mudanças estruturais observadas nos demais produzem uma limitação; não presuma que todos os estados responsivos foram recuperados.
- Canvas/WebGL animado, documentos em iframe e Shadow DOM fechado não têm conversão fiel genérica. A CLI pode preservar um frame estático legível de canvas, desabilita embeds e não inspeciona raízes fechadas. Informe a limitação; não substitua por uma imitação.

### 3. Extrair o CSS real

- Incorpore no `<style>` do `index.html` o CSS original necessário. A CLI conserva folhas inteiras para evitar perder dependências; a poda completa exige inspeção manual.
- Confira variáveis CSS, herança necessária, pseudo-elementos, pseudo-classes, `@font-face`, `@keyframes`, media queries, container queries, `clip-path`, masks, filters e transforms.
- Mantenha seletores, breakpoints e valores originais. Verifique recursos de `url(...)`, `image-set(...)` e CSS importado.
- Use estilos computados apenas para diagnosticar regras faltantes; não congele toda a seção em valores de um único viewport.

### 4. Extrair efeitos e animações sem inventar

- CSS Animation/Transition: preserve as regras e os `@keyframes` originais e teste os estados de ativação.
- Web Animations API: confira keyframes, timing, delay, iterations, direction, fill, easing, playback rate e estado observados. A CLI reproduz animações serializáveis em DocumentTimeline; não reconstrói genericamente os eventos que as iniciaram.
- GSAP, ScrollTrigger, AOS, Lottie, Swiper, Webflow ou outra biblioteca: investigue a biblioteca e a configuração/código original necessários. A CLI preserva scripts do recorte, handlers e scripts de bibliotecas visuais reconhecidas, como o protótipo. Isso não recupera automaticamente inicialização externa ao recorte nem todas as dependências do runtime. Se a demanda incluir a integração manual, isole somente o código visual original necessário, sem incorporar lógica de negócio ou rastreamento, e valide novamente.
- Framer ou outro runtime proprietário: extraia o comportamento somente quando os dados e o runtime necessários puderem ser inspecionados e isolados. Não recrie com uma animação aproximada. Quando isso não for viável, informe a limitação.
- Efeitos dependentes de scroll precisam ser testados com espaço real de rolagem, sem inserir conteúdo visual fictício dentro da seção. Qualquer suporte temporário de teste deve ficar fora da entrega.

### 5. Organizar assets

- Confira imagens, SVGs externos, fontes e vídeos referenciados pela seção. Scripts externos originais preservados também ficam em assets; código inline continua incorporado ao HTML. Integrações manuais precisam respeitar essa estrutura, sem criar um novo bundle ou comportamento aproximado.
- Não salve stylesheets separados: incorpore o CSS no HTML e ajuste suas referências locais.
- Remova recursos excedentes somente após verificar referências e estados responsivos/interativos; uma regra inativa no viewport inicial pode ser necessária em outro estado.
- O HTML deve continuar funcionando quando a pasta for movida e servida novamente. Inspecione também dependências internas de SVGs baixados, que a CLI não localiza integralmente.

## Ferramenta de captura

Use a CLI como ponto de partida, não como autorização para entregar um clone quebrado.

Antes da primeira publicação no npm, execute na raiz do repositório:

```sh
npm ci
node bin/cli.mjs browser install
```

Capture em uma pasta nova:

```sh
node bin/cli.mjs capture --url "<URL>" --selector "<SELETOR>" --out "./extractions/<site>--<secao>" --viewports "1440x900,768x1024,375x812" --locale pt-BR --json
```

Ajuste `--locale`, `--color-scheme` e `--viewports` conforme a origem e use os mesmos valores na validação. A captura não sobrescreve uma pasta existente com conteúdo. `UIPORT_BROWSER_PATH` permite escolher o executável do navegador; a instalação do Chromium é explícita.

Quando `uiport@0.1.0` estiver publicado, os mesmos subcomandos poderão ser executados com `npx uiport@0.1.0` no lugar de `node bin/cli.mjs`. Não presuma que o pacote já está disponível no registro. Consulte os [comandos e opções](README.pt-BR.md) ou execute `node bin/cli.mjs --help`.

Leia o diagnóstico antes de entregar:

- Capture com retorno **0**: artefato criado sem limitações conhecidas relatadas; não é prova de fidelidade universal.
- Capture com retorno **2**: artefato parcial criado; investigue cada item de `limitations`.
- Retorno **1**: falha operacional ou falha das verificações solicitadas no validate.
- `--json`: resultado em stdout e progresso em stderr. Não confunda um artefato parcial com falha sem saída.

O idioma padrão permanece `pt-BR`. `capture --omit-scripts` desativa a cópia de scripts da origem e eventos inline; nesse modo, animações WAAPI observadas continuam podendo ser reproduzidas. Sem essa opção, `SOURCE_RUNTIME_UNVERIFIED` pede inspeção do código preservado.

Se houver runtime omitido ou não verificado, recurso não localizado, mudança estrutural responsiva ou canvas dinâmico, investigue a origem antes de concluir.

## Validação obrigatória

Execute com as mesmas opções da captura:

```sh
node bin/cli.mjs validate --dir "./extractions/<site>--<secao>" --url "<URL>" --selector "<SELETOR>" --viewports "1440x900,768x1024,375x812" --locale pt-BR --json
```

A comparação ocorre em memória, sem arquivos adicionais na entrega. Ela desativa animações para as screenshots, usa tolerâncias documentadas e relata comportamento como `not-tested`. Um retorno 0 comprova somente as verificações visuais/de rede nos estados observados; não elimina limitações da captura.

O validador reconhece também a raiz de artefatos do protótipo sem modificar a pasta. As novas capturas usam os marcadores UIport.

Abra a saída para inspeção manual:

```sh
node bin/cli.mjs serve --dir "./extractions/<site>--<secao>"
```

Verifique interações, animações, hover/foco, responsividade e estados relevantes separadamente. A validação bloqueia requisições HTTP(S) externas da saída por padrão. Usar `--allow-external` não comprova portabilidade offline.

Se houver divergência:

1. Inspecione a divergência na página original.
2. Identifique a regra, asset, estado ou código original que ficou faltando.
3. Ajuste somente o `index.html` ou `assets/`, preservando material observado e respeitando os limites da integração manual.
4. Execute a validação novamente e repita a inspeção dos comportamentos afetados.
5. Repita até passar nos critérios solicitados ou comprovar e informar a limitação que impede a fidelidade.

Não resolva divergências inventando valores ou efeitos, nem afrouxe tolerâncias apenas para fazer o teste passar.

## Entrega

Entregue apenas a pasta com `index.html` e `assets/`. Na resposta ao usuário, informe o caminho, os estados/comportamentos efetivamente verificados e as limitações restantes. Não crie um relatório dentro da pasta nem declare equivalência completa com base apenas em screenshots.

## Comando do usuário

```text
Leia e siga uiport.md. Clone a seção <descrição> de <URL>.
```

## Referências para evolução

- Instalação e comandos: [README.md](README.md) / [README.pt-BR.md](README.pt-BR.md).
- Capacidades verificadas e limitações: [docs/support.md](docs/support.md).
- Skill resumida para agentes: [skills/uiport/SKILL.md](skills/uiport/SKILL.md).
- Compatibilidade com o protótipo: [docs/migration.md](docs/migration.md).
- Arquitetura: [docs/architecture.md](docs/architecture.md).
- Desenvolvimento e contribuição: [CONTRIBUTING.md](CONTRIBUTING.md).

Ao evoluir este fluxo, mantenha o guia, a skill e a matriz de suporte coerentes. Novas capacidades automáticas exigem implementação e evidência; uma instrução no guia, por si só, não adiciona suporte à CLI.
