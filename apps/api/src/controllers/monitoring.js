const express = require('express');
const { requirePermission } = require('../lib/roles');
const OutboundEmailJob = require('../models/OutboundEmailJob');
const AuditLog = require('../models/AuditLog');

const router = express.Router();

function percentile(sortedNumbers, p) {
  if (!sortedNumbers.length) return null;
  const idx = Math.ceil((p / 100) * sortedNumbers.length) - 1;
  return sortedNumbers[Math.max(0, Math.min(idx, sortedNumbers.length - 1))];
}

function buildHourlyBuckets(windowHours) {
  const buckets = [];
  const now = new Date();
  for (let offset = windowHours - 1; offset >= 0; offset -= 1) {
    const t = new Date(now.getTime() - offset * 60 * 60 * 1000);
    const hour = new Date(t);
    hour.setMinutes(0, 0, 0);
    buckets.push({
      key: hour.toISOString().slice(0, 13), // YYYY-MM-DDTHH
      label: `${String(hour.getHours()).padStart(2, '0')}:00`,
      sent: 0,
      dead: 0,
      retry: 0,
    });
  }
  return buckets;
}

router.get('/mailer', requirePermission(['integration::manage'], false), async (req, res) => {
  try {
    const windowHours = Math.min(Math.max(Number(req.query.windowHours || 24), 1), 24 * 14);
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [statusCountsRaw, jobsInWindow, recentAudit, trendAgg] = await Promise.all([
      OutboundEmailJob.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      OutboundEmailJob.find({ createdAt: { $gte: since } })
        .select('status attempt createdAt sentAt')
        .lean(),
      AuditLog.find({
        eventType: { $in: ['job_enqueued', 'job_retry', 'job_dead', 'job_sent'] },
        at: { $gte: since },
      })
        .sort({ at: -1 })
        .limit(100)
        .lean(),
      AuditLog.aggregate([
        {
          $match: {
            eventType: { $in: ['job_sent', 'job_dead', 'job_retry'] },
            at: { $gte: since },
          },
        },
        {
          $group: {
            _id: {
              eventType: '$eventType',
              hour: {
                $dateToString: {
                  format: '%Y-%m-%dT%H',
                  date: '$at',
                },
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const statusCounts = {
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      dead: 0,
    };
    for (const row of statusCountsRaw) {
      if (row?._id && Object.prototype.hasOwnProperty.call(statusCounts, row._id)) {
        statusCounts[row._id] = row.count;
      }
    }

    const sentInWindow = jobsInWindow.filter((job) => job.status === 'sent');
    const deadInWindow = jobsInWindow.filter((job) => job.status === 'dead');
    const retryEventsInWindow = recentAudit.filter((log) => log.eventType === 'job_retry').length;
    const sentDurationsMs = sentInWindow
      .map((job) => {
        if (!job.sentAt || !job.createdAt) return null;
        return new Date(job.sentAt).getTime() - new Date(job.createdAt).getTime();
      })
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);

    const p50LatencyMs = percentile(sentDurationsMs, 50);
    const p95LatencyMs = percentile(sentDurationsMs, 95);
    const successRate = jobsInWindow.length > 0
      ? Number(((sentInWindow.length / jobsInWindow.length) * 100).toFixed(2))
      : 0;
    const bucketMap = new Map(buildHourlyBuckets(windowHours).map((bucket) => [bucket.key, bucket]));

    for (const row of trendAgg) {
      const hour = row?._id?.hour;
      const eventType = row?._id?.eventType;
      const bucket = bucketMap.get(hour);
      if (!bucket) continue;
      if (eventType === 'job_sent') bucket.sent = row.count;
      if (eventType === 'job_dead') bucket.dead = row.count;
      if (eventType === 'job_retry') bucket.retry = row.count;
    }

    return res.status(200).json({
      success: true,
      window: {
        windowHours,
        since,
      },
      totals: statusCounts,
      windowMetrics: {
        created: jobsInWindow.length,
        sent: sentInWindow.length,
        dead: deadInWindow.length,
        retries: retryEventsInWindow,
        successRate,
        latency: {
          p50Ms: p50LatencyMs,
          p95Ms: p95LatencyMs,
        },
      },
      trends: Array.from(bucketMap.values()),
      recentAudit,
    });
  } catch (error) {
    console.error('Error loading mailer dashboard metrics:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

module.exports = router;
