import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {env} from './config.js';
export const db = new pg.Pool({connectionString:env.DATABASE_URL,max:12,connectionTimeoutMillis:5000,statement_timeout:10000});
export async function migrate() {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock(70120101)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY,checksum text NOT NULL, applied_at timestamptz DEFAULT now())');
    for (const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()) {
      const sql = await readFile('migrations/'+name,'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = (await client.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name])).rows[0];
      if (old) {if(old.checksum!==checksum)throw Error('En anvendt migration er ændret: '+name);continue;}
      await client.query('BEGIN');
      try {await client.query(sql);await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT');}
      catch(error){await client.query('ROLLBACK');throw error;}
    }
  } finally {await client.query('SELECT pg_advisory_unlock(70120101)');client.release();}
}
