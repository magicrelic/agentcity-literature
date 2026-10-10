export function authorLabel(authors) {
  const first = authors.items[0];
  return `${first.family || first.literal}${!authors.complete || authors.items.length > 1 ? ' et al.' : ''}`;
}

export function readingUrl(paper) {
  return paper.reading ? `readings/${paper.reading.split('/').at(-1).replace(/\.md$/, '.html')}` : null;
}

export function arxivUrl(paper) {
  return paper.access.original === 'subscription' ? paper.links.arxiv : null;
}

// This is an in-memory view, never a second stored copy of the literature catalog.
export function catalogView(source, cards = {}) {
  const chapters = source.chapters.map(chapter => ({
    id: chapter.id, title: chapter.title, description: chapter.description,
    papers: chapter.paperIds.map(id => {
      const paper = source.papers[id];
      return { id, title:paper.title, authors:authorLabel(paper.authors),
        direction:paper.research.direction, question:paper.research.question,
        journal:paper.publication.venue, year:String(paper.publication.year),
        original:paper.links.original, arxiv:arxivUrl(paper), reading:readingUrl(paper),
        card:cards[id] || {}, metadata:paper };
    }),
  }));
  return { ...source.library, chapters, total:Object.keys(source.papers).length,
    readingCount:Object.values(source.papers).filter(p => p.reading).length };
}
