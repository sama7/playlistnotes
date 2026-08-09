-- CreateTable
CREATE TABLE "auth_lapses" (
    "id" UUID NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "days_since_last_sign_in" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_lapses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_lapses_occurred_on_idx" ON "auth_lapses"("occurred_on");

-- CreateIndex
CREATE UNIQUE INDEX "auth_lapses_visitor_id_occurred_on_key" ON "auth_lapses"("visitor_id", "occurred_on");
