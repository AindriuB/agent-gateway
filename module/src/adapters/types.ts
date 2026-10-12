import type {
  ActorSummaryOutput,
  ActionsListOutput,
  ActionPerformOutput,
  InventoryOutput,
  ConditionsOutput,
} from '@agent-gateway/protocol';
import type { WriteContext } from '../tools/_write.js';
export type AdapterPayload<T> = Omit<T, 'actorUuid' | 'systemId'>;
/** Internal trusted state. Never part of public arguments or the pack API. */
export interface AdapterExecutionContext {
  readonly user: unknown;
  readonly callOptions: WriteContext['callOptions'];
  readonly snapshot: WriteContext['snapshot'];
  readonly intendCreate: WriteContext['intendCreate'];
  readonly created: WriteContext['created'];
}
export interface ConditionChange {
  id: string;
  active: boolean;
  value?: number;
}
export class AdapterUnsupportedError extends Error {}
export interface SystemAdapter {
  readonly systemId: string;
  actorSummary(
    actor: unknown,
  ): AdapterPayload<ActorSummaryOutput> | Promise<AdapterPayload<ActorSummaryOutput>>;
  listActions(
    actor: unknown,
  ): AdapterPayload<ActionsListOutput> | Promise<AdapterPayload<ActionsListOutput>>;
  performAction(
    actor: unknown,
    actionId: string,
    options: Readonly<Record<string, unknown>>,
    context: AdapterExecutionContext,
  ): AdapterPayload<ActionPerformOutput> | Promise<AdapterPayload<ActionPerformOutput>>;
  inventorySemantics(
    actor: unknown,
  ): AdapterPayload<InventoryOutput> | Promise<AdapterPayload<InventoryOutput>>;
  conditions(
    actor: unknown,
    change?: ConditionChange,
    context?: AdapterExecutionContext,
  ): AdapterPayload<ConditionsOutput> | Promise<AdapterPayload<ConditionsOutput>>;
}
