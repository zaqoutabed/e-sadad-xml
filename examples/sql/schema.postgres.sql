-- E-SADAD log tables (PostgreSQL), as required by the integration document.

CREATE TABLE esadad_transactions_logs (
    id               BIGSERIAL PRIMARY KEY,
    transaction_type VARCHAR(10)  NOT NULL,  -- Request | Response
    api              VARCHAR(40)  NOT NULL,  -- BillPull | PrepaidValidation | ReceivePaymentNotification
    guid             VARCHAR(100) NOT NULL,
    billing_number   VARCHAR(100),
    bill_number      VARCHAR(100),
    service_type     VARCHAR(100),
    currency         VARCHAR(10),
    result_code      INTEGER,               -- response only
    xml_element      TEXT         NOT NULL,
    inserted_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_esadad_transactions_logs_guid ON esadad_transactions_logs (guid);

CREATE TABLE esadad_payments_logs (
    id                BIGSERIAL PRIMARY KEY,
    guid              VARCHAR(100)  NOT NULL,
    joebpps_trx       VARCHAR(100)  NOT NULL, -- E-SADAD transaction number (signed, used for idempotency)
    billing_number    VARCHAR(100)  NOT NULL,
    bill_number       VARCHAR(100),
    service_type      VARCHAR(100)  NOT NULL,
    currency          VARCHAR(10),
    paid_amount       NUMERIC(18,3) NOT NULL,
    is_payment_posted BOOLEAN       NOT NULL DEFAULT FALSE,
    inserted_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_esadad_payments_logs_trx ON esadad_payments_logs (joebpps_trx);
-- A payment can be marked posted only once, even with several app instances.
CREATE UNIQUE INDEX ux_esadad_payments_logs_posted ON esadad_payments_logs (joebpps_trx) WHERE is_payment_posted;
