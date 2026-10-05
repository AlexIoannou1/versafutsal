CREATE UNIQUE INDEX tournament_payment_active_attempt_unique ON tournament_payments(registration_id)
WHERE status IN ('PENDING', 'SUCCEEDED', 'REFUND_PENDING', 'REFUNDED');