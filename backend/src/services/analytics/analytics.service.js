/**
 * Analytics Service
 * Tracks page views, active sessions, and provides dashboard stats
 */

const sequelize = require('../../config/db');
const { Op } = require('sequelize');

// Session is considered "live" if last seen within this many minutes
const LIVE_THRESHOLD_MINUTES = 5;

/**
 * Record a page view and update active session
 */
async function trackPageView({ sessionId, ipAddress, userAgent, pagePath, referrer }) {
  const now = new Date();
  
  try {
    // Insert page view
    await sequelize.query(
      `INSERT INTO page_views (session_id, ip_address, user_agent, page_path, referrer, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      {
        replacements: [sessionId, ipAddress || null, userAgent || null, pagePath, referrer || null, now],
        type: sequelize.QueryTypes.INSERT,
      }
    );

    // Upsert active session
    await sequelize.query(
      `INSERT INTO active_sessions (session_id, ip_address, user_agent, last_seen_at, first_seen_at, page_count, last_page)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         last_seen_at = VALUES(last_seen_at),
         page_count = page_count + 1,
         last_page = VALUES(last_page),
         ip_address = COALESCE(VALUES(ip_address), ip_address),
         user_agent = COALESCE(VALUES(user_agent), user_agent)`,
      {
        replacements: [sessionId, ipAddress || null, userAgent || null, now, now, pagePath],
        type: sequelize.QueryTypes.INSERT,
      }
    );

    return { success: true };
  } catch (error) {
    console.error('[Analytics] Error tracking page view:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update session heartbeat (keep-alive)
 */
async function heartbeat({ sessionId, pagePath }) {
  const now = new Date();
  
  try {
    await sequelize.query(
      `UPDATE active_sessions SET last_seen_at = ?, last_page = ? WHERE session_id = ?`,
      {
        replacements: [now, pagePath || null, sessionId],
        type: sequelize.QueryTypes.UPDATE,
      }
    );
    return { success: true };
  } catch (error) {
    console.error('[Analytics] Heartbeat error:', error.message);
    return { success: false };
  }
}

/**
 * Get dashboard analytics stats
 */
async function getDashboardStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const liveThreshold = new Date(now.getTime() - LIVE_THRESHOLD_MINUTES * 60 * 1000);

  try {
    // Live users (active in last 5 minutes)
    const [liveResult] = await sequelize.query(
      `SELECT COUNT(*) as count FROM active_sessions WHERE last_seen_at >= ?`,
      { replacements: [liveThreshold], type: sequelize.QueryTypes.SELECT }
    );
    const liveUsers = liveResult?.count || 0;

    // Unique users today (by session_id)
    const [uniqueTodayResult] = await sequelize.query(
      `SELECT COUNT(DISTINCT session_id) as count FROM page_views WHERE created_at >= ?`,
      { replacements: [todayStart], type: sequelize.QueryTypes.SELECT }
    );
    const uniqueUsersToday = uniqueTodayResult?.count || 0;

    // Total page views today
    const [pageViewsTodayResult] = await sequelize.query(
      `SELECT COUNT(*) as count FROM page_views WHERE created_at >= ?`,
      { replacements: [todayStart], type: sequelize.QueryTypes.SELECT }
    );
    const pageViewsToday = pageViewsTodayResult?.count || 0;

    // Total page views all time
    const [totalPageViewsResult] = await sequelize.query(
      `SELECT COUNT(*) as count FROM page_views`,
      { type: sequelize.QueryTypes.SELECT }
    );
    const totalPageViews = totalPageViewsResult?.count || 0;

    // Total unique sessions all time
    const [totalSessionsResult] = await sequelize.query(
      `SELECT COUNT(*) as count FROM active_sessions`,
      { type: sequelize.QueryTypes.SELECT }
    );
    const totalSessions = totalSessionsResult?.count || 0;

    // Page views last hour
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const [lastHourResult] = await sequelize.query(
      `SELECT COUNT(*) as count FROM page_views WHERE created_at >= ?`,
      { replacements: [hourAgo], type: sequelize.QueryTypes.SELECT }
    );
    const pageViewsLastHour = lastHourResult?.count || 0;

    // Top pages today
    const topPages = await sequelize.query(
      `SELECT page_path, COUNT(*) as views 
       FROM page_views 
       WHERE created_at >= ?
       GROUP BY page_path 
       ORDER BY views DESC 
       LIMIT 10`,
      { replacements: [todayStart], type: sequelize.QueryTypes.SELECT }
    );

    // Live sessions detail
    const liveSessions = await sequelize.query(
      `SELECT session_id, last_page, last_seen_at, page_count, ip_address
       FROM active_sessions 
       WHERE last_seen_at >= ?
       ORDER BY last_seen_at DESC
       LIMIT 20`,
      { replacements: [liveThreshold], type: sequelize.QueryTypes.SELECT }
    );

    // Hourly breakdown today (for chart)
    const hourlyData = await sequelize.query(
      `SELECT HOUR(created_at) as hour, COUNT(*) as views, COUNT(DISTINCT session_id) as users
       FROM page_views 
       WHERE created_at >= ?
       GROUP BY HOUR(created_at)
       ORDER BY hour ASC`,
      { replacements: [todayStart], type: sequelize.QueryTypes.SELECT }
    );

    return {
      liveUsers,
      uniqueUsersToday,
      pageViewsToday,
      pageViewsLastHour,
      totalPageViews,
      totalSessions,
      topPages,
      liveSessions,
      hourlyData,
      liveThresholdMinutes: LIVE_THRESHOLD_MINUTES,
    };
  } catch (error) {
    console.error('[Analytics] Error getting stats:', error.message);
    throw error;
  }
}

/**
 * Cleanup old sessions (optional, for maintenance)
 */
async function cleanupOldSessions(daysOld = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  try {
    const [result] = await sequelize.query(
      `DELETE FROM active_sessions WHERE last_seen_at < ?`,
      { replacements: [cutoff], type: sequelize.QueryTypes.DELETE }
    );
    return { deleted: result?.affectedRows || 0 };
  } catch (error) {
    console.error('[Analytics] Cleanup error:', error.message);
    return { deleted: 0, error: error.message };
  }
}

/**
 * Get daily stats for a given month (for calendar view)
 * @param {number} year - Year (e.g., 2026)
 * @param {number} month - Month (1-12)
 */
async function getMonthlyCalendarStats(year, month) {
  try {
    // Get first and last day of the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // Daily breakdown for the month with avg session duration
    const dailyStats = await sequelize.query(
      `SELECT 
         DATE(pv.created_at) as date,
         COUNT(*) as views,
         COUNT(DISTINCT pv.session_id) as users,
         AVG(TIMESTAMPDIFF(SECOND, s.first_seen_at, s.last_seen_at)) as avg_duration_seconds
       FROM page_views pv
       LEFT JOIN active_sessions s ON pv.session_id = s.session_id
       WHERE pv.created_at >= ? AND pv.created_at <= ?
       GROUP BY DATE(pv.created_at)
       ORDER BY date ASC`,
      { 
        replacements: [startDate, endDate], 
        type: sequelize.QueryTypes.SELECT 
      }
    );

    // Convert to object keyed by day number for easy lookup
    const dailyMap = {};
    let totalDuration = 0;
    let daysWithDuration = 0;
    
    for (const row of dailyStats) {
      const day = new Date(row.date).getDate();
      const avgDuration = row.avg_duration_seconds || 0;
      dailyMap[day] = {
        views: row.views,
        users: row.users,
        avgDuration: Math.round(avgDuration), // in seconds
      };
      if (avgDuration > 0) {
        totalDuration += avgDuration;
        daysWithDuration++;
      }
    }

    // Get month totals
    const totalViews = dailyStats.reduce((sum, r) => sum + r.views, 0);
    const totalUsers = dailyStats.reduce((sum, r) => sum + r.users, 0);
    const overallAvgDuration = daysWithDuration > 0 ? Math.round(totalDuration / daysWithDuration) : 0;

    // Find max values for heatmap scaling
    const maxViews = Math.max(1, ...dailyStats.map(r => r.views));
    const maxUsers = Math.max(1, ...dailyStats.map(r => r.users));

    return {
      year,
      month,
      daysInMonth: endDate.getDate(),
      dailyStats: dailyMap,
      totalViews,
      totalUsers,
      activeDays: dailyStats.length,
      avgDuration: overallAvgDuration,
      maxViews,
      maxUsers,
    };
  } catch (error) {
    console.error('[Analytics] Error getting monthly stats:', error.message);
    throw error;
  }
}

module.exports = {
  trackPageView,
  heartbeat,
  getDashboardStats,
  cleanupOldSessions,
  getMonthlyCalendarStats,
  LIVE_THRESHOLD_MINUTES,
};
