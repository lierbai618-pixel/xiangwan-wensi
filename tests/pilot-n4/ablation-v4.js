const fs=require("fs"),path=require("path");
const ROOT=path.resolve(__dirname,"..","..");const ART=path.join(__dirname,"artifacts");
const KEY=process.env.DASHSCOPE_API_KEY,EP="https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const {splitChunks}=require(path.join(ROOT,"cloudfunctions","ingest","index.js"));
const corpus=JSON.parse(fs.readFileSync(path.join(ROOT,"cloudfunctions","chat","corpus.json"),"utf8"));
const regSet=JSON.parse(fs.readFileSync(path.join(ROOT,"phase-g-regression-test.json"),"utf8")).records.filter(r=>r&&r.question);
const bench=JSON.parse(fs.readFileSync(path.join(__dirname,"benchmark.json"),"utf8"));
const src=fs.readFileSync(path.join(__dirname,"source","P-04-confirmation-bias.md"),"utf8");
const all=splitChunks(src,{title:"确认偏差概念卡"}).filter(c=>c.level==="child");
const CROSSREF=/申辩篇|论语|庄子|苏格拉底|井蛙/;
const core=all.filter(c=>!CROSSREF.test(c.content)&&!/在决定是否辞职|第一印象形成后|持仓之后/.test(c.content));
// V4 gate = 域词表 ∪ registry 实体词表（由 registry.source 派生）
const DOMAIN=/偏差|偏见|成见|证据|反证|印证|客观|主观|先入为主|第一印象|确认|验尸|异见|只看|选择性|认知|判断|自己想法|支持自己|封闭|固执/;
const ENTITY=/沃森|Wason|尼克森|Nickerson|2-4-6|综述|认知心理学/i;
const gateOn=q=>DOMAIN.test(q)||ENTITY.test(q);
async function embed(t){const o=[];for(let i=0;i<t.length;i+=10){const r=await fetch(EP,{method:"POST",headers:{Authorization:"Bearer "+KEY,"Content-Type":"application/json"},body:JSON.stringify({model:"text-embedding-v3",input:t.slice(i,i+10),dimensions:1024,encoding_format:"float"})});if(!r.ok)throw new Error(r.status);const d=await r.json();o.push(...d.data.sort((a,b)=>a.index-b.index).map(x=>x.embedding));}return o;}
const cos=(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i];}return d/(Math.sqrt(x)*Math.sqrt(y)||1);};
const ndcg=(f,nr,k)=>{let d=0;for(let i=0;i<f.length&&i<k;i++)if(f[i])d+=1/Math.log2(i+2);let id=0;for(let i=0;i<Math.min(k,nr);i++)id+=1/Math.log2(i+2);return id?d/id:0;};
(async()=>{
const cv=await embed(corpus.map(c=>[c.title,c.source,c.section,c.text,c.summary,(c.tags||[]).join(" "),c.modernUsage].filter(Boolean).join(" ")));
const ci=corpus.map((c,i)=>({book:c.title,kind:"classic",vec:cv[i]}));
const pv=await embed(core.map(c=>c.content));
const pi=core.map((c,i)=>({book:"确认偏差概念卡",kind:"pilot",vec:pv[i]}));
const rv=await embed(regSet.map(r=>r.question));const bv=await embed(bench.questions.map(q=>q.question));
const K=3;let bH=0,aH=0,bM=0,aM=0,intr=0,disp=0;const dl=[];
regSet.forEach((r,i)=>{const q=rv[i];const before=ci.map(it=>({...it,s:cos(q,it.vec)})).sort((a,b)=>b.s-a.s).slice(0,K);
const pool=gateOn(r.question)?ci.concat(pi):ci;const after=pool.map(it=>({...it,s:cos(q,it.vec)})).sort((a,b)=>b.s-a.s).slice(0,K);
const hit=t=>t.some(x=>(r.expected_books||[]).some(b=>x.book&&(x.book===b||x.book.includes(b)||b.includes(x.book))));
const mrr=t=>{for(let j=0;j<t.length;j++)if((r.expected_books||[]).some(b=>t[j].book&&(t[j].book===b||t[j].book.includes(b)||b.includes(t[j].book))))return 1/(j+1);return 0;};
const hB=hit(before),hA=hit(after);if(hB)bH++;if(hA)aH++;bM+=mrr(before);aM+=mrr(after);
if(after.some(x=>x.kind==="pilot"))intr++;if(hB&&!hA){disp++;dl.push(r.id);}});
let h1=0,h3=0,mS=0,nS=0;const miss=[];
bench.questions.forEach((qq,i)=>{const q=bv[i];const pool=gateOn(qq.question)?ci.concat(pi):ci;
const top=pool.map(it=>({...it,s:cos(q,it.vec)})).sort((a,b)=>b.s-a.s).slice(0,K);const f=top.map(t=>t.kind==="pilot");
if(f[0])h1++;if(f.some(Boolean))h3++;else miss.push(qq.qid+" "+qq.question);const fr=f.indexOf(true);mS+=fr>=0?1/(fr+1):0;nS+=ndcg(f,pi.length,K);});
const m=regSet.length,n=bench.questions.length;
const out={variant:"V4_core_only + domain∪entity gate",chunks_indexed:core.length,
regression:{before_hit3:+(bH/m).toFixed(4),after_hit3:+(aH/m).toFixed(4),delta_hit:+((aH-bH)/m).toFixed(4),before_mrr:+(bM/m).toFixed(4),after_mrr:+(aM/m).toFixed(4),delta_mrr:+((aM-bM)/m).toFixed(4),intrusion_rate:+(intr/m).toFixed(4),displaced:disp,displaced_ids:dl,pass:disp===0&&aH>=bH},
benchmark:{hit_at_1:+(h1/n).toFixed(4),hit_at_3:+(h3/n).toFixed(4),mrr:+(mS/n).toFixed(4),ndcg_at_3:+(nS/n).toFixed(4),missed:miss,pass:h3/n>=0.9}};
out.gate_overall=out.regression.pass&&out.benchmark.pass;
console.log(JSON.stringify(out,null,2));
const ab=JSON.parse(fs.readFileSync(path.join(ART,"ablation.json"),"utf8"));ab.variants.V4_core_domain_entity_gate=out;
fs.writeFileSync(path.join(ART,"ablation.json"),JSON.stringify(ab,null,2),"utf8");
})().catch(e=>{console.error("FAIL",e.message);process.exit(1);});
