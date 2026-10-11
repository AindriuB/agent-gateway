import { effectiveCategory } from '../ops/context.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolDefinition } from '@agent-gateway/protocol';
import { liveToolMetadata as toolRegistry } from '../ops/registry-class.js';
import type { Stage } from '../ops/stages.js';
import type { DispatchResult } from '../ops/types.js';
import { bucketFor, resolveLimit, type LoadedLimits } from './config.js';
import { SlidingWindowLimiter } from './limiter.js';
import { loadRateLimits } from './store.js';
import './types.js';

declare const game: any;

/** After policy (20), before approval (30), so a limited agent cannot flood the approval queue. */
export const RATE_LIMIT_STAGE_ORDER = 25;

const t = (key: string, data: Record<string, string> = {}): string => {
  const i18n = game?.i18n;
  return typeof i18n?.format === 'function' ? String(i18n.format(key, data)) : key;
};

export interface RateLimitConfig {
  tools?: readonly ToolDefinition[];
  limits?: () => LoadedLimits;
  /** Milliseconds on a monotonic clock; tests inject their own. */
  now?: () => number;
  limiter?: SlidingWindowLimiter;
}

/**
 * Charges each call to its agent's `read` or `write` bucket. It runs after the dispatcher's role
 * and argument checks and after policy, so a call rejected there never reaches it and costs no
 * budget. The agent class is the calling user's, as in the policy engine.
 */
export function createRateLimitStage(config: RateLimitConfig = {}): Stage {
  const limits = config.limits ?? loadRateLimits;
  const limiter =
    config.limiter ?? new SlidingWindowLimiter(config.now ?? (() => performance.now()));
  return {
    name: 'rate-limit',
    order: RATE_LIMIT_STAGE_ORDER,
    async run(ctx, next) {
      const bucket = bucketFor(
        effectiveCategory(
          ctx,
          config.tools
            ? config.tools.find((d) => d.name === ctx.tool)?.category
            : toolRegistry.categoryOf(ctx.tool),
        ),
      );
      const limit = resolveLimit(
        limits(),
        ctx.user.isGM ? 'gmAgents' : 'playerAgents',
        ctx.agent.id,
        bucket,
      );
      const taken = limiter.take(`${ctx.agent.id}\u0000${bucket}`, limit);
      if (taken.ok) return next();
      const result: DispatchResult = {
        error: {
          code: 'RATE_LIMITED',
          message: t('AGENT_GATEWAY.RateLimit.exceeded', {
            bucket,
            limit: String(limit),
            seconds: String(taken.retryAfterSeconds),
          }),
        },
        retryAfterSeconds: taken.retryAfterSeconds,
      };
      return result;
    },
  };
}

export const rateLimitStage = createRateLimitStage();
