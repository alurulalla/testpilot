/*
  Warnings:

  - You are about to drop the column `useCases` on the `Session` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Session" DROP COLUMN "useCases",
ADD COLUMN     "contextDoc" TEXT,
ADD COLUMN     "contextDocName" TEXT,
ADD COLUMN     "coverageAnalysis" JSONB,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "figmaOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fixResult" JSONB,
ADD COLUMN     "headedMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "importedProject" JSONB,
ADD COLUMN     "iteration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maxPages" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "scenarioResult" JSONB,
ADD COLUMN     "testResult" JSONB,
ADD COLUMN     "triageResult" JSONB,
ADD COLUMN     "userFlows" JSONB;
