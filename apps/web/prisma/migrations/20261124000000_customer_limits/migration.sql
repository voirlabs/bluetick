-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "booking_alert_at" TIMESTAMP(3),
ADD COLUMN     "lead_alert_at" TIMESTAMP(3),
ADD COLUMN     "limited_at" TIMESTAMP(3);

