import { Construction } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/ui/feedback';

/** Indicação explícita de recurso ainda não disponível (nada de botões falsos). */
export function ComingSoon({ title, description, phase }: { title: string; description: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState icon={Construction} title="Recurso ainda não disponível" description={`Este módulo será entregue na ${phase}. Nenhuma ação desta tela está ativa ainda.`} />
    </>
  );
}
