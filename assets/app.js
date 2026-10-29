import { catalogView, filterPapers, publicationKinds, readingStates } from './catalog-model.js?v=62c3ec635a559835c6d1a91617fffe24709898c702c4c2f9431ec29526fdbcdb';

async function start() {
  const versions=['catalog-version','reading-version'].map(name=>document.querySelector(`meta[name="${name}"]`).content);
  const [source,cards]=await Promise.all(['catalog.json','reading-cards.json'].map(async (file,i)=>{
    const response=await fetch(`${file}?v=${versions[i]}`);
    if (!response.ok) throw new Error(`文献数据加载失败 (${response.status})`);
    return response.json();
  }));
  const catalog = catalogView(source,cards);
  document.getElementById('load-status').hidden=true;
  const $ = id => document.getElementById(id);
  const paperMap = new Map(catalog.papers.map(p=>[p.id,p]));
  const rows = $('paper-rows'), card = $('paper-card');
  const mobile = window.matchMedia('(max-width: 760px)');
  const hoverDevice = window.matchMedia('(hover: hover) and (pointer: fine)');
  let currentPaper = null, anchor = null, pinned = false, hoverTimer, closeTimer, touchTimer, touchOrigin;
  let ignoreClickUntil = 0, restoringFocus = false;
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
  const resource = (label, href, className) => { const a = text('a', label, className); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  const entries = object=>Object.entries(object).map(([id,label])=>({id,label}));
  const dimensions = {
    venue:catalog.taxonomy.venueGroups, topic:catalog.taxonomy.topics,
    object:catalog.taxonomy.objects, evidence:catalog.taxonomy.evidenceTypes,
    type:catalog.taxonomy.documentTypes, publication:entries(publicationKinds),
    year:[...new Set(catalog.papers.map(p=>p.year))].sort((a,b)=>b-a).map(id=>({id,label:id})),
    reading:entries(readingStates),
  };
  const allLabels={venue:'全部期刊组',topic:'全部主题',object:'全部研究对象',evidence:'全部方法与证据',type:'全部文章类型',publication:'全部出版形式',year:'全部年份',reading:'全部阅读状态'};
  for (const [key,options] of Object.entries(dimensions)) {
    const select=$(`filter-${key}`), all=text('option',allLabels[key]); all.value=''; select.append(all);
    for (const item of options) {const option=text('option',item.label);option.value=item.id;select.append(option);}
    select.addEventListener('change',filter);
  }
  const filters = ()=>Object.fromEntries([['q',$('search').value.trim()],...Object.keys(dimensions).map(key=>[key,$(`filter-${key}`).value])].filter(([,value])=>value));
  $('library-stats').textContent = `${catalog.total} 篇文献 · ${catalog.readingCount} 篇已有解读`;
  function updateHash(paperId = null) {
    const params = new URLSearchParams(filters());
    if (paperId) params.set('paper', paperId);
    history.replaceState(null, '', `${location.pathname}${location.search}${params.size ? '#'+params : ''}`);
  }
  function render() {
    const active=filters(), papers=filterPapers(catalog.papers,active);
    for (const [key,options] of Object.entries(dimensions)) {
      const other={...active};delete other[key];
      const available=filterPapers(catalog.papers,other),select=$(`filter-${key}`);
      select.options[0].textContent=`${allLabels[key]} (${available.length})`;
      options.forEach((item,i)=>{
        const count=filterPapers(available,{[key]:item.id}).length;
        select.options[i+1].textContent=`${item.label} (${count})`;
      });
    }
    $('chapter-title').textContent = active.topic ? catalog.taxonomy.topics.find(t=>t.id===active.topic).label : '全部文献';
    $('table-caption').textContent = '文献与多维分类';
    $('result-count').textContent = `${papers.length} / ${catalog.total} 篇文献`;
    $('active-filters').replaceChildren(...Object.entries(active).map(([key,value])=>{
      const label=key==='q' ? `检索：${value}` : dimensions[key].find(item=>item.id===value)?.label;
      const button=text('button',`${label} ×`,'filter-chip');button.type='button';button.setAttribute('aria-label',`移除筛选：${label}`);
      button.addEventListener('click',()=>{if(key==='q')$('search').value='';else $(`filter-${key}`).value='';filter();});
      return button;
    }));
    $('clear-filters').hidden = !Object.keys(active).length;
    $('empty').hidden = papers.length > 0;
    $('clear-search').hidden = !$('search').value;
    const fragment = document.createDocumentFragment();
    for (const paper of papers) {
      const tr = document.createElement('tr'); tr.dataset.paper = paper.id;
      const topics=text('td','','direction-cell');
      for(const label of paper.topicLabels)topics.append(text('span',label,'topic-tag'));
      const journal=text('td',paper.journal,'journal-cell');journal.append(text('p',paper.venueGroupLabel,'venue-group'));
      tr.append(topics,text('td',paper.question,'question-cell'),journal,text('td',paper.year,'year-cell'));
      const titleCell = document.createElement('td'); titleCell.className = 'title-cell';
      const button = text('button',paper.title,'paper-title'); button.type='button'; button.dataset.paper = paper.id;
      button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-expanded','false');
      titleCell.append(button,text('p',paper.authors,'authors'),text('p',`${paper.objectLabels.join(' · ')} · ${paper.documentTypeLabel}`,'paper-meta'));
      const linkCell = document.createElement('td'); linkCell.className = 'links-cell';
      linkCell.append(resource('原文',paper.original));
      if (paper.arxiv) linkCell.append(resource('arXiv',paper.arxiv));
      if (paper.reading) linkCell.append(resource('解读',paper.reading,'reading-link'));
      linkCell.append(text('span',readingStates[paper.readingState],'reading-state'));
      tr.append(titleCell,linkCell); fragment.append(tr);
    }
    rows.replaceChildren(fragment);
  }
  function filter() { closeCard(false,false); render(); updateHash(); }
  function resetFilters() { $('search').value=''; for(const key of Object.keys(dimensions))$(`filter-${key}`).value=''; }
  $('search').addEventListener('input',filter);
  $('clear-search').addEventListener('click',() => { $('search').value=''; filter(); $('search').focus(); });
  for(const id of ['reset-filter','clear-filters'])$(id).addEventListener('click',() => { resetFilters(); filter(); });

  function positionCard() {
    if (!anchor || pinned || card.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const width = card.offsetWidth, height = card.offsetHeight, gap=14;
    let left = rect.right + gap;
    if (left + width > innerWidth - 16) left = rect.left - width - gap;
    left = Math.max(16, Math.min(left, innerWidth - width - 16));
    const top = Math.max(16, Math.min(rect.top - 16, innerHeight - height - 16));
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  }
  function openCard(id, button, pin = false) {
    clearTimeout(hoverTimer); clearTimeout(closeTimer);
    if (pinned && !pin) return;
    const paper = paperMap.get(id); if (!paper) return;
    if (anchor) anchor.setAttribute('aria-expanded','false');
    currentPaper = paper; anchor = button; pinned = pin || mobile.matches;
    if (anchor) anchor.setAttribute('aria-expanded','true');
    $('card-title').textContent = paper.title; $('card-direction').textContent = paper.topicLabels.join(' · ');
    $('card-authors').textContent = paper.authors;
    const publication=paper.metadata.publication;
    const issue=publication.volume ? ` ${publication.volume}${publication.issue ? `(${publication.issue})` : ''}` : '';
    const pages=publication.pages || publication.articleNumber;
    $('card-publication').textContent = `${paper.journal}${issue}${pages ? `, ${pages}` : ''} (${paper.year})`;
    $('card-theme').textContent = paper.card.theme || ''; $('card-theme').hidden = !paper.card.theme;
    const sections = [ ['分类',`${paper.venueGroupLabel} · ${paper.documentTypeLabel}\n${paper.objectLabels.join(' · ')}\n${paper.evidenceLabels.join(' · ')}`], ['阅读状态',readingStates[paper.readingState]], ['阅读范围',paper.card.coverage], ['研究问题',paper.card.question || paper.question], ['研究方法',paper.card.approach], ['主要发现',paper.card.findings], ['方法与证据',paper.card.overview], ['证据范围',paper.card.scope] ];
    $('card-sections').replaceChildren(...sections.filter(([,value]) => value).map(([name,value]) => { const section=text('section','', 'card-section'); section.append(text('h3',name),text('p',value)); return section; }));
    $('card-links').replaceChildren(resource('原文',paper.original));
    if (paper.arxiv) $('card-links').append(resource('arXiv',paper.arxiv));
    if (paper.reading) $('card-links').append(resource('解读',paper.reading));
    $('copy-link').textContent='复制链接'; $('copy-status').textContent='';
    card.classList.toggle('pinned',pinned); card.setAttribute('aria-modal',String(pinned));
    card.hidden=false; $('backdrop').hidden=!pinned; document.body.classList.toggle('dialog-open',pinned);
    card.querySelector('.card-scroll').scrollTop=0;
    positionCard();
    if (pinned) { updateHash(paper.id); $('close-card').focus({preventScroll:true}); }
  }
  function closeCard(restoreFocus = true, syncHash = true) {
    clearTimeout(hoverTimer); clearTimeout(closeTimer); clearTimeout(touchTimer);
    const wasPinned=pinned, previous=anchor;
    card.hidden=true; $('backdrop').hidden=true; document.body.classList.remove('dialog-open');
    if (previous) previous.setAttribute('aria-expanded','false');
    pinned=false; anchor=null; currentPaper=null;
    if (wasPinned && syncHash) updateHash();
    if (wasPinned && restoreFocus && previous?.isConnected) {
      restoringFocus=true; previous.focus({preventScroll:true}); restoringFocus=false;
    }
  }
  function scheduleClose() { if (!pinned) { clearTimeout(closeTimer); closeTimer=setTimeout(() => closeCard(false),240); } }
  rows.addEventListener('pointerover',event => {
    const button=event.target.closest('.paper-title'); if (!button || !hoverDevice.matches || event.pointerType==='touch') return;
    clearTimeout(closeTimer); clearTimeout(hoverTimer); hoverTimer=setTimeout(() => openCard(button.dataset.paper,button),220);
  });
  rows.addEventListener('pointerout',event => {
    const button=event.target.closest('.paper-title'); if (button && !button.contains(event.relatedTarget)) { clearTimeout(hoverTimer); scheduleClose(); }
  });
  rows.addEventListener('click',event => {
    const button=event.target.closest('.paper-title'); if (!button || Date.now()<ignoreClickUntil) return;
    openCard(button.dataset.paper,button,true);
  });
  rows.addEventListener('pointerdown',event => {
    const button=event.target.closest('.paper-title'); if (!button || event.pointerType==='mouse') return;
    clearTimeout(touchTimer); touchOrigin={x:event.clientX,y:event.clientY,id:event.pointerId};
    touchTimer=setTimeout(() => { touchOrigin=null; ignoreClickUntil=Date.now()+700; openCard(button.dataset.paper,button,true); },450);
  });
  rows.addEventListener('pointermove',event => {
    if (touchOrigin && Math.hypot(event.clientX-touchOrigin.x,event.clientY-touchOrigin.y)>10) { clearTimeout(touchTimer); touchOrigin=null; ignoreClickUntil=Date.now()+500; }
  },{passive:true});
  for (const name of ['pointerup','pointercancel']) rows.addEventListener(name,() => { clearTimeout(touchTimer); touchOrigin=null; });
  rows.addEventListener('contextmenu',event => { if (event.target.closest('.paper-title')) event.preventDefault(); });
  rows.addEventListener('focusin',event => { const button=event.target.closest('.paper-title'); if (!restoringFocus && button && button.matches(':focus-visible') && hoverDevice.matches) openCard(button.dataset.paper,button); });
  rows.addEventListener('focusout',event => { if (!card.contains(event.relatedTarget)) scheduleClose(); });
  card.addEventListener('pointerenter',() => clearTimeout(closeTimer));
  card.addEventListener('pointerleave',scheduleClose);
  $('close-card').addEventListener('click',() => closeCard());
  $('backdrop').addEventListener('click',() => closeCard());
  document.addEventListener('keydown',event => {
    if (card.hidden) return;
    if (event.key==='Escape') { event.preventDefault(); closeCard(); }
    if (event.key==='Tab' && pinned) {
      const focusables=[...card.querySelectorAll('button,a[href]')]; const first=focusables[0], last=focusables.at(-1);
      if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('pointerdown',event => { if (!pinned && !card.hidden && !card.contains(event.target) && !event.target.closest('.paper-title')) closeCard(false); });
  window.addEventListener('scroll',() => { if (!card.hidden && !pinned) closeCard(false); },{passive:true});
  window.addEventListener('resize',() => { if (!card.hidden && mobile.matches && !pinned) openCard(currentPaper.id,anchor,true); else positionCard(); });
  $('copy-link').addEventListener('click',async () => {
    if (!currentPaper) return;
    const url=new URL(location.href); url.hash=new URLSearchParams({paper:currentPaper.id}).toString();
    try { await navigator.clipboard.writeText(url.href); $('copy-link').textContent='已复制'; $('copy-status').textContent='论文链接已复制'; }
    catch { $('copy-link').textContent='复制失败'; $('copy-status').textContent='浏览器未允许复制，请打开详情后复制地址栏链接。'; }
  });
  function readHash() {
    const params=new URLSearchParams(location.hash.slice(1));
    resetFilters();
    $('search').value=params.get('q') || '';
    for(const [key,options] of Object.entries(dimensions)) {
      const value=params.get(key);
      if(options.some(item=>item.id===value))$(`filter-${key}`).value=value;
    }
    const section=params.get('section');
    if(section && !params.has('topic')) {
      const topic=catalog.taxonomy.topics.find(t=>t.id===section || t.legacyIds.includes(section));
      if(topic)$('filter-topic').value=topic.id;
    }
    const paper=paperMap.get(params.get('paper'));
    if(paper && !filterPapers([paper],filters()).length)resetFilters();
    closeCard(false,false);render();
    if(paper)openCard(paper.id,rows.querySelector(`button[data-paper="${paper.id}"]`),true);
  }
  window.addEventListener('hashchange',readHash);
  readHash();
}
start().catch(error=>{
  const status=document.getElementById('load-status');
  status.hidden=false; status.textContent='文献暂时未能加载，请刷新页面重试。';
  status.setAttribute('role','alert');
  console.error(error);
});
