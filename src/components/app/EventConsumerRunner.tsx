// Runs the first domain_events consumer in every open tab. Renders nothing.
// Mounted once, in the shell; the hook decides everything.
import { useGoalCacheConsumer } from "@/hooks/useEventConsumer";

export function EventConsumerRunner() {
  useGoalCacheConsumer();
  return null;
}
