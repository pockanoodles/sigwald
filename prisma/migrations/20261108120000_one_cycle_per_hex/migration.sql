-- One GoalCycle per person per hex. ensureCurrentHex could race on a hex's
-- first requests and create several copies (three on 2026-11-01, 15 ms
-- apart). Each later call then activated whichever copy Postgres returned
-- first, so the morning goal projection and the Stats page landed on
-- different copies and the goals sat in an archived one. Merge each set of
-- copies into the one holding the most goals, then make the dates unique.

CREATE TEMP TABLE "_cycle_merge" AS
WITH ranked AS (
  SELECT c."id", c."userId", c."startDate", c."endDate",
         ROW_NUMBER() OVER (
           PARTITION BY c."userId", c."startDate", c."endDate"
           ORDER BY (SELECT COUNT(*) FROM "Goal" g WHERE g."cycleId" = c."id") DESC,
                    (c."status" = 'active') DESC,
                    c."createdAt" ASC,
                    c."id" ASC
         ) AS "rn"
  FROM "GoalCycle" c
  WHERE c."userId" IS NOT NULL
)
SELECT d."id" AS "dupId", k."id" AS "keepId"
FROM ranked d
JOIN ranked k
  ON k."userId" = d."userId"
 AND k."startDate" = d."startDate"
 AND k."endDate" = d."endDate"
 AND k."rn" = 1
WHERE d."rn" > 1;

UPDATE "Goal" g
SET "cycleId" = m."keepId"
FROM "_cycle_merge" m
WHERE g."cycleId" = m."dupId";

-- The copy kept is active if any copy was,
UPDATE "GoalCycle" k
SET "status" = 'active'
WHERE k."id" IN (
  SELECT m."keepId"
  FROM "_cycle_merge" m
  JOIN "GoalCycle" d ON d."id" = m."dupId"
  WHERE d."status" = 'active'
);

-- and keeps a theme or a Build that only another copy had.
UPDATE "GoalCycle" k
SET "theme" = d."theme"
FROM "_cycle_merge" m
JOIN "GoalCycle" d ON d."id" = m."dupId"
WHERE k."id" = m."keepId" AND k."theme" = '' AND d."theme" <> '';

UPDATE "GoalCycle" k
SET "focusStats" = d."focusStats", "buildProjected" = d."buildProjected"
FROM "_cycle_merge" m
JOIN "GoalCycle" d ON d."id" = m."dupId"
WHERE k."id" = m."keepId"
  AND cardinality(k."focusStats") = 0
  AND cardinality(d."focusStats") > 0;

DELETE FROM "GoalCycle" WHERE "id" IN (SELECT "dupId" FROM "_cycle_merge");

DROP TABLE "_cycle_merge";

CREATE UNIQUE INDEX "GoalCycle_userId_startDate_endDate_key" ON "GoalCycle"("userId", "startDate", "endDate");
