# Integrações

## WhatsApp
Interface `WhatsAppIntegration` (`src/integrations/whatsapp/types.ts`).

Hoje existe **apenas o adaptador manual**: o sistema monta a mensagem e abre `https://wa.me/<telefone>?text=...`. A pessoa usuária revisa e envia no próprio WhatsApp. O registro fica como "compartilhado".

Uma integração futura deve ser **oficial** (WhatsApp Business Platform / Cloud API da Meta), com modelos de mensagem aprovados e opt-in. Só ela pode gerar eventos `sent_via_integration` e `delivery_confirmed`, e isso exige um backend (Edge Function) com a chave guardada no servidor.
