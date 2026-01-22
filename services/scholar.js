import { searchPapers } from "./semanticscholar.js";

const SCHOLAR_URL_BASE = "https://scholar.google.com";

export function extractScholarQuery(input) {
  if (!input) return null;
  
  input = input.trim();
  
  // Check if it's a Google Scholar URL
  if (input.includes("scholar.google.com")) {
    // Extract search query from URL
    try {
      const url = new URL(input);
      const q = url.searchParams.get("q");
      if (q) return decodeURIComponent(q);
    } catch (e) {
      // Not a valid URL, treat as search query
    }
  }
  
  // If it looks like a search query (contains spaces, not a DOI/PMID format)
  if (!/^10\.\d{4,}/.test(input) && !/^\d{7,9}$/.test(input)) {
    return input;
  }
  
  return null;
}

export function isScholarUrl(input) {
  if (!input) return false;
  return input.includes("scholar.google.com");
}

export async function searchScholarAndGetPaper(query) {
  // Use Semantic Scholar's search to find the paper
  const results = await searchPapers(query, 5);
  
  if (!results.data || results.data.length === 0) {
    throw new Error("Paper not found. Try a more specific search.");
  }
  
  // Return the first (best) match
  const bestMatch = results.data[0];
  
  return {
    title: bestMatch.title || "Unknown Title",
    authors: bestMatch.authors && bestMatch.authors.length > 0
      ? bestMatch.authors.map(a => a.name || `${a.authorId}`).join(", ")
      : "Unknown Authors",
    abstract: bestMatch.abstract || "",
    year: bestMatch.year,
    doi: bestMatch.doi,
    semanticScholarId: bestMatch.paperId,
    citationCount: bestMatch.citationCount || 0,
    url: bestMatch.url || `${SCHOLAR_URL_BASE}/scholar?q=${encodeURIComponent(query)}`,
    openAccessPdf: bestMatch.openAccessPdf || null,
    source: "scholar",
    searchQuery: query
  };
}

export async function findPapersFromScholarUrl(scholarUrl) {
  const query = extractScholarQuery(scholarUrl);
  
  if (!query) {
    throw new Error("Invalid Google Scholar URL or search query");
  }
  
  return searchScholarAndGetPaper(query);
}
