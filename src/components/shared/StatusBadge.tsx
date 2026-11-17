import { Badge } from '@/components/ui/badge';
import { CONSENT_LABEL, EVENT_LABEL, JOB_STATUS_LABEL, VALIDATION_LABEL } from '@/utils/labels';
import type { ConsentStatus, InvitationEventType, JobStatus, ValidationStatus } from '@/types/db';

export const ValidationBadge = ({ s }: { s: ValidationStatus }) => <Badge tone={VALIDATION_LABEL[s]?.[1]}>{VALIDATION_LABEL[s]?.[0] ?? s}</Badge>;
export const ConsentBadge = ({ s }: { s: ConsentStatus }) => <Badge tone={CONSENT_LABEL[s]?.[1]}>{CONSENT_LABEL[s]?.[0] ?? s}</Badge>;
export const JobBadge = ({ s }: { s: JobStatus }) => <Badge tone={JOB_STATUS_LABEL[s]?.[1]}>{JOB_STATUS_LABEL[s]?.[0] ?? s}</Badge>;
export const EventBadge = ({ s }: { s: InvitationEventType | null }) =>
  s ? <Badge tone={EVENT_LABEL[s]?.[1]}>{EVENT_LABEL[s]?.[0] ?? s}</Badge> : <Badge>Nunca convidado</Badge>;
