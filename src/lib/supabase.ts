import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://demo.supabase.co';
// Chave pública (publishable/anon). NUNCA colocar a service_role no frontend.
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined || 'sb_publishable_demo_mode_local';

export const isSupabaseConfigured = true;

/** Detecta chave secreta: sb_secret_… ou JWT legado com role=service_role. */
export function isSecretKey(k: string): boolean {
  if (/^sb_secret_/.test(k) || /service_role/.test(k)) return true;
  const parts = k.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

if (key && isSecretKey(key)) {
  throw new Error('Configuração insegura: a chave secreta não pode ser usada no navegador.');
}

export const supabase: SupabaseClient = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
