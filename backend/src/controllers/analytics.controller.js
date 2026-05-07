/**
 * Analytics Controller
 * Handles page view tracking and dashboard stats endpoints
 */

const analyticsService = require('../services/analytics/analytics.service');

module.exports = {
  /**
   * POST /analytics/track
   * Track a page view (public endpoint, called from frontend)
   */
  async trackPageView(req, res) {
    try {
      const { sessionId, pagePath, referrer } = req.body;
      
      if (!sessionId || !pagePath) {
        return res.status(400).json({ ok: false, error: 'sessionId and pagePath required' });
      }

      // Get IP and user agent from request
      const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
        || req.socket?.remoteAddress 
        || null;
      const userAgent = req.headers['user-agent'] || null;

      const result = await analyticsService.trackPageView({
        sessionId,
        ipAddress,
        userAgent,
        pagePath,
        referrer,
      });

      res.json({ ok: result.success });
    } catch (error) {
      console.error('[Analytics] Track error:', error.message);
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
  },

  /**
   * POST /analytics/heartbeat
   * Keep session alive (called periodically from frontend)
   */
  async heartbeat(req, res) {
    try {
      const { sessionId, pagePath } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ ok: false, error: 'sessionId required' });
      }

      const result = await analyticsService.heartbeat({ sessionId, pagePath });
      res.json({ ok: result.success });
    } catch (error) {
      console.error('[Analytics] Heartbeat error:', error.message);
      res.status(500).json({ ok: false });
    }
  },

  /**
   * GET /analytics/dashboard (admin only)
   * Get dashboard analytics stats
   */
  async getDashboardStats(req, res) {
    try {
      const stats = await analyticsService.getDashboardStats();
      res.json({ ok: true, ...stats });
    } catch (error) {
      console.error('[Analytics] Dashboard stats error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  },

  /**
   * POST /analytics/cleanup (admin only)
   * Cleanup old session data
   */
  async cleanup(req, res) {
    try {
      const daysOld = parseInt(req.body.daysOld, 10) || 30;
      const result = await analyticsService.cleanupOldSessions(daysOld);
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error('[Analytics] Cleanup error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  },

  /**
   * GET /analytics/calendar (admin only)
   * Get monthly calendar stats for visitor heatmap
   */
  async getMonthlyCalendar(req, res) {
    try {
      const now = new Date();
      const year = parseInt(req.query.year, 10) || now.getFullYear();
      const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
      
      const stats = await analyticsService.getMonthlyCalendarStats(year, month);
      res.json({ ok: true, ...stats });
    } catch (error) {
      console.error('[Analytics] Calendar stats error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  },
};
