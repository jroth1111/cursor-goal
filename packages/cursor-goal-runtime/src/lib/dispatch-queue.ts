import { existsSync } from "node:fs";
import path from "node:path";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import { atomicWriteJson, goalDir, projectRoot, readJson } from "./paths.js";
import { readWorkUnits } from "./work-units.js";
import { withGoalDirLock } from "./goal-dir-lock.js";

export type DispatchQueueItem = {
  order: number;
  unit_id: string;
  title: string;
  scope: string[];
  acceptance: string[];
};

export type DispatchQueueFile = {
  items: DispatchQueueItem[];
  head_index: number;
};

export function dispatchQueuePath(root?: string): string {
  return path.join(goalDir(root), "dispatch-queue.json");
}

export function buildDispatchQueue(units: WorkUnitCompiled[]): DispatchQueueFile {
  return {
    items: units.map((u, order) => ({
      order,
      unit_id: u.id,
      title: u.title,
      scope: u.scope,
      acceptance: u.acceptance.length ? u.acceptance : ["true"],
    })),
    head_index: 0,
  };
}

export async function readDispatchQueue(root?: string): Promise<DispatchQueueFile | null> {
  const p = dispatchQueuePath(root);
  if (!existsSync(p)) return null;
  return readJson<DispatchQueueFile>(p);
}

function queueScanStart(
  queue: DispatchQueueFile,
  byId: Map<string, { status: string }>,
): number {
  const hint = Math.max(0, queue.head_index ?? 0);
  if (hint === 0 || hint >= queue.items.length) return 0;
  for (let i = 0; i < hint; i++) {
    const unit = byId.get(queue.items[i].unit_id);
    if (unit && unit.status !== "done") return 0;
  }
  return hint;
}

/** First queue item whose unit is not done (respects head_index when prior items are done). */
export async function resolveQueueHead(root?: string): Promise<{
  item: DispatchQueueItem;
  index: number;
} | null> {
  const queue = await readDispatchQueue(root);
  const wu = await readWorkUnits(root);
  if (!queue?.items?.length || !wu?.units?.length) return null;

  const byId = new Map(wu.units.map((u) => [u.id, u]));
  const start = queueScanStart(queue, byId);
  for (let i = start; i < queue.items.length; i++) {
    const item = queue.items[i];
    const unit = byId.get(item.unit_id);
    if (unit && unit.status !== "done") {
      if (queue.head_index !== i) {
        await syncDispatchQueueHeadIndex(root, i);
      }
      return { item, index: i };
    }
  }
  return null;
}

/** Align head_index with the first open queue item. */
export async function syncDispatchQueueHeadIndex(
  root?: string,
  index?: number,
): Promise<void> {
  const r = root ?? projectRoot();
  await withGoalDirLock(r, async () => {
    const queue = await readDispatchQueue(r);
    if (!queue?.items?.length) return;

    let nextIndex = index;
    if (nextIndex === undefined) {
      const wu = await readWorkUnits(r);
      if (!wu?.units?.length) return;
      const byId = new Map(wu.units.map((u) => [u.id, u]));
      const start = queueScanStart(queue, byId);
      nextIndex = queue.items.length;
      for (let i = start; i < queue.items.length; i++) {
        const unit = byId.get(queue.items[i].unit_id);
        if (unit && unit.status !== "done") {
          nextIndex = i;
          break;
        }
      }
    }

    if (queue.head_index === nextIndex) return;
    await atomicWriteJson(dispatchQueuePath(r), { ...queue, head_index: nextIndex });
  });
}
