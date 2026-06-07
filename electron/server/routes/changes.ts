import { Router } from 'express';
import { pushChange, pullChanges, hasPendingChanges } from '../services/db';

const router = Router();

/* ── POST summarize ── */

router.post('/summarize', (req, res) => {
  const { project_path, operations } = req.body;
  if (project_path && operations?.length > 0) {
    try {
      const summary = `${operations.length} operations`;
      const files = [...new Set(operations.map((o: any) => o.file).filter(Boolean))];
      pushChange(project_path, summary, files as string[]);
    } catch { /* ignore */ }
  }
  res.json({ status: 'ok' });
});

/* ── GET pending ── */

router.get('/pending', (req, res) => {
  const projectPath = (req.query.project_path as string) || '';
  if (!projectPath) {
    return res.json({ items: [], has_pending: false });
  }
  const items = pullChanges(projectPath);
  res.json({ items, has_pending: items.length > 0 });
});

export default router;
