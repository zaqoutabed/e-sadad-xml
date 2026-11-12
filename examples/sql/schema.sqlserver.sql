-- E-SADAD log tables (SQL Server), as required by the integration document.

CREATE TABLE EsadadTransactionsLogs (
    Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    TransactionType VARCHAR(10)   NOT NULL,  -- Request | Response
    Api             VARCHAR(40)   NOT NULL,  -- BillPull | PrepaidValidation | ReceivePaymentNotification
    Guid            VARCHAR(100)  NOT NULL,
    BillingNumber   NVARCHAR(100) NULL,
    BillNumber      NVARCHAR(100) NULL,
    ServiceType     NVARCHAR(100) NULL,
    Currency        VARCHAR(10)   NULL,
    ResultCode      INT           NULL,      -- response only
    XmlElement      NVARCHAR(MAX) NOT NULL,
    InsertDateTime  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
CREATE INDEX IX_EsadadTransactionsLogs_Guid ON EsadadTransactionsLogs (Guid);

CREATE TABLE EsadadPaymentsLogs (
    Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    Guid            VARCHAR(100)  NOT NULL,
    JoebppsTrx      VARCHAR(100)  NOT NULL,  -- E-SADAD transaction number (signed, used for idempotency)
    BillingNumber   NVARCHAR(100) NOT NULL,
    BillNumber      NVARCHAR(100) NULL,
    ServiceType     NVARCHAR(100) NOT NULL,
    Currency        VARCHAR(10)   NULL,
    PaidAmount      DECIMAL(18,3) NOT NULL,
    IsPaymentPosted BIT           NOT NULL DEFAULT 0,
    InsertDateTime  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
CREATE INDEX IX_EsadadPaymentsLogs_JoebppsTrx ON EsadadPaymentsLogs (JoebppsTrx);
-- Guarantees a payment is marked posted at most once, even with several app instances.
CREATE UNIQUE INDEX UX_EsadadPaymentsLogs_Posted ON EsadadPaymentsLogs (JoebppsTrx) WHERE IsPaymentPosted = 1;
