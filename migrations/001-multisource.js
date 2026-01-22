import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log('DATABASE_URL not set, skipping migration');
  process.exit(0);
}

const pool = new Pool({ connectionString });

const MIGRATION = `
-- Add new columns for multi-source support
ALTER TABLE papers ADD COLUMN IF NOT EXISTS doi TEXT;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'arxiv';
ALTER TABLE papers ADD COLUMN IF NOT EXISTS semantic_scholar_id TEXT;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS pmid TEXT;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS journal_name TEXT;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS year INTEGER;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS citation_count INTEGER DEFAULT 0;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS papers_doi_idx ON papers(doi);
CREATE INDEX IF NOT EXISTS papers_pmid_idx ON papers(pmid);
CREATE INDEX IF NOT EXISTS papers_source_idx ON papers(source);
CREATE INDEX IF NOT EXISTS papers_citation_count_idx ON papers(citation_count DESC);

-- Create reading_lists table
CREATE TABLE IF NOT EXISTS reading_lists (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create reading_list_items table
CREATE TABLE IF NOT EXISTS reading_list_items (
  id SERIAL PRIMARY KEY,
  list_id INTEGER REFERENCES reading_lists(id) ON DELETE CASCADE,
  paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(list_id, paper_id)
);

-- Create citations table
CREATE TABLE IF NOT EXISTS citations (
  id SERIAL PRIMARY KEY,
  paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
  cited_paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
  external_id TEXT,
  title TEXT,
  authors TEXT,
  year INTEGER,
  url TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create citations indexes
CREATE INDEX IF NOT EXISTS citations_paper_id_idx ON citations(paper_id);
CREATE INDEX IF NOT EXISTS citations_cited_paper_id_idx ON citations(cited_paper_id);

-- Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  default_style TEXT DEFAULT 'simple',
  preferred_language TEXT DEFAULT 'en',
  export_format TEXT DEFAULT 'bibtex',
  theme TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Running migration...');
    await client.query(MIGRATION);
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(console.error);
