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
    const fs = require('fs');
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 40 * 1024 * 1024) return null;
    const seen = new Set();
    let input = 0, output = 0, read = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.indexOf('"usage"') < 0) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const m = j && j.message;
      if (!m || !m.usage || j.type !== 'assistant') continue;
      const id = m.id || j.uuid;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const u = m.usage;
      input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      read += u.cache_read_input_tokens || 0;
      output += u.output_tokens || 0;
    }
    return { input_tokens: input, output_tokens: output, cache_read_tokens: read };
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
