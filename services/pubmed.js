const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export async function fetchPaperByPMID(pmid, apiKey = null) {
  if (!pmid || !/^\d{7,9}$/.test(pmid)) {
    throw new Error('Invalid PMID format');
  }
  
  const params = new URLSearchParams({
    db: 'pubmed',
    id: pmid,
    retmode: 'json'
  });
  
  if (apiKey) {
    params.append('api_key', apiKey);
  }
  
  const summaryUrl = `${BASE_URL}/esummary.fcgi?${params}`;
  const summaryRes = await fetch(summaryUrl, {
    headers: { 'User-Agent': 'PaperPlain/1.0' }
  });
  
  if (!summaryRes.ok) {
    throw new Error('PubMed API error');
  }
  
  const summary = await summaryRes.json();
  
  if (!summary.result || !summary.result[pmid]) {
    throw new Error('PMID not found');
  }
  
  const record = summary.result[pmid];
  
  const abstractParams = new URLSearchParams({
    db: 'pubmed',
    id: pmid,
    rettype: 'abstract',
    retmode: 'text'
  });
  
  const abstractRes = await fetch(`${BASE_URL}/efetch.fcgi?${abstractParams}`, {
    headers: { 'User-Agent': 'PaperPlain/1.0' }
  });
  
  let abstract = '';
  if (abstractRes.ok) {
    const text = await abstractRes.text();
    abstract = text.replace(/^Abstract\n/, '').replace(/\n\n/g, ' ').trim();
  }
  
  const authors = record.authors && record.authors.length > 0
    ? record.authors.map(a => a.name || `${a.forename || ''} ${a.surname || ''}`.trim()).join(', ')
    : 'Unknown Authors';
  
  const year = record.pubdate ? parseInt(record.pubdate.replace(/\D/g, '').slice(0, 4)) : null;
  
  const meshTerms = record.mesh_terms 
    ? record.mesh_terms.map(t => t.name || t).filter(Boolean)
    : [];
  
  return {
    title: record.title || 'Unknown Title',
    authors,
    abstract,
    pmid: String(record.uid),
    journal: record.source || '',
    year,
    meshTerms,
    pmcid: record.pmcid || null,
    citationCount: record.citedby_count || 0,
    source: 'pubmed'
  };
}

export function extractPMID(input) {
  if (!input) return null;
  
  const patterns = [
    /pubmed\/(\d{7,9})/,
    /\/pubmed\/(\d{7,9})/,
    /pmid[:\s]*(\d{7,9})/i,
    /^\s*(\d{7,9})\s*$/m
  ];
  
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function isPMID(input) {
  return extractPMID(input) !== null;
}
