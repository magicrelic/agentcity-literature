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
export const readingStates = {
  none:'待解读', metadata:'书目级解读', abstract:'摘要解读', full:'正文解读', unknown:'阅读范围待核对',
};

function readingState(paper, card) {
  if (!paper.reading) return 'none';
  const scope = card.coverage || '';
  if (/仅书目信息/.test(scope)) return 'metadata';
  if (/仅摘要/.test(scope)) return 'abstract';
  if (/正文|全文/.test(scope)) return 'full';
  return 'unknown';
}

// Views are derived from one record per paper; topic order sets the print/EPUB chapter.
export function catalogView(source, cards = {}) {
  const labels = Object.fromEntries(Object.entries(source.taxonomy).map(([key, values]) =>
    [key, Object.fromEntries(values.map(item => [item.id, item.label]))]));
  const papers = Object.entries(source.papers).sort(([,a],[,b]) => a.citationKey.localeCompare(b.citationKey)).map(([id,paper]) => {
    const classification = paper.classification, card = cards[id] || {};
    return { id, title:paper.title, authors:authorLabel(paper.authors),
      direction:paper.research.direction, question:paper.research.question,
      journal:paper.publication.venue, year:String(paper.publication.year),
      original:paper.links.original, arxiv:arxivUrl(paper), reading:readingUrl(paper),
      card, metadata:paper, classification, readingState:readingState(paper,card),
      topicLabels:classification.topics.map(id=>labels.topics[id]),
      objectLabels:classification.objects.map(id=>labels.objects[id]),
      evidenceLabels:classification.evidenceTypes.map(id=>labels.evidenceTypes[id]),
      venueGroupLabel:labels.venueGroups[classification.venueGroup],
      documentTypeLabel:labels.documentTypes[classification.documentType],
    };
  });
  const chapters = source.taxonomy.topics.map(topic => ({id:topic.id, title:topic.label,
    papers:papers.filter(p=>p.classification.topics[0]===topic.id)}));
  return { ...source.library, taxonomy:source.taxonomy, papers, chapters, total:papers.length,
    readingCount:papers.filter(p=>p.reading).length };
}

const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase();
export function filterPapers(papers, filters = {}) {
  const keywords = normalize(filters.q || '').trim().split(/\s+/).filter(Boolean);
  return papers.filter(p => {
    const c = p.classification;
    if (filters.topic && !c.topics.includes(filters.topic)) return false;
    if (filters.object && !c.objects.includes(filters.object)) return false;
    if (filters.evidence && !c.evidenceTypes.includes(filters.evidence)) return false;
    if (filters.venue && c.venueGroup !== filters.venue) return false;
    if (filters.type && c.documentType !== filters.type) return false;
    if (filters.publication && p.metadata.publication.kind !== filters.publication) return false;
    if (filters.year && p.year !== filters.year) return false;
    if (filters.reading && p.readingState !== filters.reading) return false;
    if (!keywords.length) return true;
    const haystack = normalize([p.title,p.metadata.titleZh,p.authors,
      ...p.metadata.authors.items.flatMap(a=>[a.given,a.family,a.literal]),p.journal,p.year,p.direction,p.question,
      ...p.topicLabels,...p.objectLabels,...p.evidenceLabels,p.venueGroupLabel,p.documentTypeLabel,
      ...p.metadata.research.indexTerms,p.metadata.identifiers.doi,p.metadata.identifiers.arxiv].join(' '));
    return keywords.every(word=>haystack.includes(word));
  });
}
