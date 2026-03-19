// Pure computation functions for recall and trend endpoints.
// Extracted from handlers so they can be unit tested without a database.

/**
 * Compute summary stats from a list of outcome rows.
 * Each row is expected to have { entry_type, metadata: { result, reward_signal, action } }.
 */
export function computeRecallSummary(rows) {
  const outcomes = rows.filter(r => r.entry_type === 'outcome');
  const successes = outcomes.filter(r => r.metadata?.result === 'success').length;
  const failures = outcomes.filter(r => r.metadata?.result === 'failure').length;
  const judged = successes + failures; // only outcomes with a real verdict
  const rewards = outcomes.map(r => r.metadata?.reward_signal).filter(r => typeof r === 'number');
  const avgReward = rewards.length > 0 ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null;

  // Recent trend: compare last 5 rewards vs previous 5
  let recentTrend = 'stable';
  if (rewards.length >= 6) {
    const recent = rewards.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const prior = rewards.slice(5, 10).reduce((a, b) => a + b, 0) / Math.min(rewards.length - 5, 5);
    if (recent > prior + 0.1) recentTrend = 'improving';
    else if (recent < prior - 0.1) recentTrend = 'declining';
  }

  // Top actions by success/failure
  const actionCounts = {};
  for (const o of outcomes) {
    const action = o.metadata?.action || 'unknown';
    if (!actionCounts[action]) actionCounts[action] = { success: 0, failure: 0 };
    if (o.metadata?.result === 'success') actionCounts[action].success++;
    else if (o.metadata?.result === 'failure') actionCounts[action].failure++;
  }
  const topSuccessActions = Object.entries(actionCounts)
    .sort((a, b) => b[1].success - a[1].success)
    .slice(0, 3)
    .map(([action]) => action);
  const topFailureActions = Object.entries(actionCounts)
    .sort((a, b) => b[1].failure - a[1].failure)
    .filter(([, v]) => v.failure > 0)
    .slice(0, 3)
    .map(([action]) => action);

  return {
    total_outcomes: outcomes.length,
    judged,
    successes,
    failures,
    success_rate: judged > 0 ? successes / judged : null,
    avg_reward: avgReward,
    recent_trend: recentTrend,
    top_success_actions: topSuccessActions,
    top_failure_actions: topFailureActions,
  };
}

/**
 * Parse a window string (e.g. "7d", "24h", "30d") into interval and bucket config.
 * Returns null if the input is invalid.
 */
export function parseWindow(rawWindow) {
  const windowStr = rawWindow || '7d';
  const match = windowStr.match(/^(\d+)(h|d)$/);
  if (!match) return null;

  const amount = parseInt(match[1]);
  const unit = match[2] === 'h' ? 'hours' : 'days';
  const interval = `${amount} ${unit}`;
  const totalHours = unit === 'hours' ? amount : amount * 24;
  const bucket = totalHours <= 48 ? '1 hour' : '1 day';
  const truncField = bucket === '1 hour' ? 'hour' : 'day';

  return { windowStr, interval, bucket, truncField };
}
