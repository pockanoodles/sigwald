-- Intake: work read out of sources that aren't task lists (a Canvas
-- announcement or Inbox message, mail) arrives as a TaskProposal. Sigwald
-- matches it to a task it has, makes it a task on its own when the source is
-- trusted and the deadline is quoted from it, or holds it for the person.
-- Task.claims carries the claim keys a creator declares (CANVAS,
-- course:<id>), so an accepted proposal is filed under its goal.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "claims" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "TaskProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER,
    "evidence" TEXT NOT NULL,
    "dueText" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "grounded" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskProposal_userId_status_idx" ON "TaskProposal"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskProposal_userId_ref_key" ON "TaskProposal"("userId", "ref");

-- AddForeignKey
ALTER TABLE "TaskProposal" ADD CONSTRAINT "TaskProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskProposal" ADD CONSTRAINT "TaskProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

