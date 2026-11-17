export function SetupRequired() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Configuração necessária</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Defina <code className="font-mono">VITE_SUPABASE_URL</code> e <code className="font-mono">VITE_SUPABASE_PUBLISHABLE_KEY</code> no arquivo
          <code className="font-mono"> .env.local</code> (local) ou nas variáveis de ambiente da Vercel. Veja <code className="font-mono">docs/deployment.md</code>.
        </p>
      </div>
    </div>
  );
}
