const BASE_URL = 'https://api.semanticscholar.org/graph/v1';

const DEFAULT_FIELDS = [
  'paperId', 'title', 'authors', 'abstract', 'year', 
  'citationCount', 'referenceCount', 'citations', 
  'references', 'fieldsOfStudy', 'openAccessPdf', 'url',
  'venue', 'journal', 'arxivId', 'doi'
].join(',');

export async function fetchPaper(paperId, fields = DEFAULT_FIELDS) {
  const url = new URL(`${BASE_URL}/paper/${encodeURIComponent(paperId)}`);
  url.searchParams.set('fields', fields);
  
  const headers = { 'User-Agent': 'PaperPlain/1.0' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
  
  const response = await fetch(url.toString(), { headers });
  
  if (!response.ok) {
    if (response.status === 404) throw new Error('Paper not found');
    throw new Error(`Semantic Scholar API error: ${response.status}`);
  }
  
  return response.json();
}

export async function searchPapers(query, limit = 10, fields = DEFAULT_FIELDS) {
  const url = new URL(`${BASE_URL}/paper/search`);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', Math.min(limit, 100));
  url.searchParams.set('fields', fields);
  
  const headers = { 'User-Agent': 'PaperPlain/1.0' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
  
  const response = await fetch(url.toString(), { headers });
  
  if (!response.ok) {
    const error = new Error(`Semantic Scholar search error: ${response.status}`);
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }

  return response.json();
}

export async function getCitations(paperId, limit = 100) {
  const url = new URL(`${BASE_URL}/paper/${encodeURIComponent(paperId)}/citations`);
  url.searchParams.set('fields', 'paperId,title,authors,year,citationCount,url');
  url.searchParams.set('limit', Math.min(limit, 1000));
  
  const headers = { 'User-Agent': 'PaperPlain/1.0' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
  
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) return [];
  
  const data = await response.json();
  return data.data || [];
}

export async function getReferences(paperId, limit = 100) {
  const url = new URL(`${BASE_URL}/paper/${encodeURIComponent(paperId)}/references`);
  url.searchParams.set('fields', 'paperId,title,authors,year,citationCount,url');
  url.searchParams.set('limit', Math.min(limit, 1000));
  
  const headers = { 'User-Agent': 'PaperPlain/1.0' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
  
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) return [];
  
  const data = await response.json();
  return data.data || [];
}

export async function getRelatedPapers(paperId, limit = 10) {
  const url = new URL(`${BASE_URL}/paper/${encodeURIComponent(paperId)}/similar`);
  url.searchParams.set('fields', 'paperId,title,authors,year,citationCount,url');
  url.searchParams.set('limit', Math.min(limit, 100));
  
  const headers = { 'User-Agent': 'PaperPlain/1.0' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }
  
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) return [];
  
  const data = await response.json();
  return data.data || [];
}

export function normalizePaperId(id) {
  if (!id) return null;
  
  if (id.startsWith('arXiv:') || /^\d{4}\.\d{4,5}$/.test(id)) {
    return id.replace('arXiv:', '');
  }
  
  return id;
}

export function paperToSchema(data) {
  return {
    title: data.title || 'Unknown Title',
    authors: data.authors && data.authors.length > 0
      ? data.authors.map(a => a.name || `${a.authorId}`).join(', ')
      : 'Unknown Authors',
    abstract: data.abstract || '',
    year: data.year,
    doi: data.doi,
    arxivId: data.arxivId,
    semanticScholarId: data.paperId,
    citationCount: data.citationCount || 0,
    fieldsOfStudy: data.fieldsOfStudy || [],
    openAccessPdf: data.openAccessPdf?.url || null,
    url: data.url,
    journal: data.journal || data.venue || ''
  };
}
