# Launch kit — prepared, not posted

Publish after the approved GitHub/npm release. Replace candidate status in README and set the changelog release date before tagging. No announcement has been sent by the implementation process.

## Community post (Português)

Pessoal, criei o **UIport**, uma ferramenta open source para levar uma seção de uma página web ao seu projeto como HTML, CSS e assets editáveis.

A ideia nasceu de uma necessidade prática: começar a partir de uma implementação real, inspecionar os detalhes e continuar o desenvolvimento com nosso agente de código.

O fluxo é: capturar → abrir localmente → comparar → adaptar. A ferramenta mostra limitações de captura e diferencia comparação visual de comportamento. Animações CSS e alguns casos de Web Animations são suportados; ela não promete recuperar qualquer runtime ou gerar uma aplicação React automaticamente.

```sh
npx uiport@0.1.0 --help
```

No repositório há dois exemplos autorais, documentação em português e inglês e uma skill para agentes. Código MIT, sem conta ou chave de IA.

GitHub: https://github.com/LorranHippolyte/uiport

Criado e mantido por mim, Lorran Hippolyte, com desenvolvimento e manutenção da LuminaSoft. Compartilhado com a comunidade AI Coders Academy.

Se testar, conte qual caso ajudou você e onde encontrou limitações. Fixtures pequenas, melhorias na documentação e PRs são muito bem-vindos.

## Demonstration script (60–90 seconds)

1. Show `examples/responsive-hero` running locally and explain that it is original, redistributable material.
2. In a second terminal, run the README capture command with selector `#hero` and a new output directory.
3. Open the exported section on another port. Show its two-item directory and editable HTML/CSS.
4. Resize desktop to mobile and hover the call-to-action. `demo.webm` records this from an actual capture; `demo.png` is the still image used in the README.
5. Run validation and show the distinction between visual/network success and `behavior: not-tested`.
6. Close with the GitHub link, supported cases, contribution invitation and credits.

Regenerate the capture-based visual assets with `npm run demo`. This does not publish them.

## Learning after launch

Review aggregate npm downloads, GitHub traffic where available, useful issues, external PRs and reported use cases. Downloads are not unique users and stars do not establish usefulness. No telemetry is added to the CLI.
