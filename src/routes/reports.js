import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import * as rep from '../services/reports.js';
import { insights } from '../services/insights.js';

export const reports = Router();
reports.use(requireRole('agent', 'admin'));

function scope(req) {
  const s = { ...rep.range(req.query) };
  if (['flight', 'hotel'].includes(req.query.type)) s.type = req.query.type;
  if (['direct', 'agent'].includes(req.query.channel) && req.user.role === 'admin') s.channel = req.query.channel;
  if (req.user.role === 'agent') s.agentId = req.user.id;
  else if (req.query.agentId) s.agentId = Number(req.query.agentId);
  return s;
}
const send = (req, res, rows, name) => {
  if (req.query.format === 'csv') {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(rep.toCsv(rows));
  }
  res.json({ rows });
};

reports.get('/overview', wrap((req, res) => res.json(rep.overview(scope(req)))));
reports.get('/insights', wrap((req, res) => res.json({ insights: insights(scope(req), req.user) })));
reports.get('/sales', wrap((req, res) => send(req, res, rep.salesRows(scope(req)), 'sales')));
reports.get('/cancellations', wrap((req, res) => send(req, res, rep.cancellations(scope(req)), 'cancellations')));
reports.get('/agents', requireRole('admin'), wrap((req, res) => send(req, res, rep.agentPerformance(scope(req)), 'agent-performance')));
