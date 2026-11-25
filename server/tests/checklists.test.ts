import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';
import { dateStr, day, setupTaskWedding } from './helpers/taskFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

const applyUrl = (weddingId: string, templateId: string) => `/api/weddings/${weddingId}/checklist-templates/${templateId}/apply`;

async function makeTemplate(name = 'Test template') {
  return prisma.checklistTemplate.create({
    data: {
      name,
      description: 'for tests',
      items: {
        create: [
          { sortOrder: 1, title: 'Far ahead', description: 'long lead', priority: 'HIGH', daysBeforeWedding: 30 },
          { sortOrder: 2, title: 'Day before', priority: 'LOW', daysBeforeWedding: 1 },
          { sortOrder: 3, title: 'Way too late', priority: 'MEDIUM', daysBeforeWedding: 100000 / 10 }, // before today → clamped
        ],
      },
    },
    include: { items: true },
  });
}

const snapshot = async () => ({
  templates: await prisma.checklistTemplate.findMany({ orderBy: { id: 'asc' } }),
  items: await prisma.checklistTemplateItem.findMany({ orderBy: { id: 'asc' } }),
});

describe('GET /checklist-templates (FR-36)', () => {
  it('FR-36: requires login, then lists templates with items ordered by sortOrder', async () => {
    const t = await makeTemplate('List me');
    expect((await api().get('/api/checklist-templates')).status).toBe(401);
    const { user } = await createUser();
    const res = await api().get('/api/checklist-templates').set(bearer(user.id));
    expect(res.status).toBe(200);
    const found = res.body.find((x: { id: string }) => x.id === t.id);
    expect(found).toEqual({
      id: t.id,
      name: 'List me',
      description: 'for tests',
      items: [
        { id: expect.any(String), title: 'Far ahead', description: 'long lead', priority: 'HIGH', daysBeforeWedding: 30 },
        { id: expect.any(String), title: 'Day before', description: null, priority: 'LOW', daysBeforeWedding: 1 },
        { id: expect.any(String), title: 'Way too late', description: null, priority: 'MEDIUM', daysBeforeWedding: 10000 },
      ],
    });
  });
});

describe('apply template (FR-37, FR-38, UC-12, AC-09)', () => {
  it('AC-09: applying a built-in checklist copies tasks and leaves the template unchanged', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const tpl = await makeTemplate();
    const before = await snapshot();
    const res = await api().post(applyUrl(wedding.id, tpl.id)).set(bearer(owner.id)).send({});
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(3);

    const weddingDate = (await prisma.wedding.findUniqueOrThrow({ where: { id: wedding.id } })).weddingDate;
    const expectedDue = (days: number) => new Date(weddingDate.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const byTitle = Object.fromEntries(res.body.created.map((t: { title: string }) => [t.title, t]));
    expect(byTitle['Far ahead']).toMatchObject({
      description: 'long lead',
      priority: 'HIGH',
      status: 'TODO',
      assignee: null,
      progressNotes: null,
      dueDate: expectedDue(30),
      isOverdue: false,
    });
    expect(byTitle['Day before']).toMatchObject({ priority: 'LOW', dueDate: expectedDue(1) });
    expect(byTitle['Way too late'].dueDate).toBe(dateStr(0)); // clamped to today, never in the past
    expect(byTitle['Way too late'].isOverdue).toBe(false);

    const rows = await prisma.task.findMany({ where: { weddingId: wedding.id } });
    expect(rows).toHaveLength(3);
    const itemIds = tpl.items.map((i) => i.id).sort();
    expect(rows.map((r) => r.sourceTemplateItemId).sort()).toEqual(itemIds);
    expect(await snapshot()).toEqual(before);
  });

  it('FR-38: editing or deleting a created task does not touch the template', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const tpl = await makeTemplate('Independent');
    const res = await api().post(applyUrl(wedding.id, tpl.id)).set(bearer(owner.id)).send({});
    const before = await snapshot();
    const [first, second] = res.body.created as { id: string }[];
    const edit = await api()
      .patch(`/api/weddings/${wedding.id}/tasks/${first!.id}`)
      .set(bearer(owner.id))
      .send({ title: 'Renamed', priority: 'LOW', description: 'changed', dueDate: dateStr(2) });
    expect(edit.status).toBe(200);
    expect((await api().delete(`/api/weddings/${wedding.id}/tasks/${second!.id}`).set(bearer(owner.id))).status).toBe(204);
    expect(await snapshot()).toEqual(before);
    const fresh = await api().get('/api/checklist-templates').set(bearer(owner.id));
    expect(fresh.body.find((t: { id: string }) => t.id === tpl.id).items.map((i: { title: string }) => i.title)).toContain('Far ahead');
  });

  it('FR-37: applying twice creates a second independent set', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const tpl = await makeTemplate('Twice');
    await api().post(applyUrl(wedding.id, tpl.id)).set(bearer(owner.id)).send({});
    const second = await api().post(applyUrl(wedding.id, tpl.id)).set(bearer(owner.id)).send({});
    expect(second.status).toBe(201);
    expect(await prisma.task.count({ where: { weddingId: wedding.id } })).toBe(6);
  });

  it('UC-12: unknown or malformed template → 404, nothing created', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const ghost = '11111111-1111-4111-8111-111111111111';
    for (const id of [ghost, 'not-a-uuid']) {
      const res = await api().post(applyUrl(wedding.id, id)).set(bearer(owner.id)).send({});
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Checklist template not found.');
    }
    expect(await prisma.task.count({ where: { weddingId: wedding.id } })).toBe(0);
  });

  it('FR-37: team member gets 403, non-member gets 404, archived wedding gets 409; no tasks created', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const { user: outsider } = await createUser();
    const tpl = await makeTemplate('Guarded');
    expect((await api().post(applyUrl(wedding.id, tpl.id)).set(bearer(member.id)).send({})).status).toBe(403);
    expect((await api().post(applyUrl(wedding.id, tpl.id)).set(bearer(outsider.id)).send({})).status).toBe(404);
    expect((await api().post(applyUrl(wedding.id, tpl.id)).send({})).status).toBe(401);
    expect(await prisma.task.count({ where: { weddingId: wedding.id } })).toBe(0);

    const w2 = await createWedding(owner.id);
    await api().post(`/api/weddings/${w2.id}/archive`).set(bearer(owner.id));
    expect((await api().post(applyUrl(w2.id, tpl.id)).set(bearer(owner.id)).send({})).status).toBe(409);
    expect(await prisma.task.count({ where: { weddingId: w2.id } })).toBe(0);
  });

  it('FR-37: a wedding date in the past clamps every due date to today', async () => {
    const { owner, wedding } = await setupTaskWedding();
    await prisma.wedding.update({ where: { id: wedding.id }, data: { weddingDate: day(5), rsvpDeadline: day(1) } });
    const tpl = await makeTemplate('Soon');
    const res = await api().post(applyUrl(wedding.id, tpl.id)).set(bearer(owner.id)).send({});
    const due = Object.fromEntries(res.body.created.map((t: { title: string; dueDate: string }) => [t.title, t.dueDate]));
    expect(due['Far ahead']).toBe(dateStr(0)); // 5 - 30 < today
    expect(due['Day before']).toBe(dateStr(4));
  });
});
