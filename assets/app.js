import { catalogView, filterPapers, normalize, publicationKinds } from './catalog-model.js?v=58e29ebe3aa01ed7e6aa56a54e772162611a4a07c879fd1f1e44b28a0c5a687e';

async function start() {
  const $ = id => document.getElementById(id);
  const tableVersion=document.querySelector('meta[name="table-version"]').content;
  const readingVersion=document.querySelector('meta[name="reading-version"]').content;
  const response=await fetch(`table-index.json?v=${tableVersion}`);
  if (!response.ok) throw new Error(`文献数据加载失败 (${response.status})`);
  const catalog=catalogView(await response.json());
  $('load-status').hidden=true;
  $('total-count').textContent=`共 ${catalog.total} 篇论文`;
  const paperMap=new Map(catalog.papers.map(p=>[p.id,p]));
  const rows=$('paper-rows'), card=$('paper-card'), panel=$('filter-panel');
  const mobile=window.matchMedia('(max-width: 760px)');
  const hoverDevice=window.matchMedia('(hover: hover) and (pointer: fine)');
  let currentPaper=null, anchor=null, pinned=false, hoverTimer, closeTimer, touchTimer, touchOrigin;
  let suppressTouchClick=false, restoringFocus=false, activeColumn=null, filterAnchor=null;
  const state={}, readingCache=new Map();
  let readingStyles;
  const text=(tag,value,className)=>{const el=document.createElement(tag);el.textContent=value;if(className)el.className=className;return el;};
  const resource=(label,href,className)=>{const a=text('a',label,className);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
  const readingHref=paper=>{const url=new URL(paper.reading,location.href);url.searchParams.set('v',readingVersion);return url.href;};
  const unique=values=>[...new Set(values)];
  const years=catalog.papers.map(p=>Number(p.year)), minYear=Math.min(...years), maxYear=Math.max(...years);
  let tooltipAnchor=null;
  const dimensions={
    topic:catalog.taxonomy.topics,
    keyword:unique(catalog.papers.flatMap(p=>p.keywords)).sort((a,b)=>a.localeCompare(b,'zh-CN')).map(id=>({id,label:id})),
    venue:catalog.taxonomy.venueGroups,
    journal:unique(catalog.papers.map(p=>p.journal)).map(id=>({id,label:catalog.papers.find(p=>p.journal===id).journalShort})).sort((a,b)=>a.label.localeCompare(b.label,'en')),
    publication:Object.entries(publicationKinds).filter(([id])=>catalog.papers.some(p=>p.metadata.publication.kind===id)).map(([id,label])=>({id,label})),
  };
  const columnKeys=column=>column==='journal' ? ['venue','publication','journal'] : column==='year' ? ['yearFrom','yearTo'] : [column];
  const titles={topic:'研究方向',keyword:'关键词',journal:'期刊',year:'年份'};
  const filters=()=>({...state,...($('search').value.trim() ? {q:$('search').value.trim()} : {}),...($('has-reading').checked ? {hasReading:true} : {})});
  function updateHash(paperId=null) {
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(filters()))for(const item of Array.isArray(value)?value:[value])params.append(key,String(item));
    if(paperId)params.set('paper',paperId);
    history.replaceState(null,'',`${location.pathname}${location.search}${params.size?'#'+params:''}`);
  }
  function countOptions(key) {
    const active=filters();delete active[key];
    const available=filterPapers(catalog.papers,active), counts=new Map();
    for(const p of available) {
      const values={topic:p.classification.topics,keyword:p.keywords,venue:[p.classification.venueGroup],journal:[p.journal],publication:[p.metadata.publication.kind]}[key];
      for(const value of values)counts.set(value,(counts.get(value)||0)+1);
    }
    return counts;
  }
  function refreshCounts() {
    if(panel.hidden || activeColumn==='year')return;
    for(const key of columnKeys(activeColumn)) {
      const counts=countOptions(key);
      for(const label of panel.querySelectorAll(`label[data-key="${key}"]`))label.querySelector('.option-count').textContent=counts.get(label.dataset.value)||0;
    }
  }
  function renderOptions() {
    const year=activeColumn==='year';
    $('filter-search').hidden=year;$('filter-options').hidden=year;$('year-filter').hidden=!year;
    if(year){syncYearControls();return;}
    const query=normalize($('filter-search').value.trim()), groups=[];
    for(const key of columnKeys(activeColumn)) {
      const fieldset=document.createElement('fieldset');
      if(activeColumn==='journal')fieldset.append(text('legend',{venue:'期刊组',publication:'出版形式',journal:'期刊或出版渠道'}[key]));
      for(const option of dimensions[key]) {
        if(query && !normalize(`${option.label} ${option.id}`).includes(query))continue;
        const label=text('label','','filter-option');label.dataset.key=key;label.dataset.value=option.id;label.title=option.id;
        const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=option.id;checkbox.checked=state[key]?.includes(option.id)||false;
        checkbox.addEventListener('change',()=>{
          const next=new Set(state[key]||[]);if(checkbox.checked)next.add(option.id);else next.delete(option.id);
          if(next.size)state[key]=[...next];else delete state[key];
          filter();
        });
        const count=text('span','','option-count');count.setAttribute('aria-hidden','true');
        label.append(checkbox,text('span',option.label),count);fieldset.append(label);
      }
      if(fieldset.querySelector('label'))groups.push(fieldset);
    }
    $('filter-options').replaceChildren(...(groups.length?groups:[text('p','没有匹配的选项','option-empty')]));
    refreshCounts();
  }
  function positionFilter() {
    if(panel.hidden || !filterAnchor)return;
    const rect=filterAnchor.getBoundingClientRect();
    panel.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-panel.offsetWidth-8))}px`;
    panel.style.top=`${Math.min(rect.bottom+8,innerHeight-panel.offsetHeight-8)}px`;
  }
  function closeFilter(restore=false) {
    panel.hidden=true;filterAnchor?.setAttribute('aria-expanded','false');
    if(restore)filterAnchor?.focus();activeColumn=null;filterAnchor=null;
  }
  function openFilter(button) {
    if(filterAnchor===button && !panel.hidden){closeFilter(true);return;}
    closeCard(false);closeFilter();hideJournal();
    filterAnchor=button;activeColumn=button.dataset.column;
    $('filter-title').textContent=titles[activeColumn];$('filter-search').value='';
    panel.hidden=false;button.setAttribute('aria-expanded','true');renderOptions();positionFilter();$(activeColumn==='year'?'year-lower':'filter-search').focus({preventScroll:true});
  }
  const yearRange=()=>[state.yearFrom??minYear,state.yearTo??maxYear];
  function syncYearControls() {
    const [from,to]=yearRange();
    for(const [id,value] of [['year-from',from],['year-to',to],['year-lower',from],['year-upper',to]]) {
      const input=$(id);input.min=minYear;input.max=maxYear;input.value=value;input.disabled=minYear===maxYear;
    }
    $('year-lower').setAttribute('aria-valuemax',to);$('year-upper').setAttribute('aria-valuemin',from);
    const span=maxYear-minYear||1;
    $('year-selection').style.left=`${100*(from-minYear)/span}%`;
    $('year-selection').style.right=`${100*(maxYear-to)/span}%`;
    $('year-lower').style.zIndex=from===maxYear?'3':'1';
  }
  function setYearRange(from,to) {
    if(from===minYear && to===maxYear){delete state.yearFrom;delete state.yearTo;}
    else {state.yearFrom=from;state.yearTo=to;}
    syncYearControls();filter();positionFilter();
  }
  function changeYear(endpoint,value) {
    if(value===''){syncYearControls();return;}
    const year=Math.max(minYear,Math.min(maxYear,Math.round(Number(value))));
    if(!Number.isFinite(year)){syncYearControls();return;}
    const [from,to]=yearRange();
    setYearRange(endpoint==='from'?Math.min(year,to):from,endpoint==='to'?Math.max(year,from):to);
  }
  for(const [id,endpoint] of [['year-from','from'],['year-to','to'],['year-lower','from'],['year-upper','to']]) {
    $(id).addEventListener(id.startsWith('year-l')||id==='year-upper'?'input':'change',event=>changeYear(endpoint,event.target.value));
  }
  // Let the native thumbs handle drags; a track click moves the nearer endpoint.
  $('year-slider').addEventListener('pointerdown',event=>{
    if(event.target.matches('input') || minYear===maxYear)return;
    event.preventDefault();const rect=$('year-slider').getBoundingClientRect();
    const value=minYear+Math.round((maxYear-minYear)*Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)));
    const [from,to]=yearRange(),lower=Math.abs(value-from)<=Math.abs(value-to);
    changeYear(lower?'from':'to',value);$(lower?'year-lower':'year-upper').focus();
  });
  for(const button of document.querySelectorAll('.column-filter'))button.addEventListener('click',()=>openFilter(button));
  $('close-filter').addEventListener('click',()=>closeFilter(true));
  $('filter-search').addEventListener('input',renderOptions);
  $('clear-column').addEventListener('click',()=>{for(const key of columnKeys(activeColumn))delete state[key];filter();renderOptions();});
  function render() {
    const active=filters(),papers=filterPapers(catalog.papers,active),chips=[];
    $('result-count').textContent=`${papers.length} / ${catalog.total} 篇文献`;
    for(const [key,values] of Object.entries(state).filter(([key])=>dimensions[key]))for(const value of values) {
      const label=dimensions[key].find(item=>item.id===value).label;
      const button=text('button',`${label} ×`,'filter-chip');button.type='button';button.setAttribute('aria-label',`移除筛选：${label}`);
      button.addEventListener('click',()=>{state[key]=state[key].filter(v=>v!==value);if(!state[key].length)delete state[key];filter();if(!panel.hidden)renderOptions();});chips.push(button);
    }
    if(state.yearFrom!==undefined || state.yearTo!==undefined) {
      const [from,to]=yearRange(),button=text('button',`${from===to?from:`${from}–${to}`} ×`,'filter-chip');button.type='button';button.setAttribute('aria-label','移除年份筛选');
      button.addEventListener('click',()=>setYearRange(minYear,maxYear));chips.push(button);
    }
    $('active-filters').replaceChildren(...chips);
    $('filter-summary').hidden=!chips.length && !active.hasReading;
    $('empty').hidden=papers.length>0;$('clear-search').hidden=!$('search').value;
    for(const button of document.querySelectorAll('.column-filter'))button.classList.toggle('is-active',columnKeys(button.dataset.column).some(key=>state[key]!==undefined));
    const fragment=document.createDocumentFragment();
    for(const paper of papers) {
      const tr=document.createElement('tr');tr.dataset.paper=paper.id;
      const topics=text('td','','direction-cell'),keywords=text('td','','keywords-cell');
      for(const label of paper.topicLabels)topics.append(text('span',label,'topic-tag'));
      for(const keyword of paper.keywords) {
        const button=text('button',keyword,'keyword');button.type='button';button.setAttribute('aria-label',`筛选关键词：${keyword}`);
        button.addEventListener('click',()=>{closeFilter();state.keyword=[keyword];filter();});keywords.append(button);
      }
      const journal=text('td','','journal-cell'),abbreviation=text('button',paper.journalShort,'journal-name');abbreviation.type='button';abbreviation.dataset.fullName=paper.journal;abbreviation.setAttribute('aria-label',paper.journal);journal.append(abbreviation);
      tr.append(topics,keywords,text('td',paper.question,'question-cell'),journal,text('td',paper.year,'year-cell'));
      const titleCell=text('td','','title-cell'),button=text('button',paper.title,'paper-title');button.type='button';button.dataset.paper=paper.id;
      button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
      titleCell.append(button,text('p',paper.authors,'authors'));
      const links=text('td','','links-cell');links.append(resource('原文',paper.original));
      if(paper.arxiv)links.append(resource('arXiv',paper.arxiv));if(paper.reading)links.append(resource('解读',readingHref(paper),'reading-link'));
      tr.append(titleCell,links);fragment.append(tr);
    }
    rows.replaceChildren(fragment);refreshCounts();
  }
  function filter(){hideJournal();closeCard(false,false);render();updateHash();}
  function resetFilters(){for(const key of Object.keys(state))delete state[key];$('search').value='';$('has-reading').checked=false;}
  $('search').addEventListener('input',filter);$('has-reading').addEventListener('change',filter);
  $('clear-search').addEventListener('click',()=>{$('search').value='';filter();$('search').focus();});
  for(const id of ['reset-filter','clear-filters'])$(id).addEventListener('click',()=>{closeFilter();resetFilters();filter();});
  document.addEventListener('pointerdown',event=>{if(!panel.hidden && !panel.contains(event.target) && !event.target.closest('.column-filter'))closeFilter();});
  $('papers').addEventListener('scroll',()=>{hideJournal();positionFilter();if(!card.hidden && !pinned)closeCard(false);},{passive:true});
  window.addEventListener('resize',positionFilter);
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && !panel.hidden){event.preventDefault();closeFilter(true);}});

  function hideJournal() {
    $('journal-tooltip').hidden=true;tooltipAnchor?.removeAttribute('aria-describedby');tooltipAnchor=null;
  }
  function showJournal(button) {
    hideJournal();tooltipAnchor=button;button.setAttribute('aria-describedby','journal-tooltip');
    const tooltip=$('journal-tooltip');tooltip.textContent=button.dataset.fullName;tooltip.hidden=false;
    const rect=button.getBoundingClientRect();
    tooltip.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-tooltip.offsetWidth-8))}px`;
    tooltip.style.top=`${rect.bottom+tooltip.offsetHeight+8<innerHeight?rect.bottom+6:Math.max(8,rect.top-tooltip.offsetHeight-6)}px`;
  }
  rows.addEventListener('pointerover',event=>{const button=event.target.closest('.journal-name');if(button && event.pointerType!=='touch')showJournal(button);});
  rows.addEventListener('pointerout',event=>{if(event.target.closest('.journal-name') && !tooltipAnchor?.contains(event.relatedTarget))hideJournal();});
  rows.addEventListener('focusin',event=>{const button=event.target.closest('.journal-name');if(button)showJournal(button);});
  rows.addEventListener('focusout',event=>{if(event.target.closest('.journal-name'))hideJournal();});
  rows.addEventListener('click',event=>{const button=event.target.closest('.journal-name');if(button)showJournal(button);});
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.journal-name'))hideJournal();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideJournal();});
  window.addEventListener('resize',hideJournal);

  function loadReadingStyles() {
    if(!readingStyles)readingStyles=new Promise((resolve,reject)=>{
      const link=document.createElement('link');link.rel='stylesheet';link.href='assets/katex.min.css';
      link.onload=resolve;link.onerror=()=>{link.remove();readingStyles=null;reject(new Error('公式样式加载失败'));};
      document.head.append(link);
    });
    return readingStyles;
  }
  async function loadCardReading(paper) {
    if(!paper.reading)return;
    $('card-status').hidden=false;$('card-status').textContent='正在加载解读…';$('retry-card').hidden=true;
    if(!readingCache.has(paper.id)) {
      const url=readingHref(paper);
      readingCache.set(paper.id,Promise.all([fetch(url).then(async response=>{
        if(!response.ok)throw new Error(`解读加载失败 (${response.status})`);
        const doc=new DOMParser().parseFromString(await response.text(),'text/html'),body=doc.querySelector('main#reading');
        if(!body)throw new Error('解读页面缺少正文');
        // Keep relative resource links equivalent to opening the standalone page.
        for(const element of body.querySelectorAll('a[href],img[src]')) {
          const attribute=element.matches('a')?'href':'src';
          element.setAttribute(attribute,new URL(element.getAttribute(attribute),url).href);
        }
        return body;
      }),loadReadingStyles()]).then(([body])=>body));
    }
    try {
      const body=await readingCache.get(paper.id);
      if(currentPaper?.id!==paper.id || card.hidden)return;
      $('card-reading').replaceChildren(...[...body.childNodes].map(node=>document.importNode(node,true)));
      $('card-reading').hidden=false;$('card-metadata').hidden=true;$('card-status').hidden=true;
      positionCard();
    } catch(error) {
      readingCache.delete(paper.id);
      if(currentPaper?.id!==paper.id || card.hidden)return;
      $('card-status').textContent='解读加载失败，可重试或直接打开解读页。';$('retry-card').hidden=false;
    }
  }
  $('retry-card').addEventListener('click',()=>{if(currentPaper)loadCardReading(currentPaper);});
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
    closeFilter();
    currentPaper = paper; anchor = button; pinned = pin || mobile.matches;
    if (anchor) anchor.setAttribute('aria-expanded','true');
    $('card-title').textContent = paper.title; $('card-direction').textContent = paper.topicLabels.join(' · ');
    $('card-authors').textContent = paper.authors;
    const publication=paper.metadata.publication;
    const issue=publication.volume ? ` ${publication.volume}${publication.issue ? `(${publication.issue})` : ''}` : '';
    const pages=publication.pages || publication.articleNumber;
    $('card-publication').textContent = `${paper.journal}${issue}${pages ? `, ${pages}` : ''} (${paper.year})`;
    $('card-status').hidden=true; $('retry-card').hidden=true;
    $('card-question').textContent=paper.question;
    $('card-metadata').hidden=false;$('card-reading').hidden=true;$('card-reading').replaceChildren();
    $('card-links').replaceChildren(resource('原文',paper.original));
    if (paper.arxiv) $('card-links').append(resource('arXiv',paper.arxiv));
    if (paper.reading) $('card-links').append(resource('解读',readingHref(paper)));
    $('copy-link').textContent='复制链接'; $('copy-status').textContent='';
    card.classList.toggle('pinned',pinned); card.setAttribute('aria-modal',String(pinned));
    card.hidden=false; $('backdrop').hidden=!pinned; document.body.classList.toggle('dialog-open',pinned);
    card.querySelector('.card-scroll').scrollTop=0;
    positionCard();
    if (pinned) { updateHash(paper.id); $('close-card').focus({preventScroll:true}); }
    loadCardReading(paper);
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
  // A long press can put the backdrop under the finger before touch release.
  // Suppress that gesture's synthetic click, including clicks outside the row.
  document.addEventListener('pointerdown',()=>{suppressTouchClick=false;},{capture:true});
  document.addEventListener('click',event=>{
    if(!suppressTouchClick)return;
    suppressTouchClick=false;event.preventDefault();event.stopPropagation();
  },{capture:true});
  rows.addEventListener('pointerover',event => {
    const button=event.target.closest('.paper-title'); if (!button || !hoverDevice.matches || event.pointerType==='touch') return;
    clearTimeout(closeTimer); clearTimeout(hoverTimer); hoverTimer=setTimeout(() => openCard(button.dataset.paper,button),220);
  });
  rows.addEventListener('pointerout',event => {
    const button=event.target.closest('.paper-title'); if (button && !button.contains(event.relatedTarget)) { clearTimeout(hoverTimer); scheduleClose(); }
  });
  rows.addEventListener('click',event => {
    const button=event.target.closest('.paper-title'); if (!button) return;
    openCard(button.dataset.paper,button,true);
  });
  rows.addEventListener('pointerdown',event => {
    const button=event.target.closest('.paper-title'); if (!button || event.pointerType==='mouse') return;
    clearTimeout(touchTimer); touchOrigin={x:event.clientX,y:event.clientY,id:event.pointerId};
    touchTimer=setTimeout(() => { touchOrigin=null; suppressTouchClick=true; openCard(button.dataset.paper,button,true); },450);
  });
  rows.addEventListener('pointermove',event => {
    if (touchOrigin && Math.hypot(event.clientX-touchOrigin.x,event.clientY-touchOrigin.y)>10) { clearTimeout(touchTimer); touchOrigin=null; suppressTouchClick=true; }
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
      const selected=params.getAll(key).filter(value=>options.some(item=>item.id===value));
      if(selected.length)state[key]=unique(selected);
    }
    const parsedYear=key=>{const value=params.get(key);return value!==null && /^\d{1,4}$/.test(value)?Math.max(minYear,Math.min(maxYear,Number(value))):null;};
    const from=parsedYear('yearFrom')??minYear,to=parsedYear('yearTo')??maxYear;
    if(from!==minYear || to!==maxYear){state.yearFrom=Math.min(from,to);state.yearTo=Math.max(from,to);}
    $('has-reading').checked=params.get('hasReading')==='true';
    const section=params.get('section');
    if(section && !params.has('topic')) {
      const topic=catalog.taxonomy.topics.find(t=>t.id===section || t.legacyIds.includes(section));
      if(topic)state.topic=[topic.id];
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
