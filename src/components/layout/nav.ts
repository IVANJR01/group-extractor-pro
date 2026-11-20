import {
  LayoutDashboard,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem { to: string; label: string; icon: LucideIcon }

export const NAV: NavItem[] = [
  { to: '/', label: 'Painel Principal', icon: LayoutDashboard },
  { to: '/extrair-whatsapp', label: 'Extrair do WhatsApp', icon: Sparkles },
];
