import { catalogView } from './catalog-model.js?v=c566e2f3da729c549a80021a02d95aa24e74ce33ce441e9f8a738480377cf6ad';

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
  const paperMap = new Map(catalog.chapters.flatMap(c => c.papers.map(p => [p.id, { ...p, chapterId:c.id }])));
  const tabs = $('tabs'), rows = $('paper-rows'), card = $('paper-card');
  const mobile = window.matchMedia('(max-width: 760px)');
  const hoverDevice = window.matchMedia('(hover: hover) and (pointer: fine)');
  let selected = catalog.chapters[0]?.id;
  let currentPaper = null, anchor = null, pinned = false, hoverTimer, closeTimer, touchTimer, touchOrigin;
  let ignoreClickUntil = 0, restoringFocus = false;
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
  const resource = (label, href, className) => { const a = text('a', label, className); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase();

  $('library-stats').textContent = `${catalog.total} 篇文献 / ${catalog.chapters.length} 个章节 / ${catalog.readingCount} 篇解读`;
  function matches(p) {
    if ($('has-reading').checked && !p.reading) return false;
    const keywords = normalize($('search').value.trim()).split(/\s+/).filter(Boolean);
    const haystack = normalize([p.title,p.metadata.titleZh,p.authors,...p.metadata.authors.items.flatMap(a=>[a.given,a.family,a.literal]),p.journal,p.year,p.direction,p.question,...p.metadata.research.indexTerms,p.metadata.identifiers.doi,p.metadata.identifiers.arxiv].join(' '));
    return keywords.every(word => haystack.includes(word));
  }
  function updateHash(paperId = null) {
    const params = new URLSearchParams({ section:selected });
    if (paperId) params.set('paper', paperId);
    history.replaceState(null, '', `#${params}`);
  }
  for (const chapter of catalog.chapters) {
    const button = text('button', chapter.title, 'tab');
    button.type = 'button'; button.id = `tab-${chapter.id}`; button.dataset.section = chapter.id;
    button.setAttribute('role','tab'); button.setAttribute('aria-controls','papers');
    button.append(text('span', String(chapter.papers.length), 'tab-count'));
    button.addEventListener('click', () => selectChapter(chapter.id));
    tabs.append(button);
  }
  tabs.addEventListener('keydown', event => {
    const buttons = [...tabs.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next === undefined) return;
    event.preventDefault(); buttons[next].focus(); selectChapter(buttons[next].dataset.section);
  });
  function selectChapter(id, syncHash = true) {
    if (!catalog.chapters.some(c => c.id === id)) return;
    closeCard(false, false); selected = id; render();
    if (syncHash) updateHash();
    const tab = $(`tab-${id}`);
    // Scroll only the tab strip, preserving the page's vertical reading position.
    if (tab.offsetLeft < tabs.scrollLeft) tabs.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = tab.offsetLeft + tab.offsetWidth - tabs.clientWidth;
  }
  function render() {
    const chapter = catalog.chapters.find(c => c.id === selected);
    for (const c of catalog.chapters) {
      const tab = $(`tab-${c.id}`);
      tab.setAttribute('aria-selected', String(c.id === selected)); tab.tabIndex = c.id === selected ? 0 : -1;
      tab.querySelector('.tab-count').textContent = c.papers.filter(matches).length;
    }
    $('papers').setAttribute('aria-labelledby', `tab-${selected}`);
    $('chapter-title').textContent = chapter.title;
    $('table-caption').textContent = `${chapter.title}论文表格`;
    const papers = chapter.papers.filter(matches);
    $('result-count').textContent = papers.length === chapter.papers.length ? `${papers.length} 篇文献` : `显示 ${papers.length} / ${chapter.papers.length} 篇文献`;
    $('empty').hidden = papers.length > 0;
    $('clear-search').hidden = !$('search').value;
    const fragment = document.createDocumentFragment();
    for (const paper of papers) {
      const tr = document.createElement('tr'); tr.dataset.paper = paper.id;
      tr.append(text('td',paper.direction,'direction-cell'),text('td',paper.question,'question-cell'),text('td',paper.journal,'journal-cell'),text('td',paper.year,'year-cell'));
      const titleCell = document.createElement('td'); titleCell.className = 'title-cell';
      const button = text('button',paper.title,'paper-title'); button.type='button'; button.dataset.paper = paper.id;
      button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-expanded','false');
      titleCell.append(button,text('p',paper.authors,'authors'));
      const linkCell = document.createElement('td'); linkCell.className = 'links-cell';
      linkCell.append(resource('原文',paper.original));
      if (paper.arxiv) linkCell.append(resource('arXiv',paper.arxiv));
      if (paper.reading) linkCell.append(resource('解读',paper.reading,'reading-link'));
      tr.append(titleCell,linkCell); fragment.append(tr);
    }
    rows.replaceChildren(fragment);
  }
  function filter() { closeCard(false); render(); }
  $('search').addEventListener('input',filter);
  $('has-reading').addEventListener('change',filter);
  $('clear-search').addEventListener('click',() => { $('search').value=''; filter(); $('search').focus(); });
  $('reset-filter').addEventListener('click',() => { $('search').value=''; $('has-reading').checked=false; filter(); });

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
    $('card-title').textContent = paper.title; $('card-direction').textContent = paper.direction;
    $('card-authors').textContent = paper.authors;
    const publication=paper.metadata.publication;
    const issue=publication.volume ? ` ${publication.volume}${publication.issue ? `(${publication.issue})` : ''}` : '';
    const pages=publication.pages || publication.articleNumber;
    $('card-publication').textContent = `${paper.journal}${issue}${pages ? `, ${pages}` : ''} (${paper.year})`;
    $('card-theme').textContent = paper.card.theme || ''; $('card-theme').hidden = !paper.card.theme;
    const sections = [ ['阅读范围',paper.card.coverage], ['研究问题',paper.card.question || paper.question], ['研究方法',paper.card.approach], ['主要发现',paper.card.findings], ['方法与证据',paper.card.overview], ['证据范围',paper.card.scope] ];
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
    const url=new URL(location.href); url.hash=new URLSearchParams({section:currentPaper.chapterId,paper:currentPaper.id}).toString();
    try { await navigator.clipboard.writeText(url.href); $('copy-link').textContent='已复制'; $('copy-status').textContent='论文链接已复制'; }
    catch { $('copy-link').textContent='复制失败'; $('copy-status').textContent='浏览器未允许复制，请打开详情后复制地址栏链接。'; }
  });
  function readHash() {
    const params=new URLSearchParams(location.hash.slice(1)); const paper=paperMap.get(params.get('paper'));
    const id=paper?.chapterId || params.get('section');
    if (id && catalog.chapters.some(c => c.id===id)) selectChapter(id,false); else selectChapter(catalog.chapters[0].id,false);
    if (paper) { const button=rows.querySelector(`button[data-paper="${paper.id}"]`); openCard(paper.id,button,true); }
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
