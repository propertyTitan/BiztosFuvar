-- 2026-09-29 (CIB PR-1): a 094 előtt könyvelt bizonylatok értesítései a
-- könyveléskor már kimentek — ezeket nyugtázottnak jelöljük, hogy egy késői
-- ismétlés (webhook-retry, helyreállítás) ne küldjön második levelet.
UPDATE fee_payment_receipts
   SET notifications_sent_at = paid_at
 WHERE notifications_sent_at IS NULL;
