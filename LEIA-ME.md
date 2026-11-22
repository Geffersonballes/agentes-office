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

## Segurança

- **Senha do painel** (`PANEL_PASSWORD`): sem ela não se vê nada (`/`, `/events`, `/state`, `/demo`). Login com cookie assinado `HttpOnly`, `Secure` (em HTTPS) e `SameSite=Strict`, válido por 30 dias. Trocar a senha derruba todas as sessões.
- **Token do hook** (`HOOK_TOKEN`): `POST /event` sem `Authorization: Bearer <token>` válido → **401**. Comparação em tempo constante.
- **Modo mínimo** (padrão, no hook e no servidor): só vai o **tipo do evento** e o **nome da ferramenta**. Nada de nome de arquivo, comando, prompt ou pasta. Mesmo que o hook mande detalhe, o servidor em `PANEL_DETAIL=minimo` descarta.
- Limites: corpo de 32 KB, 600 eventos/min por IP, 10 senhas erradas a cada 15 min por IP, 50 conexões ao vivo.
- Cabeçalhos: `Cache-Control: no-store`, `X-Accel-Buffering: no` no SSE, CSP restritiva, `X-Frame-Options: DENY`, HSTS em HTTPS.
- Fora do `127.0.0.1` o servidor **se recusa a iniciar** sem senha e token.
- **Nenhum segredo fica em arquivo versionado.** Senha e token ficam só nas variáveis de ambiente do servidor e no `~/.agentes-office.json` do seu PC.

## O hook nunca atrapalha o Claude Code

O `hook.js` lê o evento, entrega a um processo em segundo plano e **sai na hora** (código 0, sem imprimir nada). Quem espera a rede (até 4 s) é o processo em segundo plano. Se o servidor estiver fora do ar, o evento simplesmente se perde. Trava de segurança: o hook nunca passa de 1,5 s.

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
