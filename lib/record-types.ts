export type WorkRecord = {
  id: string; team_id: string; entity_type: string; entity_id: string; title: string; action: string;
  actor: { id?: string; name?: string; role?: string; note?: string }; recorded_at: string; task_ids: string[];
  before_data?: Record<string, unknown> | null; data?: Record<string, unknown> | null;
};
export type WorkDecision = {
  id: string; version: number; updated_at: string;
  payload: { title: string; body: string; reason: string; reportId: string; taskIds: string[]; assigneeId: string; dueDate: string; status: 'open' | 'done' | 'on_hold'; evidence: string; result: string; decidedBy: string; decidedAt: string; updatedBy?: string; supersedesId?: string };
};
