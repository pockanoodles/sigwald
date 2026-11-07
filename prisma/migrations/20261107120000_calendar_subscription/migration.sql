-- A secret URL that serves one user's plan as an iCalendar feed. Only the
-- SHA-256 of the token is stored; the raw token is shown once, at creation.
CREATE TABLE "CalendarSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarSubscription_userId_key" ON "CalendarSubscription"("userId");

CREATE UNIQUE INDEX "CalendarSubscription_tokenHash_key" ON "CalendarSubscription"("tokenHash");

ALTER TABLE "CalendarSubscription" ADD CONSTRAINT "CalendarSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
