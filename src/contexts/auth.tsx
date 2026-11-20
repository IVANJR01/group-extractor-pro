import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState { session: Session | null; user: User | null; loading: boolean; signOut: () => Promise<void> }
const Ctx = createContext<AuthState>({ session: null, user: null, loading: false, signOut: async () => {} });

const DEFAULT_LOCAL_USER: User = {
  id: 'admin-local-id',
  app_metadata: {},
  user_metadata: { full_name: 'Usuário Local' },
  aud: 'authenticated',
  created_at: new Date().toISOString(),
  email: 'admin@group-extractor.local',
  phone: '',
  role: 'authenticated',
  updated_at: new Date().toISOString(),
};

const DEFAULT_LOCAL_SESSION: Session = {
  access_token: 'local-access-token',
  refresh_token: 'local-refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: DEFAULT_LOCAL_USER,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    const saved = localStorage.getItem('gep_auth_session');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return DEFAULT_LOCAL_SESSION;
  });
  const [loading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) {
        setSession(data.session);
        localStorage.setItem('gep_auth_session', JSON.stringify(data.session));
      }
    }).catch(() => {});

    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) {
        setSession(s);
        localStorage.setItem('gep_auth_session', JSON.stringify(s));
      }
    });
    return () => data?.subscription?.unsubscribe();
  }, []);

  return (
    <Ctx.Provider value={{ session, user: session?.user ?? null, loading, signOut: async () => {
      localStorage.removeItem('gep_auth_session');
      await supabase.auth.signOut().catch(() => {});
      setSession(null);
    } }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
