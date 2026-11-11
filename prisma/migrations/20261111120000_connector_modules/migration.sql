-- Connector modules (src/modules/connect): the connections they read through,
-- their settings and pull state, what they mirror, their daily readings, and
-- the Inbox module's private address. Only adds tables.

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "secret" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "accountLabel" TEXT,
    "error" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleSync" (
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "cursor" JSONB,
    "groups" JSONB NOT NULL DEFAULT '{}',
    "feedId" TEXT,
    "lastPullAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "pullingSince" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleSync_pkey" PRIMARY KEY ("userId","moduleId")
);

-- CreateTable
CREATE TABLE "ModuleItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "state" TEXT NOT NULL DEFAULT 'open',
    "doneAt" TIMESTAMP(3),
    "facts" JSONB NOT NULL DEFAULT '[]',
    "group" TEXT,
    "upstreamUpdatedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT,
    "projectedAt" TIMESTAMP(3),
    "eventId" TEXT,

    CONSTRAINT "ModuleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleReading" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "InboundLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Connection_userId_service_key" ON "Connection"("userId", "service");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleItem_taskId_key" ON "ModuleItem"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleItem_eventId_key" ON "ModuleItem"("eventId");

-- CreateIndex
CREATE INDEX "ModuleItem_userId_moduleId_state_idx" ON "ModuleItem"("userId", "moduleId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleItem_userId_moduleId_externalId_key" ON "ModuleItem"("userId", "moduleId", "externalId");

-- CreateIndex
CREATE INDEX "ModuleReading_userId_moduleId_idx" ON "ModuleReading"("userId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleReading_userId_moduleId_key_day_key" ON "ModuleReading"("userId", "moduleId", "key", "day");

-- CreateIndex
CREATE UNIQUE INDEX "InboundLink_tokenHash_key" ON "InboundLink"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "InboundLink_userId_moduleId_key" ON "InboundLink"("userId", "moduleId");

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleSync" ADD CONSTRAINT "ModuleSync_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleItem" ADD CONSTRAINT "ModuleItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleItem" ADD CONSTRAINT "ModuleItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleItem" ADD CONSTRAINT "ModuleItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleReading" ADD CONSTRAINT "ModuleReading_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundLink" ADD CONSTRAINT "InboundLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

