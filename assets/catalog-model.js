export function authorLabel(authors) {
  const first = authors.items[0];
  return `${first.family || first.literal}${!authors.complete || authors.items.length > 1 ? ' et al.' : ''}`;
}

export function readingUrl(paper) {
  return paper.reading ? `readings/${paper.reading.split('/').at(-1).replace(/\.md$/, '.html')}` : null;
}

export function arxivUrl(paper) {
  return paper.links.arxiv && paper.links.arxiv !== paper.links.original ? paper.links.arxiv : null;
}

export const publicationKinds = {
  'journal-article':'期刊论文', 'conference-paper':'会议论文', preprint:'预印本',
  book:'专著', 'book-chapter':'专著章节', other:'其他文献',
};
export const comparePapers = (a,b) => b.publication.year-a.publication.year || a.citationKey.localeCompare(b.citationKey,'en');
export const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase();

// The table index and full catalog share field names; this view is never persisted.
export function catalogView(source) {
  const labels = Object.fromEntries(Object.entries(source.taxonomy).map(([key, values]) =>
    [key, Object.fromEntries(values.map(item => [item.id, item.label]))]));
  const papers = Object.entries(source.papers).sort(([,a],[,b])=>comparePapers(a,b)).map(([id,paper]) => {
    const classification = paper.classification;
    const view = { id, title:paper.title, authors:authorLabel(paper.authors), citationKey:paper.citationKey,
      keywords:paper.research.keywords, question:paper.research.question,
      journal:paper.publication.venue, journalShort:paper.publication.venueShort, year:String(paper.publication.year),
      original:paper.links.original, arxiv:arxivUrl(paper), reading:readingUrl(paper),
      metadata:paper, classification,
      topicLabels:classification.topics.map(id=>labels.topics[id]),
      objectLabels:classification.objects.map(id=>labels.objects[id]),
      evidenceLabels:classification.evidenceTypes.map(id=>labels.evidenceTypes[id]),
      venueGroupLabel:labels.venueGroups[classification.venueGroup] || '',
      documentTypeLabel:labels.documentTypes[classification.documentType],
    };
    view.searchText=normalize([view.title,paper.titleZh,view.authors,view.citationKey,
      ...paper.authors.items.flatMap(a=>[a.given,a.family,a.literal]),view.journal,view.journalShort,view.year,view.question,
      ...view.keywords,...view.topicLabels,...view.objectLabels,...view.evidenceLabels,view.venueGroupLabel,
      view.documentTypeLabel,paper.identifiers.doi,paper.identifiers.arxiv].join(' '));
    return view;
  });
  const chapters = source.taxonomy.topics.map(topic => ({id:topic.id, title:topic.label,
    papers:papers.filter(p=>p.classification.topics[0]===topic.id)}));
  return { ...source.library, taxonomy:source.taxonomy, papers, chapters, total:papers.length,
    readingCount:papers.filter(p=>p.reading).length };
}

const values = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
export function filterPapers(papers, filters = {}) {
  const words = normalize(filters.q || '').trim().split(/\s+/).filter(Boolean);
  const selected=Object.fromEntries(['topic','keyword','journal','venue','object','evidence','type','publication','hasReading'].map(key=>[key,values(filters[key])]));
  const matches=(key,items)=>!selected[key].length || selected[key].some(value=>items.includes(value));
  return papers.filter(p => {
    const c=p.classification;
    return matches('topic',c.topics) && matches('keyword',p.keywords) && matches('journal',[p.journal])
      && matches('venue',[c.venueGroup]) && (filters.yearFrom===undefined || Number(p.year)>=filters.yearFrom)
      && (filters.yearTo===undefined || Number(p.year)<=filters.yearTo) && matches('object',c.objects)
      && matches('evidence',c.evidenceTypes) && matches('type',[c.documentType])
      && matches('publication',[p.metadata.publication.kind]) && (!selected.hasReading.length || selected.hasReading.some(value=>String(value)===String(Boolean(p.reading))))
      && words.every(word=>p.searchText.includes(word));
  });
}
