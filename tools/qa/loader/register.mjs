// Registers tools/qa/loader/hooks.mjs. Call registerLoader() before the first import() of app code.
//   registerLoader()                 builders only (pure modules; no fakes needed)
//   registerLoader({ parity: true }) also swap Next.js, Supabase, email, the clock... for fakes
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = (f) => path.join(here, '..', 'fakes', f);

export const PARITY_FAKES = {
  'next/server': fake('next-server.mjs'),
  'next/navigation': fake('next-navigation.mjs'),
  'next/cache': fake('next-cache.mjs'),
  '@/lib/supabase/server': fake('supabase.mjs'),
  '@/lib/supabase/admin': fake('supabase.mjs'),
  '@supabase/supabase-js': fake('supabase.mjs'),
  '@/lib/rate-limit': fake('rate-limit.mjs'),
  '@/lib/email': fake('email.mjs'),
  '@/lib/notifications': fake('notifications.mjs'),
  '@/lib/nfl-utils': fake('nfl-utils.mjs'),
};

let done = false;
export function registerLoader({ parity = false } = {}) {
  if (done) return;
  done = true;
  register(pathToFileURL(path.join(here, 'hooks.mjs')).href, { data: { fakes: parity ? PARITY_FAKES : {} } });
}
