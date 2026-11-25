import { todayUtc } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';
import { checklistRepository, type TemplateRow } from '../repositories/checklistRepository.js';
import type { NewTaskData } from '../repositories/taskRepository.js';
import { taskService, type TaskDto } from './taskService.js';

const DAY_MS = 86_400_000;

function toTemplateDto(t: TemplateRow) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    items: t.items.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      priority: i.priority,
      daysBeforeWedding: i.daysBeforeWedding,
    })),
  };
}

export const checklistService = {
  async list() {
    return (await checklistRepository.listTemplates()).map(toTemplateDto);
  },

  /**
   * FR-37/38, AC-09: copies each template item into an independent task (unassigned, TODO,
   * dueDate = weddingDate - daysBeforeWedding but never before today). The template is read only.
   */
  async apply(weddingId: string, templateId: string, now: Date = new Date()): Promise<{ created: TaskDto[] }> {
    const template = await checklistRepository.findTemplate(templateId);
    if (!template) throw notFound('Checklist template not found.');
    const weddingDate = await checklistRepository.findWeddingDate(weddingId);
    if (!weddingDate) throw notFound('Wedding not found.');

    const today = todayUtc(now);
    const rows: NewTaskData[] = template.items.map((item) => {
      const due = new Date(weddingDate.getTime() - item.daysBeforeWedding * DAY_MS);
      return {
        title: item.title,
        description: item.description,
        dueDate: due.getTime() < today.getTime() ? today : due,
        priority: item.priority,
        status: 'TODO',
        assigneeId: null,
        completedAt: null,
        sourceTemplateItemId: item.id,
      };
    });
    return { created: await taskService.createBatch(weddingId, rows) };
  },
};
