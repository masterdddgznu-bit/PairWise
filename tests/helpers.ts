import { LogicalClock } from "../src/clock.js";
import { Coordinator } from "../src/coordinator.js";
import { ShardStore } from "../src/shard_store.js";

export function makeCluster(shardCount = 3): {
  clock: LogicalClock;
  shards: ShardStore[];
  coord: Coordinator;
} {
  const clock = new LogicalClock();
  const shards = Array.from(
    { length: shardCount },
    (_, i) => new ShardStore(i, clock),
  );
  const coord = new Coordinator(shards);
  return { clock, shards, coord };
}
