import type { JobType } from "@prisma/client";

// The job types the admin queue filters by. SMUS is deliberately absent: an
// external charter never enters the internal fleet (the schedule board drops it
// for the same reason), so filtering the queue down to it only ever produced a
// list nobody acts on here.
//
// One list, imported by both the filter bar (which renders the chips) and the
// queue page (which validates ?jobType= against it) — they were two copies.
export const QUEUE_JOB_TYPES: JobType[] = ["NORMAL", "OT", "TJW", "WERN"];
