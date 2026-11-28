// Escritório de Agentes: hook para sessões na nuvem (gerado a partir do hook.js).
// Manda só o tipo do evento, a ferramenta, o nome da sala do assunto e, no fim de cada resposta, os totais de tokens.
const q=()=>process.exit(0);process.on('uncaughtException',q);setTimeout(q,1500).unref();
const TOPICS={"CEO IA":["estrategia","estratégia","planejamento","decisao","decisão","meta ","metas","okr","visao","visão","negocio","negócio","plano de"],"Operações":["operacao","operação","processo","planilha","sheets","calendar","agenda","drive","organiz","automatiz","relatorio","relatório"],"Tecnologia":["codigo","código","programa","deploy","servidor","github","repositorio","repositório","commit","bug","erro","api","script","instal","hook","banco de dados","node","python","render","dns","painel","escritório de agentes","token","terminal","powershell"],"Produto":["produto","feature","funcionalidade","roadmap","pesquisa","pesquis","concorrent","mercado","ideia"],"Aquisição":["aquisicao","aquisição","lead","captacao","captação","funil","isca","lista de e"],"Vendas":["venda","proposta","orcamento","orçamento","checkout","stripe","shopify","preço","preco","oferta","cliente novo"],"Follow-up / CRM":["crm","follow","gmail","email","e-mail","hubspot","gohighlevel","whatsapp","mensagem","contato"],"Copy":["copy","texto","headline","roteiro","legenda","post","artigo","carrossel","escrev","reescrev","video","vídeo"],"Landing Pages":["landing","pagina","página","html","css","site","wix","wordpress","layout","design","3d"],"Tráfego":["trafego","tráfego","ads","anuncio","anúncio","campanha","metricool","windsor","instagram","tiktok","facebook","youtube"],"Pós-venda":["pos-venda","pós-venda","suporte","reembolso","onboarding","atendimento"],"Curso IA Professores":["curso","professor","aula","docencia","docência","educacao","educação","aluno","escola"]};
function topicOf(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  let best = 'geral', score = 0;
  for (const room of Object.keys(TOPICS)) {
    let sc = 0;
    for (const w of TOPICS[room]) if (t.includes(w)) sc += w.length;
    if (sc > score) { score = sc; best = room; }
  }
  return best;
}
function usageFromTranscript(file) {
  try {
    const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    const stFile = path.join(os.tmpdir(), 'agentes-office-uso-' + crypto.createHash('sha1').update(file).digest('hex').slice(0, 16) + '.json');
    const fresh = () => ({ off: 0, input: 0, output: 0, read: 0, lastId: '', days: {} });
    let S = fresh();
    try { S = Object.assign(S, JSON.parse(fs.readFileSync(stFile, 'utf8'))); } catch { /* primeira vez */ }
    if (st.size < S.off) S = fresh();   // arquivo novo/recomeçado
    // dia (UTC-4) de cada mensagem, para o quadro separar "hoje" e "semana"
    const OFF4 = 4 * 3600e3, dayOf = (ms) => new Date(ms - OFF4).toISOString().slice(0, 10);
    const MAX = 16 * 1024 * 1024, len = Math.min(MAX, st.size - S.off);
    if (len > 0) {
      const buf = Buffer.alloc(len), fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, buf, 0, len, S.off); } finally { fs.closeSync(fd); }
      const end = buf.lastIndexOf(10);                 // só linhas completas
      if (end >= 0) {
        const text = buf.toString('utf8', 0, end + 1);
        const num = (seg, k) => { const m = new RegExp('"' + k + '":(\\d+)').exec(seg); return m ? Number(m[1]) : 0; };
        let pos = 0;
        while (pos < text.length) {
          let nl = text.indexOf('\n', pos); if (nl < 0) nl = text.length;
          const u = text.indexOf('"usage":{', pos);
          if (u >= 0 && u < nl) {
            const ty = text.indexOf('"type":"assistant"', pos);   // a ordem dos campos varia: procura na linha toda
            if (ty >= pos && ty < nl) {
              const idm = /"id":"(msg_[A-Za-z0-9]+)"/.exec(text.slice(pos, u));
              const id = idm ? idm[1] : '';
              if (!id || id !== S.lastId) {
                const seg = text.slice(u, Math.min(nl, u + 900));
                const iT = num(seg, 'input_tokens') + num(seg, 'cache_creation_input_tokens'), oT = num(seg, 'output_tokens');
                S.input += iT; S.output += oT;
                S.read += num(seg, 'cache_read_input_tokens');
                const tsm = /"timestamp":"([0-9T:.\-]+Z)"/.exec(text.slice(pos, nl));
                const d = dayOf(tsm ? Date.parse(tsm[1]) || Date.now() : Date.now());
                const b = S.days[d] || (S.days[d] = [0, 0]); b[0] += iT; b[1] += oT;
              }
              if (id) S.lastId = id;
            }
          }
          pos = nl + 1;
        }
        S.off += Buffer.byteLength(text, 'utf8');
      }
      const keep = Object.keys(S.days).sort().slice(-15); const nd = {}; keep.forEach((k) => { nd[k] = S.days[k]; }); S.days = nd;
      try { fs.writeFileSync(stFile, JSON.stringify(S)); } catch { /* sem cache */ }
    }
    // hoje e semana (desde segunda), em UTC-4
    const now = Date.now(), today = dayOf(now), dow = (new Date(now - OFF4).getUTCDay() + 6) % 7, monday = dayOf(now - dow * 864e5);
    const sum = (f) => Object.keys(S.days).filter(f).reduce((a, k) => [a[0] + S.days[k][0], a[1] + S.days[k][1]], [0, 0]);
    const td = sum((k) => k === today), wk = sum((k) => k >= monday);
    return { input_tokens: S.input, output_tokens: S.output, cache_read_tokens: S.read,
      today: { input: td[0], output: td[1] }, week: { input: wk[0], output: wk[1] } };
  } catch { return null; }
}
let b='';process.stdin.on('data',c=>b+=c).on('end',()=>{try{const i=JSON.parse(b);
const p={event:i.hook_event_name,session_id:i.session_id,ts:Date.now()};
for(const k of['agent_id','agent_type','tool_name','notification_type'])if(i[k])p[k]=i[k];
if(p.event==='Notification'&&/permiss/i.test(String(i.message||'')))p.needs_approval=true;
if(p.event==='UserPromptSubmit')p.topic=topicOf(i.prompt);
const U='https://agentes.ballestech.com.br',cp=require('child_process');let n=1;const d=()=>{if(--n<=0)q();};
const post=(path,o)=>cp.execFile('curl',['-s','-o','/dev/null','--max-time','1.3','-H','Content-Type: application/json','-d',JSON.stringify(o),U+path],d);
if(p.event==='Stop'&&i.transcript_path){const u=usageFromTranscript(i.transcript_path);if(u){n++;post('/usage',Object.assign({session_id:i.session_id,source:'hook'},u));}}
post('/event',p);
}catch(e){q();}});
