const BASE_URL = 'https://api.crossref.org/v1';

export async function fetchPaperByDOI(doi) {
  const email = process.env.CONTACT_EMAIL || 'example@email.com';
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, '').trim();
  const url = `${BASE_URL}/works/${encodeURIComponent(cleanDoi)}?mailto=${encodeURIComponent(email)}`;
  
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PaperPlain/1.0' }
  });
  
  if (!response.ok) {
    if (response.status === 404) throw new Error('DOI not found');
    throw new Error(`Crossref API error: ${response.status}`);
  }
  
  const data = await response.json();
  const work = data.message;
  
  const authors = work.author 
    ? work.author.map(a => `${a.given || ''} ${a.family || ''}`.trim()).join(', ')
    : 'Unknown Authors';
  
  const year = work.published?.['date-parts']?.[0]?.[0] 
    || work['published-print']?.['date-parts']?.[0]?.[0]
    || work['published-online']?.['date-parts']?.[0]?.[0]
    || null;
  
  const abstract = work.abstract 
    ? work.abstract.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : '';
  
  return {
    title: work.title?.[0] || 'Unknown Title',
    authors,
    abstract,
    doi: work.DOI,
    journal: work['container-title']?.[0] || '',
    year,
    url: work.URL,
    citationCount: work['is-referenced-by-count'] || 0,
    source: 'crossref'
  };
}

export function extractDOI(input) {
  if (!input) return null;
  const patterns = [
    /(10\.\d{4,}\/[^\s]+)/,
    /doi\.org\/(10\.\d{4,}\/[^\s]+)/,
    /DOI[:\s]*(10\.\d{4,}\/[^\s]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function isDOI(input) {
  return extractDOI(input) !== null;
}
