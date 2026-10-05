import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidLaneError,
  InvalidTaskError,
  UnknownTaskError,
} from "./errors.js";

export type TaskStatus = "waiting" | "dispatched" | "timedout";

export interface Dispatch {
  taskId: number;
  laneId: string;
  payload: unknown;
  cost: number;
}

export interface DriveResult {
  dispatched: Dispatch[];
  timedOut: number[];
}

export interface DebtLaneOptions {
  clock: VirtualClock;
  waitTimeoutMs: number;
  maxQueuePerLane?: number;
}

interface Task {
  taskId: number;
  laneId: string;
  payload: unknown;
  cost: number;
  enqueuedAt: number;
  status: TaskStatus;
}

interface Lane {
  laneId: string;
  credit: number;
  debt: number;
  queue: Task[];
}

const DEFAULT_MAX_QUEUE_PER_LANE = 16;

export class DebtLane {
  private readonly clock: VirtualClock;
  private readonly waitTimeoutMs: number;
  private readonly maxQueuePerLane: number;
  private readonly lanesById = new Map<string, Lane>();
  private readonly tasks = new Map<number, Task>();
  private nextTaskId = 1;
  private rrCursor: string | undefined;

  constructor(options: DebtLaneOptions) {
    const { clock, waitTimeoutMs, maxQueuePerLane } = options;
    if (
      typeof waitTimeoutMs !== "number" ||
      !Number.isFinite(waitTimeoutMs) ||
      waitTimeoutMs < 1
    ) {
      throw new InvalidConfigError(
        `waitTimeoutMs must be a finite number >= 1, got ${waitTimeoutMs}`,
      );
    }
    const maxQueue = maxQueuePerLane ?? DEFAULT_MAX_QUEUE_PER_LANE;
    if (
      typeof maxQueue !== "number" ||
      !Number.isFinite(maxQueue) ||
      maxQueue < 1
    ) {
      throw new InvalidConfigError(
        `maxQueuePerLane must be a finite number >= 1, got ${maxQueue}`,
      );
    }
    this.clock = clock;
    this.waitTimeoutMs = waitTimeoutMs;
    this.maxQueuePerLane = maxQueue;
  }

  ensureLane(laneId: string): void {
    if (typeof laneId !== "string" || laneId.length === 0) {
      throw new InvalidLaneError("laneId must be a non-empty string");
    }
    if (this.lanesById.has(laneId)) return;
    this.lanesById.set(laneId, {
      laneId,
      credit: 0,
      debt: 0,
      queue: [],
    });
  }

  submit(
    laneId: string,
    cost: number,
    payload?: unknown,
  ): { taskId: number } {
    const lane = this.lanesById.get(laneId);
    if (!lane) {
      throw new InvalidLaneError(`unknown lane: ${laneId}`);
    }
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidTaskError(
        `cost must be a finite integer >= 1, got ${cost}`,
      );
    }
    if (lane.queue.length >= this.maxQueuePerLane) {
      throw new InvalidTaskError(
        `lane ${laneId} queue is full (${this.maxQueuePerLane})`,
      );
    }
    const task: Task = {
      taskId: this.nextTaskId++,
      laneId,
      payload,
      cost,
      enqueuedAt: this.clock.now(),
      status: "waiting",
    };
    lane.queue.push(task);
    this.tasks.set(task.taskId, task);
    return { taskId: task.taskId };
  }

  grant(laneId: string, amount: number): void {
    const lane = this.lanesById.get(laneId);
    if (!lane) {
      throw new InvalidLaneError(`unknown lane: ${laneId}`);
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 1) {
      throw new InvalidLaneError(
        `grant amount must be a finite number >= 1, got ${amount}`,
      );
    }
    const pay = Math.min(lane.debt, amount);
    lane.debt -= pay;
    lane.credit += amount - pay;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const timedOut: number[] = [];
    for (const lane of this.lanesById.values()) {
      const remaining: Task[] = [];
      for (const task of lane.queue) {
        if (now - task.enqueuedAt >= this.waitTimeoutMs) {
          task.status = "timedout";
          timedOut.push(task.taskId);
        } else {
          remaining.push(task);
        }
      }
      lane.queue = remaining;
    }
    timedOut.sort((a, b) => a - b);

    const dispatched: Dispatch[] = [];
    const ids = this.sortedLaneIds();
    if (ids.length > 0) {
      let idx = this.cursorIndex(ids);
      for (let visited = 0; visited < ids.length; visited++) {
        const lane = this.lanesById.get(ids[idx])!;
        const head = lane.queue[0];
        if (head) {
          if (lane.credit >= head.cost) {
            lane.credit -= head.cost;
            head.status = "dispatched";
            lane.queue.shift();
            dispatched.push({
              taskId: head.taskId,
              laneId: head.laneId,
              payload: head.payload,
              cost: head.cost,
            });
          } else {
            lane.debt += head.cost;
          }
        }
        idx = (idx + 1) % ids.length;
      }
      this.rrCursor = ids[idx];
    }
    return { dispatched, timedOut };
  }

  creditOf(laneId: string): number {
    return this.requireLane(laneId).credit;
  }

  debtOf(laneId: string): number {
    return this.requireLane(laneId).debt;
  }

  queueOf(laneId: string): number[] {
    return this.requireLane(laneId).queue.map((task) => task.taskId);
  }

  statusOf(taskId: number): TaskStatus {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new UnknownTaskError(`unknown task: ${taskId}`);
    }
    return task.status;
  }

  lanes(): string[] {
    return this.sortedLaneIds();
  }

  private requireLane(laneId: string): Lane {
    const lane = this.lanesById.get(laneId);
    if (!lane) {
      throw new InvalidLaneError(`unknown lane: ${laneId}`);
    }
    return lane;
  }

  private sortedLaneIds(): string[] {
    return [...this.lanesById.keys()].sort();
  }

  private cursorIndex(ids: string[]): number {
    if (this.rrCursor === undefined) return 0;
    let lo = 0;
    let hi = ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] < this.rrCursor) lo = mid + 1;
      else hi = mid;
    }
    return lo < ids.length ? lo : 0;
  }
}
