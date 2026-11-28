# Escritório de Agentes

Painel visual (escritório isométrico) que mostra **ao vivo** os agentes do seu Claude Code: trabalhando, ociosos, delegando, aguardando aprovação e concluídos.

Node.js puro, **sem dependências**. Funciona de dois jeitos:

- **Local** (só no seu PC, sem senha): `start.bat` ou `node server.js` → http://127.0.0.1:7777
- **Online** (ex.: `https://agentes.ballestech.com.br`): com **senha** para ver o painel e **token** para o hook enviar eventos.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `server.js` | Servidor: painel, login, tempo real (SSE), recebe eventos |
| `public/index.html`, `public/app.js` | O painel |
| `hook.js` | Hook do Claude Code: envia cada evento ao servidor, em segundo plano |
| `install.js` | Instala/remove o hook no `~/.claude/settings.json` e grava `~/.agentes-office.json` |
| `render.yaml` | Configuração pronta para o Render (plano gratuito) |
| `rooms.example.json` | Exemplo para personalizar as palavras de cada sala (copie para `rooms.json`) |
| `test/test.js` | Testes automáticos (`npm test`) |

## Escritório em 3D

O painel abre em **3D** (WebGL, com a biblioteca three.js, licença MIT, em `public/vendor/`): baias com divisórias, monitores, gaveteiros, estantes, plantas, janelas e bonecos articulados que andam, sentam, digitam e jogam.

- **Arrastar** gira a câmera · **dois dedos** ou **botão direito** movem · **pinça** ou **roda do mouse** dão zoom · **toque numa sala** mostra quem passou · **toque duplo** volta à vista inicial. No controle da TV: setas giram, `+`/`-` dão zoom, `0` volta.
- **Ver em 2D** (botão no topo ou `/?modo-2d`): a versão anterior, mais leve.
- `/?modo-leve`: 3D sem sombras, para aparelhos fracos (TVs já entram assim sozinhas).
- Se o navegador não tiver WebGL, o painel abre em 2D automaticamente.

## Em que sala cada agente fica

O hook lê o seu pedido **no próprio computador** e manda **só o nome da sala** do assunto (ex.: "Copy", "Tráfego"); o texto do pedido nunca sai do PC. O agente fica nessa sala enquanto trabalha, mesmo usando Bash, Read ou Edit. Ferramentas de serviços (Gmail, Canva, anúncios…) puxam para a sala do serviço. Pedido sem assunto claro vai para **Operações**. As palavras de cada assunto estão em `TOPICS`, no `hook.js`.

## Nomes dos agentes

Cada agente aparece com a **função** da sala onde está trabalhando (Desenvolvedor, Copywriter, Gestor de Tráfego, Vendedor…) e uma frase do que está fazendo (editando arquivo, rodando comando, pesquisando na web, usando canva…). Subagentes usam o tipo informado pelo Claude Code (Explorador, Planejador, Assistente geral). O código curto (`#6abf`) diferencia sessões. As funções ficam nos mapas `ROLE` e `SUBROLE` do `server.js`.

## Quadro de uso (tokens e limites)

No céu, perto do sol, um quadro mostra **tokens de hoje e da semana** (UTC-4, semana a partir de segunda) e os **limites do plano**: a janela de **5 horas** e a **semanal**, com a porcentagem usada e quando renovam. Toque no quadro para ver os detalhes.

Esses dados vêm da **barra de status** do Claude Code (`statusline.js`), o único lugar onde o Claude Code entrega uso e limites. O `install.js` instala a barra de status; se você já tinha uma, ela continua aparecendo (fica guardada em `statusline_original` no `~/.agentes-office.json` e volta no `--uninstall`). Só números são enviados (`POST /usage`, mesmo token do hook), no máximo a cada 20 s. Para não instalar: `node install.js --sem-statusline`.

**Economia do context-mode.** Se o plugin [context-mode](https://github.com/mksglu/context-mode) estiver instalado no PC, o `statusline.js` também lê, só para leitura, os bancos dele (`~/.context-mode/projects/*/context.db`, Node 22.13+ ou 24) e soma como o `ctx_stats`: bytes que as ferramentas produziram × bytes que voltaram para a conversa. O quadro mostra os tokens poupados hoje, na semana e no total (4 bytes ≈ 1 token) e a % que ficou fora da conversa. Só os totais saem do PC; o conteúdo dos bancos nunca é enviado.

Observações: a Anthropic não tem limite diário (só 5 horas e semanal); os limites só aparecem em planos Pro/Max e depois da primeira resposta da sessão; os totais ficam na memória do servidor e zeram quando ele reinicia.

**Sessões na nuvem** não têm barra de status: nelas, o hook soma, ao fim de cada resposta, os tokens do histórico da sessão e manda só os números (`POST /usage` com `source: "hook"`). Os limites de 5 h e semanal só chegam pela barra de status do PC. Se a mesma sessão manda pelos dois caminhos, vale a barra de status (não conta duas vezes). O hook da nuvem é baixado pelo script do ambiente em `GET /nuvem-hook.js` (exige o token do hook).

## Segurança

- **Senha do painel** (`PANEL_PASSWORD`): sem ela não se vê nada (`/`, `/events`, `/state`, `/demo`). Login com cookie assinado `HttpOnly`, `Secure` (em HTTPS) e `SameSite=Strict`, válido por 30 dias. Trocar a senha derruba todas as sessões.
- **Token do hook** (`HOOK_TOKEN`): `POST /event` sem `Authorization: Bearer <token>` válido → **401**. Comparação em tempo constante.
- **Modo mínimo** (padrão, no hook e no servidor): só vai o **tipo do evento** e o **nome da ferramenta**. Nada de nome de arquivo, comando, prompt ou pasta. Mesmo que o hook mande detalhe, o servidor em `PANEL_DETAIL=minimo` descarta.
- Limites: corpo de 32 KB, 600 eventos/min por IP, 10 senhas erradas a cada 15 min por IP, 50 conexões ao vivo.
- Cabeçalhos: `Cache-Control: no-store`, `X-Accel-Buffering: no` no SSE, CSP restritiva, `X-Frame-Options: DENY`, HSTS em HTTPS.
- Fora do `127.0.0.1` o servidor **se recusa a iniciar** sem senha e token.
- **Nenhum segredo fica em arquivo versionado.** Senha e token ficam só nas variáveis de ambiente do servidor e no `~/.agentes-office.json` do seu PC.

## O hook nunca atrapalha o Claude Code

O `hook.js` envia o evento e espera no máximo ~1,3 s (trava de segurança de 1,5 s). Sempre sai com código 0 e nunca imprime nada. Se o servidor estiver fora do ar, o evento simplesmente se perde.

Opcional no `~/.agentes-office.json`: `"envio": "segundo_plano"` (o envio sai de um processo filho e o hook termina na hora) e `"log": true` (grava em `~/.agentes-office.log` só horário, evento, ferramenta e resultado; nunca conteúdo).

## Não aparece nada no painel?

Dê dois cliques em `diagnostico.bat` (ou `node install.js --diagnostico`). Ele confere a configuração, os hooks no `settings.json`, o `node` no PATH, roda o `hook.js` como o Claude Code roda e mostra a resposta do servidor (200 = ok, 401 = token errado). Lembre de **fechar e abrir de novo o Claude Code** depois de instalar.

## Colocar online (Render grátis + domínio próprio)

1. **Repositório**: suba esta pasta para um repositório **privado** no GitHub (ex.: `agentes-office`).
2. **Gerar senha e token** (no PC, uma vez):
   ```
   node -e "const c=require('crypto');console.log('PANEL_PASSWORD='+c.randomBytes(18).toString('base64url'));console.log('HOOK_TOKEN='+c.randomBytes(32).toString('base64url'))"
   ```
   Guarde os dois num gerenciador de senhas. Não cole em chat, e-mail ou commit.
3. **Render** (render.com → entrar com GitHub) → **New → Blueprint** → escolha o repositório. O `render.yaml` já configura tudo; o Render vai pedir `PANEL_PASSWORD` e `HOOK_TOKEN` → cole os valores → **Apply**.
4. Teste o endereço `https://agentes-office-XXXX.onrender.com` → deve pedir a senha.
5. **Domínio**: no Render, serviço → **Settings → Custom Domains → Add** → `agentes.ballestech.com.br`. Ele mostra um CNAME (`agentes-office-XXXX.onrender.com`).
6. **DNS (Hostinger)**: crie **só** o registro `CNAME` com nome `agentes` apontando para o endereço do passo 5. Não mexa nos outros registros. Volte ao Render e clique **Verify**; o HTTPS é emitido sozinho em alguns minutos.

## Instalar o hook no PC (Windows)

Na pasta do projeto:

```
node install.js
```

Ele pergunta a URL (`https://agentes.ballestech.com.br`), o nível de detalhe (`minimo`) e o token (digitado **sem aparecer na tela**). Faz backup do `settings.json` e é idempotente. Depois:

```
node install.js --testar
```

Um agente de teste aparece no painel por alguns segundos. **Reinicie as sessões abertas do Claude Code** para os hooks valerem.

## Desligar

```
node install.js --uninstall            (remove só os hooks deste projeto; mantém a configuração)
node install.js --uninstall --purge    (remove também ~/.agentes-office.json)
```

Para tirar o site do ar: no Render, **Suspend** (ou **Delete**) o serviço, e apague o CNAME `agentes` na Hostinger.

## Trocar a senha ou o token

1. Gere novos valores (passo 2 acima).
2. Render → serviço → **Environment** → edite `PANEL_PASSWORD` e/ou `HOOK_TOKEN` → **Save** (reinicia sozinho; o painel recomeça vazio e todos precisam entrar de novo).
3. Se trocou o token: no PC, `node install.js` e cole o token novo.

## Custo

- Render **Free**: R$ 0. Depois de 15 min sem acesso, o servidor dorme; o primeiro evento o acorda em ~1 min (o painel recomeça vazio, eventos desse minuto se perdem).
- Render **Starter** (US$ 7/mês): fica sempre ligado. Basta trocar o plano no Render; nada no código muda.
- Domínio: você já tem.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PANEL_PASSWORD` | — | Senha do painel (mín. 12 caracteres) |
| `HOOK_TOKEN` | — | Token do hook (mín. 24 caracteres) |
| `PORT` / `AGENTS_OFFICE_PORT` | 7777 | Porta |
| `HOST` | 127.0.0.1 | Use `0.0.0.0` atrás do proxy HTTPS |
| `TRUST_PROXY` | — | `1` atrás de proxy (Render) |
| `PANEL_DETAIL` | minimo | `normal` mostra detalhes curtos (não recomendado online) |
| `ROOMS_FILE` | ./rooms.json | Palavras-chave por sala |
