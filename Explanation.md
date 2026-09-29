É uma aplicação web local (Next.js + React + TypeScript) para desenhar e editar arquivos de mission tree do EU4 sem perder blocos Clausewitz que o editor não entende. O núcleo preserva o arquivo como uma AST — uma árvore da sintaxe do Clausewitz — e a interface apenas manipula essa árvore.

Fluxo geral:

```text
arquivo .txt do EU4
        ↓
clausewitz.ts (parseia para AST)
        ↓
project.ts (reconhece series e missões na AST)
        ↓
React: Architect
 ├─ Canvas: mapa visual e links
 ├─ Inspector: edição da missão
 ├─ Library: árvores de referência
 └─ Managers: series, branches e raw AST
        ↓
validate.ts (diagnósticos)
        ↓
exportMissionTree() → .txt para o mod
```

## Arquivos principais

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| [page.tsx](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\app\page.tsx) | Página inicial do Next; apenas monta o editor. | `Architect` |
| [layout.tsx](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\app\layout.tsx) | HTML raiz, idioma `pt-BR`, metadados e CSS global. | `globals.css` |
| [Architect.tsx](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\components\Architect.tsx) | Controlador central: estado do projeto, undo/redo, importação, exportação, autosave, validação e composição da tela. | Todo o núcleo e os componentes visuais |
| [clausewitz.ts](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\core\clausewitz.ts) | Parser e serializador do formato de script da Paradox. É a base técnica do projeto. | Nada do projeto |
| [project.ts](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\core\project.ts) | Modelo do `.eu4proj`, identificação de series/missões e operações de negócio: criar, renomear, mover, copiar, apagar e exportar. | `clausewitz.ts` |
| [validate.ts](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\core\validate.ts) | Detecta IDs inválidos, pré-requisitos ausentes, ciclos, posições, regras Portuversalis etc. | `clausewitz.ts`, `project.ts` |
| [Canvas.tsx](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\components\Canvas.tsx) | Área visual das cinco colunas/slots. Suporta pan, zoom, arrastar missões, criar por duplo clique e conectar pré-requisitos. | `project.ts`, `clausewitz.ts` |
| [Inspector.tsx](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\components\Inspector.tsx) | Painel de edição da missão selecionada: ID, localization, série, posição, ícone, requisitos, trigger, effect e raw. | Núcleo, ícones |
| [Library.tsx](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\components\Library.tsx) | Importa árvores de referência e copia missões delas para a árvore em edição. | `project.ts` |
| [Managers.tsx](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\components\Managers.tsx) | Modais para administrar series, branches e editar a AST completa. | Núcleo e helpers do Inspector |
| [storage.ts](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\lib\storage.ts) | Autosave no `IndexedDB`, leitura de arquivos e downloads pelo navegador. | `project.ts` |
| [icons.ts](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\lib\icons.ts) | Gera previews de PNG/JPEG/WebP e decodifica DDS DXT1/DXT3/DXT5. | APIs do navegador |
| [route.ts](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\app\api\architect\route.ts) | API HTTP alternativa para parsear, validar e exportar projeto. Usa o mesmo núcleo; não é usada pela interface atual, que roda isso diretamente no cliente. | Todo o núcleo |

## Como o editor reconhece uma mission tree

Em [project.ts](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\src\core\project.ts), uma “series” é qualquer bloco com `slot`. Dentro dela, uma missão é um bloco que tenha ao menos um dos campos visuais conhecidos, como `position`, `icon`, `trigger`, `effect` ou `required_missions`.

Exemplo simplificado:

```txt
my_series = {
    slot = 1

    conquer_land = {
        icon = mission_conquer
        position = 1
        required_missions = { earlier_mission }
        trigger = { ... }
        effect = { ... }
    }
}
```

A aplicação não transforma o arquivo em um modelo restrito de EU4. Ela conserva blocos desconhecidos, comentários, operadores como `>=`, strings com escape e valores sem chave. Isso é importante para não destruir scripted triggers, efeitos de mods ou sintaxe ainda não coberta pela interface.

## O estado salvo no `.eu4proj`

O formato de projeto inclui:

- `tree`: a árvore que será exportada;
- `library`: árvores importadas como referência;
- `origins`: de qual árvore/missão da biblioteca uma cópia veio;
- `localization`: títulos e descrições inseridos pela ferramenta;
- `icons`: previews e dados de ícones anexados ao projeto;
- `branches`: metadados de branches;
- `portuversalis` e `baseTreeId`: configuração para a validação especial.

O `.txt` exportado contém somente a AST da árvore de missões. Já localization é baixada em arquivo YAML separado.

## Dependências e regras importantes

- `clausewitz.ts` é a fundação. Se ele mudar, `project.ts`, validação, API e toda edição raw podem ser afetados.
- `project.ts` centraliza as alterações estruturais. Por exemplo, renomear uma missão também atualiza os `required_missions` que apontavam para o ID antigo.
- Todos os componentes recebem `mutate`, criado em `Architect`. Essa função clona o projeto, aplica a alteração, cria uma entrada no histórico e dispara autosave.
- O histórico mantém até 40 estados anteriores.
- O autosave é no navegador, via IndexedDB; não há banco de dados nem envio automático ao servidor.
- `Ctrl+S` baixa um backup `.eu4proj`; exportar mission tree baixa o `.txt`.

## Validação

A validação bloqueia exportação em casos como:

- ID de missão ou series inválido/duplicado;
- `position` inválida;
- pré-requisito inexistente;
- ciclo entre missões;
- formato inválido de `required_missions`;
- series fora dos slots 1–5;
- inconsistências de branch;
- regras Portuversalis consideradas obrigatórias.

Warnings não bloqueiam diretamente, mas pedem confirmação. O próprio código deixa claro que algumas coisas exigem revisão humana: scripted triggers/effects, geografia, claims, permissões e a lógica real de branches.

Em particular, “Father/Son” é metadata do editor e do `.eu4proj`; ele não gera automaticamente a lógica Clausewitz necessária para o EU4 exibir ou selecionar essas branches.

## Testes e infraestrutura

- [core.test.ts](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\tests\core.test.ts) testa parser, preservação de blocos desconhecidos, exportação, cópia, validação Portuversalis e DDS.
- [package.json](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\package.json) define `dev`, `build`, `typecheck` e `test`.
- [.gitlab-ci.yml](C:\Users\Flame\Desktop\Meus%20Arquivos\Meus%20Projetos\MissionTreeArchitect\.gitlab-ci.yml) executa instalação, testes, checagem de tipos e build no CI.

Tentei rodar os testes localmente, mas o ambiente bloqueou a criação de processo pelo runner do Node (`spawn EPERM`); não é um erro relatado por uma asserção do projeto.