import { Router } from 'express';

const router = Router();

/* ── GET stream ── */

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send ping to keep connection alive
  const interval = setInterval(() => {
    if (res.destroyed) {
      clearInterval(interval);
      return;
    }
    res.write('event: ping\ndata: {}\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(interval);
  });

  // Send initial connection event
  res.write('event: connected\ndata: {}\n\n');
});

/* ── POST refresh ── */

router.post('/refresh', (req, res) => {
  res.json({ status: 'ok', files: req.body.diffs?.length || 0 });
});

export default router;
