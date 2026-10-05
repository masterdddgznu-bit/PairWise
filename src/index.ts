export class DebtLaneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DebtLaneError {}
export class InvalidLaneError extends DebtLaneError {}
export class InvalidTaskError extends DebtLaneError {}
export class UnknownTaskError extends DebtLaneError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new DebtLaneError("advance requires a finite ms >= 0");
    }
    this.current += ms;
  }
}

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

type TaskStatus = "waiting" | "dispatched" | "timedout";

interface Task {
  taskId: number;
  laneId: string;
  cost: number;
  payload: unknown;
  enqueuedAt: number;
  status: TaskStatus;
}

interface Lane {
  laneId: string;
  credit: number;
  debt: number;
  queue: Task[];
}

export class DebtLane {
  private readonly clock: VirtualClock;
  private readonly waitTimeoutMs: number;
  private readonly maxQueuePerLane: number;
  private readonly lanesById = new Map<string, Lane>();
  private readonly tasksById = new Map<number, Task>();
  private nextTaskId = 1;
  private rrCursor: string | null = null;

  constructor(options: DebtLaneOptions) {
    const { clock, waitTimeoutMs } = options;
    const maxQueuePerLane = options.maxQueuePerLane ?? 16;
    if (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs < 1) {
      throw new InvalidConfigError("waitTimeoutMs must be a finite number >= 1");
    }
    if (!Number.isInteger(maxQueuePerLane) || maxQueuePerLane < 1) {
      throw new InvalidConfigError("maxQueuePerLane must be an integer >= 1");
    }
    this.clock = clock;
    this.waitTimeoutMs = waitTimeoutMs;
    this.maxQueuePerLane = maxQueuePerLane;
  }

  ensureLane(laneId: string): void {
    if (typeof laneId !== "string" || laneId.length === 0) {
      throw new InvalidLaneError("laneId must be a non-empty string");
    }
    if (this.lanesById.has(laneId)) {
      return;
    }
    this.lanesById.set(laneId, { laneId, credit: 0, debt: 0, queue: [] });
  }

  submit(laneId: string, cost: number, payload?: unknown): { taskId: number } {
    const lane = this.requireLane(laneId);
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidTaskError("cost must be a finite integer >= 1");
    }
    if (lane.queue.length >= this.maxQueuePerLane) {
      throw new InvalidTaskError("lane queue is full");
    }
    const task: Task = {
      taskId: this.nextTaskId++,
      laneId,
      cost,
      payload,
      enqueuedAt: this.clock.now(),
      status: "waiting",
    };
    lane.queue.push(task);
    this.tasksById.set(task.taskId, task);
    return { taskId: task.taskId };
  }

  grant(laneId: string, amount: number): void {
    const lane = this.requireLane(laneId);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new InvalidLaneError("amount must be a finite number >= 1");
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
    const laneIds = [...this.lanesById.keys()].sort();
    if (laneIds.length > 0) {
      let index = 0;
      if (this.rrCursor !== null) {
        const found = laneIds.indexOf(this.rrCursor);
        if (found >= 0) {
          index = found;
        }
      }
      for (let visited = 0; visited < laneIds.length; visited++) {
        const lane = this.lanesById.get(laneIds[index])!;
        const head = lane.queue[0];
        if (head !== undefined) {
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
        index = (index + 1) % laneIds.length;
      }
      this.rrCursor = laneIds[index];
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
    const task = this.tasksById.get(taskId);
    if (task === undefined) {
      throw new UnknownTaskError(`unknown taskId: ${taskId}`);
    }
    return task.status;
  }

  lanes(): string[] {
    return [...this.lanesById.keys()].sort();
  }

  private requireLane(laneId: string): Lane {
    const lane = this.lanesById.get(laneId);
    if (lane === undefined) {
      throw new InvalidLaneError(`unknown lane: ${laneId}`);
    }
    return lane;
  }
}
