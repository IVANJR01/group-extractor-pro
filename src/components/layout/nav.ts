import {
  LayoutDashboard, Upload, Database, Users, Copy, Filter, UsersRound, Send, BarChart3, History, Settings, ClipboardList, type LucideIcon,
} from 'lucide-react';

export interface NavItem { to: string; label: string; icon: LucideIcon }

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/importar', label: 'Importar contatos', icon: Upload },
  { to: '/fontes', label: 'Fontes de contatos', icon: Database },
  { to: '/contatos', label: 'Central de contatos', icon: Users },
  { to: '/duplicidades', label: 'Duplicidades', icon: Copy },
  { to: '/segmentos', label: 'Segmentação', icon: Filter },
  { to: '/grupos', label: 'Grupos de destino', icon: UsersRound },
  { to: '/inscricoes', label: 'Páginas de inscrição', icon: ClipboardList },
  { to: '/convites', label: 'Convites', icon: Send },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/historico', label: 'Histórico', icon: History },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];
