ALTER TABLE "automation_events" DROP CONSTRAINT "automation_events_pkey";
ALTER TABLE "automation_events"
  ADD CONSTRAINT "automation_events_pkey" PRIMARY KEY ("user_id", "rule_id", "event_id");
